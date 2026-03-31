import config from '../config.js';
import {
  extractFVGs, extractOrderBlocks, extractLiquiditySweeps, extractOTEs,
} from '../engine/Precompute.js';

export const ICTSignalType = {
  FVG: 'FVG',
  ORDER_BLOCK: 'ORDER_BLOCK',
  LIQUIDITY_SWEEP: 'LIQUIDITY_SWEEP',
  OTE: 'OTE',
  BOS: 'BOS',
  CHoCH: 'CHoCH',
};

/**
 * ICTAnalyzer — Dual-mode: precomputed (backtest) and live (incremental).
 *
 * BACKTEST MODE:
 *   1. Call precomputeAll(candles1h) once before the loop
 *   2. Call getSignalsAt(i) for O(1) signal lookup at each candle index
 *
 * LIVE MODE:
 *   Call analyze(symbol, candles) as before — runs incremental state updates.
 */
export default class ICTAnalyzer {
  constructor() {
    this.fvgs = [];
    this.orderBlocks = [];
    this.liquidityLevels = [];
    this.lastStructure = null;
    this._lastAnalyzedLength = 0;

    // Precomputed arrays (set by precomputeAll)
    this._precomputedFVGs = null;
    this._precomputedOBs = null;
    this._precomputedSweeps = null;
    this._precomputedOTEs = null;
  }

  /**
   * Precompute all ICT features from 1h candles. O(n) total.
   * Call once before backtest loop. After this, getSignalsAt(i) is O(1).
   */
  precomputeAll(candles1h) {
    this._precomputedFVGs = extractFVGs(candles1h);
    this._precomputedOBs = extractOrderBlocks(candles1h);
    this._precomputedSweeps = extractLiquiditySweeps(candles1h);
    this._precomputedOTEs = extractOTEs(candles1h);
  }

  /**
   * O(1) lookup for all ICT signals at candle index i.
   * Returns { signals: [...] } matching the format of analyze().
   */
  getSignalsAt(i) {
    const signals = [];
    if (this._precomputedFVGs?.[i]) signals.push(...this._precomputedFVGs[i]);
    if (this._precomputedOBs?.[i]) signals.push(...this._precomputedOBs[i]);
    if (this._precomputedSweeps?.[i]) signals.push(...this._precomputedSweeps[i]);
    if (this._precomputedOTEs?.[i]) signals.push(...this._precomputedOTEs[i]);

    return {
      signals: signals.filter(s => s.confidence > 0.3).sort((a, b) => b.confidence - a.confidence),
      fvgs: this.fvgs?.filter(f => !f.tested) || [],
      orderBlocks: this.orderBlocks?.filter(ob => !ob.mitigated) || [],
      liquidityLevels: this.liquidityLevels || [],
      structure: this.lastStructure,
    };
  }

  /**
   * Live mode: analyze from candle window (incremental state).
   * Used by live bots (BotRunner). NOT used in backtest.
   */
  analyze(symbol, candles) {
    if (candles.length < 50) return { signals: [] };

    const signals = [];

    // Run detections — only scan new candles since last analysis
    const startIdx = Math.max(0, this._lastAnalyzedLength - 5);
    signals.push(...this._detectFVGs(candles, startIdx));
    signals.push(...this._detectOrderBlocks(candles, startIdx));
    signals.push(...this._detectLiquiditySweeps(candles));
    signals.push(...this._detectBOS(candles));
    signals.push(...this._detectOTE(candles));

    this._lastAnalyzedLength = candles.length;
    this._pruneState(candles);

    const scored = signals
      .filter(s => s.confidence > 0.3)
      .sort((a, b) => b.confidence - a.confidence);

    return {
      signals: scored,
      fvgs: this.fvgs.filter(f => !f.tested),
      orderBlocks: this.orderBlocks.filter(ob => !ob.mitigated),
      liquidityLevels: this.liquidityLevels,
      structure: this.lastStructure,
    };
  }

  // ── Live mode detection methods (unchanged from original) ──

  _pruneState(candles) {
    const maxFVGs = config.ict.maxFVGs;
    const maxOBs = config.ict.maxOrderBlocks;
    const price = candles[candles.length - 1].close;

    this.fvgs = this.fvgs.filter(f => {
      if (f.tested) return false;
      const dist = Math.abs(price - (f.top + f.bottom) / 2) / price;
      return dist < 0.05;
    });
    if (this.fvgs.length > maxFVGs) this.fvgs = this.fvgs.slice(-maxFVGs);

    this.orderBlocks = this.orderBlocks.filter(ob => !ob.mitigated);
    if (this.orderBlocks.length > maxOBs) this.orderBlocks = this.orderBlocks.slice(-maxOBs);

    if (this.liquidityLevels.length > 20) this.liquidityLevels = this.liquidityLevels.slice(-20);
  }

  _detectFVGs(candles, startIdx = 0) {
    const signals = [];
    const minGap = config.ict.fvgMinSize;
    const begin = Math.max(2, startIdx);

    for (let i = begin; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c3 = candles[i];

      if (c1.high < c3.low) {
        const gapSize = (c3.low - c1.high) / c1.high;
        if (gapSize >= minGap) {
          const fvg = {
            type: ICTSignalType.FVG, direction: 'bullish',
            top: c3.low, bottom: c1.high, size: gapSize,
            index: i, timestamp: candles[i].timestamp,
            tested: false, confidence: this._fvgConfidence(gapSize, candles, i),
          };
          const price = candles[candles.length - 1].close;
          if (price >= fvg.bottom && price <= fvg.top) {
            signals.push({ ...fvg, action: 'buy', reason: 'Price filling bullish FVG' });
          }
          const isDup = this.fvgs.some(f => f.direction === 'bullish' && Math.abs(f.top - fvg.top) / fvg.top < 0.001);
          if (!isDup) this.fvgs.push(fvg);
        }
      }

      if (c1.low > c3.high) {
        const gapSize = (c1.low - c3.high) / c3.high;
        if (gapSize >= minGap) {
          const fvg = {
            type: ICTSignalType.FVG, direction: 'bearish',
            top: c1.low, bottom: c3.high, size: gapSize,
            index: i, timestamp: candles[i].timestamp,
            tested: false, confidence: this._fvgConfidence(gapSize, candles, i),
          };
          const price = candles[candles.length - 1].close;
          if (price >= fvg.bottom && price <= fvg.top) {
            signals.push({ ...fvg, action: 'sell', reason: 'Price filling bearish FVG' });
          }
          const isDup = this.fvgs.some(f => f.direction === 'bearish' && Math.abs(f.top - fvg.top) / fvg.top < 0.001);
          if (!isDup) this.fvgs.push(fvg);
        }
      }
    }

    const price = candles[candles.length - 1].close;
    for (const fvg of this.fvgs) {
      if (!fvg.tested && price >= fvg.bottom && price <= fvg.top) fvg.tested = true;
    }
    return signals;
  }

  _detectOrderBlocks(candles, startIdx = 0) {
    const signals = [];
    const lookback = config.ict.orderBlockLookback;
    const begin = Math.max(4, Math.max(startIdx, candles.length - lookback));

    for (let i = begin; i < candles.length; i++) {
      const candle = candles[i];
      const next = candles[i + 1];
      if (!next) continue;

      if (candle.close < candle.open && next.close > next.open) {
        const move = (next.close - next.open) / next.open;
        if (move > 0.003) {
          const ob = {
            type: ICTSignalType.ORDER_BLOCK, direction: 'bullish',
            top: candle.high, bottom: candle.low, index: i,
            timestamp: candle.timestamp, mitigated: false,
            strength: move, confidence: Math.min(move * 100, 1.0),
          };
          const price = candles[candles.length - 1].close;
          if (price <= ob.top && price >= ob.bottom) {
            signals.push({ ...ob, action: 'buy', reason: 'Price at bullish order block' });
          }
          const isDup = this.orderBlocks.some(o => o.direction === 'bullish' && Math.abs(o.top - ob.top) / ob.top < 0.001);
          if (!isDup) this.orderBlocks.push(ob);
        }
      }

      if (candle.close > candle.open && next.close < next.open) {
        const move = (next.open - next.close) / next.open;
        if (move > 0.003) {
          const ob = {
            type: ICTSignalType.ORDER_BLOCK, direction: 'bearish',
            top: candle.high, bottom: candle.low, index: i,
            timestamp: candle.timestamp, mitigated: false,
            strength: move, confidence: Math.min(move * 100, 1.0),
          };
          const price = candles[candles.length - 1].close;
          if (price >= ob.bottom && price <= ob.top) {
            signals.push({ ...ob, action: 'sell', reason: 'Price at bearish order block' });
          }
          const isDup = this.orderBlocks.some(o => o.direction === 'bearish' && Math.abs(o.top - ob.top) / ob.top < 0.001);
          if (!isDup) this.orderBlocks.push(ob);
        }
      }
    }

    const price = candles[candles.length - 1].close;
    for (const ob of this.orderBlocks) {
      if (!ob.mitigated) {
        if (ob.direction === 'bullish' && price < ob.bottom) ob.mitigated = true;
        if (ob.direction === 'bearish' && price > ob.top) ob.mitigated = true;
      }
    }
    return signals;
  }

  _detectLiquiditySweeps(candles) {
    const signals = [];
    const minWickRatio = config.ict.liquiditySweepWickRatio;
    const start = Math.max(10, candles.length - 30);

    for (let i = start; i < candles.length - 1; i++) {
      const c = candles[i];
      const range = c.high - c.low;
      if (range === 0) continue;

      const recentLows = candles.slice(i - 10, i).map(x => x.low);
      const eqLow = Math.min(...recentLows);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      if (c.low < eqLow && (lowerWick / range) >= minWickRatio && c.close > eqLow) {
        signals.push({
          type: ICTSignalType.LIQUIDITY_SWEEP, direction: 'bullish', action: 'buy',
          price: c.close, wickRatio: lowerWick / range, index: i,
          confidence: Math.min(lowerWick / range, 1.0),
          reason: `Bullish liquidity sweep below ${eqLow.toFixed(4)}`,
        });
      }

      const recentHighs = candles.slice(i - 10, i).map(x => x.high);
      const eqHigh = Math.max(...recentHighs);
      const upperWick = c.high - Math.max(c.open, c.close);
      if (c.high > eqHigh && (upperWick / range) >= minWickRatio && c.close < eqHigh) {
        signals.push({
          type: ICTSignalType.LIQUIDITY_SWEEP, direction: 'bearish', action: 'sell',
          price: c.close, wickRatio: upperWick / range, index: i,
          confidence: Math.min(upperWick / range, 1.0),
          reason: `Bearish liquidity sweep above ${eqHigh.toFixed(4)}`,
        });
      }
    }
    return signals.slice(-3);
  }

  _detectBOS(candles) { return []; } // BOS not used for signals (structural only)
  _detectOTE(candles) {
    const signals = [];
    const price = candles[candles.length - 1].close;
    const start = Math.max(10, candles.length - 20);

    for (let i = start; i < candles.length - 1; i++) {
      if (i < 10) continue;
      const lookback = candles.slice(i - 10, i);
      const impulse = candles[i];
      const moveSize = Math.abs(impulse.close - impulse.open) / impulse.open;
      if (moveSize <= 0.005) continue;

      if (impulse.close > impulse.open) {
        const low = Math.min(...lookback.map(c => c.low));
        const high = impulse.high;
        const range = high - low;
        const ote618 = high - range * config.ict.oteRetracement.min;
        const ote786 = high - range * config.ict.oteRetracement.max;
        if (price >= ote786 && price <= ote618) {
          signals.push({
            type: ICTSignalType.OTE, direction: 'bullish', action: 'buy', confidence: 0.7,
            reason: `Price in bullish OTE zone (${ote786.toFixed(4)} - ${ote618.toFixed(4)})`,
          });
        }
      } else {
        const high = Math.max(...lookback.map(c => c.high));
        const low = impulse.low;
        const range = high - low;
        const ote618 = low + range * config.ict.oteRetracement.min;
        const ote786 = low + range * config.ict.oteRetracement.max;
        if (price >= ote618 && price <= ote786) {
          signals.push({
            type: ICTSignalType.OTE, direction: 'bearish', action: 'sell', confidence: 0.7,
            reason: `Price in bearish OTE zone (${ote618.toFixed(4)} - ${ote786.toFixed(4)})`,
          });
        }
      }
    }
    return signals.slice(-2);
  }

  _fvgConfidence(gapSize, candles, index) {
    let score = 0.4;
    if (gapSize > 0.005) score += 0.2;
    if (gapSize > 0.01) score += 0.1;
    const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    if (candles[index].volume > avgVol) score += 0.15;
    const recency = 1 - (candles.length - index) / candles.length;
    score += recency * 0.15;
    return Math.min(score, 1.0);
  }
}
