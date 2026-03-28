import config from '../config.js';

export const ICTSignalType = {
  FVG: 'FVG',
  ORDER_BLOCK: 'ORDER_BLOCK',
  LIQUIDITY_SWEEP: 'LIQUIDITY_SWEEP',
  OTE: 'OTE',
  BOS: 'BOS',          // Break of Structure
  CHoCH: 'CHoCH',      // Change of Character
};

export default class ICTAnalyzer {
  constructor() {
    this.fvgs = [];           // untested Fair Value Gaps
    this.orderBlocks = [];    // active Order Blocks
    this.liquidityLevels = []; // equal highs/lows
    this.lastStructure = null; // BOS / CHoCH tracking
    this._lastAnalyzedLength = 0;
  }

  analyze(symbol, candles) {
    if (candles.length < 50) return { signals: [] };

    const signals = [];

    // Run detections — only scan new candles since last analysis
    const startIdx = Math.max(0, this._lastAnalyzedLength - 5); // re-scan last 5 for overlap
    signals.push(...this._detectFVGs(candles, startIdx));
    signals.push(...this._detectOrderBlocks(candles, startIdx));
    signals.push(...this._detectLiquiditySweeps(candles));
    signals.push(...this._detectBOS(candles));
    signals.push(...this._detectOTE(candles));

    this._lastAnalyzedLength = candles.length;

    // Prune old state to prevent unbounded growth
    this._pruneState(candles);

    // Filter and score
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

  // ── State Pruning ────────────────────────────────────────────────
  _pruneState(candles) {
    const maxFVGs = config.ict.maxFVGs;
    const maxOBs = config.ict.maxOrderBlocks;
    const price = candles[candles.length - 1].close;

    // Remove tested FVGs that price has moved far away from
    this.fvgs = this.fvgs.filter(f => {
      if (f.tested) return false;
      // Keep if price is still within 5% of FVG zone
      const dist = Math.abs(price - (f.top + f.bottom) / 2) / price;
      return dist < 0.05;
    });

    // Cap at max
    if (this.fvgs.length > maxFVGs) {
      this.fvgs = this.fvgs.slice(-maxFVGs);
    }

    // Remove mitigated OBs
    this.orderBlocks = this.orderBlocks.filter(ob => !ob.mitigated);

    // Cap at max
    if (this.orderBlocks.length > maxOBs) {
      this.orderBlocks = this.orderBlocks.slice(-maxOBs);
    }

    // Keep only recent liquidity levels
    if (this.liquidityLevels.length > 20) {
      this.liquidityLevels = this.liquidityLevels.slice(-20);
    }
  }

  // ── Fair Value Gaps (OPTIMIZED: scan from startIdx) ──────────────
  _detectFVGs(candles, startIdx = 0) {
    const signals = [];
    const minGap = config.ict.fvgMinSize;
    const begin = Math.max(2, startIdx);

    for (let i = begin; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c3 = candles[i];

      // Bullish FVG: candle 1 high < candle 3 low (gap up)
      if (c1.high < c3.low) {
        const gapSize = (c3.low - c1.high) / c1.high;
        if (gapSize >= minGap) {
          const fvg = {
            type: ICTSignalType.FVG,
            direction: 'bullish',
            top: c3.low,
            bottom: c1.high,
            size: gapSize,
            index: i,
            timestamp: candles[i].timestamp,
            tested: false,
            confidence: this._fvgConfidence(gapSize, candles, i),
          };

          // Check if price is currently in the FVG zone
          const price = candles[candles.length - 1].close;
          if (price >= fvg.bottom && price <= fvg.top) {
            signals.push({ ...fvg, action: 'buy', reason: 'Price filling bullish FVG' });
          }

          // Only push if not duplicate
          const isDup = this.fvgs.some(f =>
            f.direction === 'bullish' &&
            Math.abs(f.top - fvg.top) / fvg.top < 0.001 &&
            Math.abs(f.bottom - fvg.bottom) / fvg.bottom < 0.001
          );
          if (!isDup) this.fvgs.push(fvg);
        }
      }

      // Bearish FVG: candle 1 low > candle 3 high (gap down)
      if (c1.low > c3.high) {
        const gapSize = (c1.low - c3.high) / c3.high;
        if (gapSize >= minGap) {
          const fvg = {
            type: ICTSignalType.FVG,
            direction: 'bearish',
            top: c1.low,
            bottom: c3.high,
            size: gapSize,
            index: i,
            timestamp: candles[i].timestamp,
            tested: false,
            confidence: this._fvgConfidence(gapSize, candles, i),
          };

          const price = candles[candles.length - 1].close;
          if (price >= fvg.bottom && price <= fvg.top) {
            signals.push({ ...fvg, action: 'sell', reason: 'Price filling bearish FVG' });
          }

          const isDup = this.fvgs.some(f =>
            f.direction === 'bearish' &&
            Math.abs(f.top - fvg.top) / fvg.top < 0.001 &&
            Math.abs(f.bottom - fvg.bottom) / fvg.bottom < 0.001
          );
          if (!isDup) this.fvgs.push(fvg);
        }
      }
    }

    // Mark tested FVGs
    const price = candles[candles.length - 1].close;
    for (const fvg of this.fvgs) {
      if (!fvg.tested && price >= fvg.bottom && price <= fvg.top) {
        fvg.tested = true;
      }
    }

    return signals;
  }

  // ── Order Blocks (OPTIMIZED) ─────────────────────────────────────
  _detectOrderBlocks(candles, startIdx = 0) {
    const signals = [];
    const lookback = config.ict.orderBlockLookback;
    const begin = Math.max(4, Math.max(startIdx, candles.length - lookback));

    for (let i = begin; i < candles.length; i++) {
      const candle = candles[i];
      const next = candles[i + 1];
      if (!next) continue;

      // Bullish Order Block: last bearish candle before strong bullish move
      if (candle.close < candle.open && next.close > next.open) {
        const move = (next.close - next.open) / next.open;
        if (move > 0.003) {
          const ob = {
            type: ICTSignalType.ORDER_BLOCK,
            direction: 'bullish',
            top: candle.high,
            bottom: candle.low,
            index: i,
            timestamp: candle.timestamp,
            mitigated: false,
            strength: move,
            confidence: Math.min(move * 100, 1.0),
          };

          const price = candles[candles.length - 1].close;
          if (price <= ob.top && price >= ob.bottom) {
            signals.push({ ...ob, action: 'buy', reason: 'Price at bullish order block' });
          }

          const isDup = this.orderBlocks.some(o =>
            o.direction === 'bullish' &&
            Math.abs(o.top - ob.top) / ob.top < 0.001 &&
            Math.abs(o.bottom - ob.bottom) / ob.bottom < 0.001
          );
          if (!isDup) this.orderBlocks.push(ob);
        }
      }

      // Bearish Order Block: last bullish candle before strong bearish move
      if (candle.close > candle.open && next.close < next.open) {
        const move = (next.open - next.close) / next.open;
        if (move > 0.003) {
          const ob = {
            type: ICTSignalType.ORDER_BLOCK,
            direction: 'bearish',
            top: candle.high,
            bottom: candle.low,
            index: i,
            timestamp: candle.timestamp,
            mitigated: false,
            strength: move,
            confidence: Math.min(move * 100, 1.0),
          };

          const price = candles[candles.length - 1].close;
          if (price >= ob.bottom && price <= ob.top) {
            signals.push({ ...ob, action: 'sell', reason: 'Price at bearish order block' });
          }

          const isDup = this.orderBlocks.some(o =>
            o.direction === 'bearish' &&
            Math.abs(o.top - ob.top) / ob.top < 0.001 &&
            Math.abs(o.bottom - ob.bottom) / ob.bottom < 0.001
          );
          if (!isDup) this.orderBlocks.push(ob);
        }
      }
    }

    // Mark mitigated OBs
    const price = candles[candles.length - 1].close;
    for (const ob of this.orderBlocks) {
      if (!ob.mitigated) {
        if (ob.direction === 'bullish' && price < ob.bottom) ob.mitigated = true;
        if (ob.direction === 'bearish' && price > ob.top) ob.mitigated = true;
      }
    }

    return signals;
  }

  // ── Liquidity Sweeps ─────────────────────────────────────────────
  _detectLiquiditySweeps(candles) {
    const signals = [];
    const minWickRatio = config.ict.liquiditySweepWickRatio;

    // Only scan last 30 candles for sweeps
    const start = Math.max(10, candles.length - 30);

    for (let i = start; i < candles.length - 1; i++) {
      const c = candles[i];
      const range = c.high - c.low;
      if (range === 0) continue;

      // Bullish sweep: swept below recent lows then closed higher
      const recentLows = candles.slice(i - 10, i).map(x => x.low);
      const eqLow = Math.min(...recentLows);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const wickRatio = lowerWick / range;

      if (c.low < eqLow && wickRatio >= minWickRatio && c.close > eqLow) {
        signals.push({
          type: ICTSignalType.LIQUIDITY_SWEEP,
          direction: 'bullish',
          action: 'buy',
          price: c.close,
          sweepLevel: eqLow,
          wickRatio,
          index: i,
          confidence: Math.min(wickRatio, 1.0),
          reason: `Bullish liquidity sweep below ${eqLow.toFixed(4)}`,
        });
      }

      // Bearish sweep: swept above recent highs then closed lower
      const recentHighs = candles.slice(i - 10, i).map(x => x.high);
      const eqHigh = Math.max(...recentHighs);
      const upperWick = c.high - Math.max(c.open, c.close);
      const upperWickRatio = upperWick / range;

      if (c.high > eqHigh && upperWickRatio >= minWickRatio && c.close < eqHigh) {
        signals.push({
          type: ICTSignalType.LIQUIDITY_SWEEP,
          direction: 'bearish',
          action: 'sell',
          price: c.close,
          sweepLevel: eqHigh,
          wickRatio: upperWickRatio,
          index: i,
          confidence: Math.min(upperWickRatio, 1.0),
          reason: `Bearish liquidity sweep above ${eqHigh.toFixed(4)}`,
        });
      }
    }

    return signals.slice(-3);
  }

  // ── Break of Structure ────────────────────────────────────────────
  _detectBOS(candles) {
    const signals = [];
    const swingLength = 5;
    const start = Math.max(swingLength * 2, candles.length - 50);

    for (let i = start; i < candles.length - 1; i++) {
      const swingSlice = candles.slice(i - swingLength, i + swingLength + 1);
      const current = candles[i];
      const isSwingHigh = swingSlice.every(c => c.high <= current.high);
      const isSwingLow = swingSlice.every(c => c.low >= current.low);

      if (isSwingHigh || isSwingLow) {
        const prevSwings = candles.slice(Math.max(0, i - 30), i)
          .filter((c, idx, arr) => {
            const localSlice = arr.slice(Math.max(0, idx - 3), Math.min(arr.length, idx + 4));
            return localSlice.every(x => x.high <= c.high) || localSlice.every(x => x.low >= c.low);
          });

        if (isSwingHigh && prevSwings.length > 0) {
          const prevHigh = Math.max(...prevSwings.map(c => c.high));
          if (current.high > prevHigh) {
            this.lastStructure = { type: ICTSignalType.BOS, direction: 'bullish', level: current.high, index: i };
          }
        }
        if (isSwingLow && prevSwings.length > 0) {
          const prevLow = Math.min(...prevSwings.map(c => c.low));
          if (current.low < prevLow) {
            this.lastStructure = { type: ICTSignalType.BOS, direction: 'bearish', level: current.low, index: i };
          }
        }
      }
    }

    return signals;
  }

  // ── Optimal Trade Entry ───────────────────────────────────────────
  _detectOTE(candles) {
    const signals = [];
    const price = candles[candles.length - 1].close;

    // Only check last 20 candles for OTE zones
    const start = Math.max(10, candles.length - 20);

    for (let i = start; i < candles.length - 1; i++) {
      if (i < 10) continue;

      const lookback = candles.slice(i - 10, i);
      const impulse = candles[i];
      const moveSize = Math.abs(impulse.close - impulse.open) / impulse.open;

      if (moveSize > 0.005) {
        if (impulse.close > impulse.open) {
          const low = Math.min(...lookback.map(c => c.low));
          const high = impulse.high;
          const range = high - low;
          const ote618 = high - range * config.ict.oteRetracement.min;
          const ote786 = high - range * config.ict.oteRetracement.max;

          if (price >= ote786 && price <= ote618) {
            signals.push({
              type: ICTSignalType.OTE,
              direction: 'bullish',
              action: 'buy',
              oteZone: { low: ote786, high: ote618 },
              price,
              confidence: 0.7,
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
              type: ICTSignalType.OTE,
              direction: 'bearish',
              action: 'sell',
              oteZone: { low: ote618, high: ote786 },
              price,
              confidence: 0.7,
              reason: `Price in bearish OTE zone (${ote618.toFixed(4)} - ${ote786.toFixed(4)})`,
            });
          }
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
