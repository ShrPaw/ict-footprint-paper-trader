import config from '../config.js';
import { computeDelta } from '../engine/Precompute.js';

/**
 * RealFootprintAnalyzer — Dual-mode: precomputed (backtest) and live (incremental).
 *
 * BACKTEST MODE:
 *   1. Call precomputeDelta(candles) once before the loop
 *   2. Call getDeltaAt(i) for O(1) delta lookup at each candle index
 *
 * LIVE MODE:
 *   Call analyze(symbol, candles, realFootprint) as before.
 */
export default class RealFootprintAnalyzer {
  constructor() {
    this.deltaHistory = [];
    this.cumulativeDelta = 0;
    this.volumeProfile = {};
    this.pocPrice = null;
    this._lastAnalyzedLength = 0;
    this._lastCandleFootprint = null;

    // Precomputed delta arrays
    this._precomputedDelta = null;
    this._precomputedDeltaPercent = null;
  }

  /**
   * Precompute delta approximation from candles. O(n).
   * Call once before backtest loop.
   */
  precomputeDelta(candles) {
    const result = computeDelta(candles);
    this._precomputedDelta = result.delta;
    this._precomputedDeltaPercent = result.deltaPercent;
  }

  /**
   * O(1) lookup for delta at candle index i.
   */
  getDeltaAt(i) {
    if (!this._precomputedDelta) return { delta: 0, deltaPercent: 0 };
    return {
      delta: this._precomputedDelta[i] ?? 0,
      deltaPercent: this._precomputedDeltaPercent[i] ?? 0,
    };
  }

  /**
   * Get delta history for the last N candles ending at index i.
   * Used for divergence detection. O(n) where n = count.
   */
  getDeltaHistory(endIdx, count = 10) {
    if (!this._precomputedDelta) return [];
    const start = Math.max(0, endIdx - count + 1);
    return this._precomputedDelta.slice(start, endIdx + 1);
  }

  // Hyperliquid real footprint ingestion
  ingestRealFootprint(footprint) {
    this._lastCandleFootprint = footprint;
  }

  /**
   * Live mode: analyze from candle window + optional real footprint.
   */
  analyze(symbol, candles, realFootprint = null) {
    if (candles.length < 20) return { signals: [] };

    const signals = [];

    this._buildDelta(candles, realFootprint);
    this._buildVolumeProfile(candles.slice(-config.footprint.maxDeltaHistory));

    signals.push(...this._detectDeltaDivergence(candles));
    signals.push(...this._detectAbsorption(candles, realFootprint));
    signals.push(...this._detectStackedImbalance(candles));
    signals.push(...this._detectDeltaFlip(candles));
    signals.push(...this._detectPOCReactions(candles));
    signals.push(...this._detectVolumeShelf(candles, realFootprint));

    this._lastAnalyzedLength = candles.length;

    return {
      signals: signals.filter(s => s.confidence > 0.3).sort((a, b) => b.confidence - a.confidence),
      cumulativeDelta: this.cumulativeDelta,
      pocPrice: this.pocPrice,
      deltaTrend: this._getDeltaTrend(),
      usingRealData: !!realFootprint,
    };
  }

  // ── Live mode methods (unchanged from original) ──

  _buildDelta(candles, realFootprint) {
    const maxHistory = config.footprint.maxDeltaHistory;
    const start = Math.max(0, candles.length - maxHistory);

    this.deltaHistory = [];
    this.cumulativeDelta = 0;

    for (let i = start; i < candles.length; i++) {
      const c = candles[i];
      let delta;

      if (realFootprint && i === candles.length - 1) {
        delta = realFootprint.delta;
      } else {
        const range = c.high - c.low;
        if (range === 0) {
          delta = 0;
        } else {
          const closePosition = (c.close - c.low) / range;
          delta = (closePosition - 0.5) * 2 * c.volume;
        }
      }

      this.deltaHistory.push(delta);
      this.cumulativeDelta += delta;
    }
  }

  _buildVolumeProfile(candles) {
    this.volumeProfile = {};
    const tickSize = this._estimateTickSize(candles);

    for (const c of candles) {
      const levels = Math.ceil((c.high - c.low) / tickSize);
      const cappedLevels = Math.min(levels, 100);
      const volPerLevel = c.volume / Math.max(cappedLevels, 1);

      let price = c.low;
      let count = 0;
      while (price <= c.high && count < cappedLevels) {
        const key = price.toFixed(6);
        if (!this.volumeProfile[key]) this.volumeProfile[key] = { buy: 0, sell: 0, total: 0 };
        this.volumeProfile[key].total += volPerLevel;
        price += tickSize;
        count++;
      }
    }

    let maxVol = 0;
    for (const [price, data] of Object.entries(this.volumeProfile)) {
      if (data.total > maxVol) {
        maxVol = data.total;
        this.pocPrice = parseFloat(price);
      }
    }
  }

  _detectDeltaDivergence(candles) {
    const signals = [];
    const lookback = 10;
    const recent = candles.slice(-lookback);
    const recentDeltas = this.deltaHistory.slice(-lookback);

    if (recent.length < 5 || recentDeltas.length < 5) return signals;

    const priceRising = recent[recent.length - 1].close > recent[0].close;
    const deltaRising = recentDeltas[recentDeltas.length - 1] > recentDeltas[0];

    if (priceRising && !deltaRising) {
      const strength = this._divergenceStrength(recentDeltas);
      signals.push({
        type: 'DELTA_DIVERGENCE', direction: 'bearish', action: 'sell',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bearish delta divergence — price rising but buying pressure fading',
      });
    }

    if (!priceRising && deltaRising) {
      const strength = this._divergenceStrength(recentDeltas);
      signals.push({
        type: 'DELTA_DIVERGENCE', direction: 'bullish', action: 'buy',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bullish delta divergence — price falling but buying pressure building',
      });
    }

    return signals;
  }

  _detectAbsorption(candles, realFootprint) {
    const signals = [];
    const recentCandles = candles.slice(-20);
    const avgVolume = recentCandles.reduce((s, c) => s + c.volume, 0) / recentCandles.length;
    const threshold = avgVolume * config.footprint.absorptionVolumeMult;

    const last3 = candles.slice(-3);
    for (const c of last3) {
      if (c.volume < threshold) continue;
      const range = c.high - c.low;
      const body = Math.abs(c.close - c.open);
      const bodyRatio = body / (range || 1);

      if (bodyRatio < 0.3) {
        if (realFootprint && realFootprint.trades > 50) {
          const absRatio = Math.max(
            realFootprint.buyVolume / (realFootprint.sellVolume || 1),
            realFootprint.sellVolume / (realFootprint.buyVolume || 1)
          );
          if (absRatio > 2.0) {
            signals.push({
              type: 'ABSORPTION',
              direction: realFootprint.buyVolume > realFootprint.sellVolume ? 'bullish' : 'bearish',
              action: realFootprint.buyVolume > realFootprint.sellVolume ? 'buy' : 'sell',
              confidence: Math.min(0.5 + (absRatio - 2) * 0.15, 0.9),
              realData: true,
              reason: `Buy/Sell absorption (${realFootprint.trades} trades)`,
            });
            continue;
          }
        }

        const closePosition = (c.close - c.low) / (range || 1);
        signals.push({
          type: 'ABSORPTION',
          direction: closePosition > 0.5 ? 'bullish' : 'bearish',
          action: closePosition > 0.5 ? 'buy' : 'sell',
          confidence: Math.min((1 - bodyRatio) * 0.7, 0.8),
          realData: false,
          reason: `${closePosition > 0.5 ? 'Buy' : 'Sell'} absorption (estimated)`,
        });
      }
    }
    return signals;
  }

  _detectStackedImbalance(candles) {
    const signals = [];
    const recentDeltas = this.deltaHistory.slice(-6);
    const recentCandles = candles.slice(-6);
    if (recentDeltas.length < 4) return signals;

    let streak = 0, streakDir = null;
    for (let i = recentDeltas.length - 1; i >= 0; i--) {
      const c = recentCandles[i];
      const range = c.high - c.low;
      if (range === 0) break;
      const closePos = (c.close - c.low) / range;
      if (!(closePos > 0.8 || closePos < 0.2)) break;
      const dir = closePos > 0.5 ? 'bullish' : 'bearish';
      if (streakDir === null) streakDir = dir;
      if (dir !== streakDir) break;
      streak++;
    }

    if (streak >= 3) {
      signals.push({
        type: 'STACKED_IMBALANCE', direction: streakDir,
        action: streakDir === 'bullish' ? 'buy' : 'sell',
        confidence: Math.min(0.5 + (streak - 3) * 0.1, 0.85),
        reason: `${streak} consecutive ${streakDir} imbalance candles`,
      });
    }
    return signals;
  }

  _detectDeltaFlip(candles) {
    const signals = [];
    if (this.deltaHistory.length < 10) return signals;

    const recent = this.deltaHistory.slice(-10);
    const first5 = recent.slice(0, 5).reduce((a, b) => a + b, 0);
    const last5 = recent.slice(5).reduce((a, b) => a + b, 0);

    if (first5 > 0 && last5 < 0 && Math.abs(last5) > Math.abs(first5) * 0.5) {
      signals.push({
        type: 'DELTA_FLIP', direction: 'bearish', action: 'sell', confidence: 0.55,
        reason: 'Delta flipped bullish → bearish',
      });
    }
    if (first5 < 0 && last5 > 0 && Math.abs(last5) > Math.abs(first5) * 0.5) {
      signals.push({
        type: 'DELTA_FLIP', direction: 'bullish', action: 'buy', confidence: 0.55,
        reason: 'Delta flipped bearish → bullish',
      });
    }
    return signals;
  }

  _detectPOCReactions(candles) {
    if (!this.pocPrice) return [];
    const signals = [];
    const price = candles[candles.length - 1].close;
    const tolerance = this.pocPrice * config.footprint.pocTolerance;

    if (Math.abs(price - this.pocPrice) < tolerance) {
      const prevPrice = candles[candles.length - 2]?.close || price;
      const direction = price > prevPrice ? 'bullish' : 'bearish';
      signals.push({
        type: 'POC_REACTION', direction,
        action: direction === 'bullish' ? 'buy' : 'sell',
        confidence: 0.55,
        reason: `Price reacting at POC (${this.pocPrice.toFixed(4)})`,
      });
    }
    return signals;
  }

  _detectVolumeShelf(candles, realFootprint) {
    const signals = [];
    const price = candles[candles.length - 1].close;

    if (realFootprint && realFootprint.priceVolume) {
      const avgVol = realFootprint.totalVolume / Math.max(Object.keys(realFootprint.priceVolume).length, 1);
      for (const [level, data] of Object.entries(realFootprint.priceVolume)) {
        const levelPrice = parseFloat(level);
        if (data.total > avgVol * 3) {
          const dist = Math.abs(price - levelPrice);
          const atr = this._estimateATR(candles);
          if (dist < atr * 0.5) {
            const direction = price > levelPrice ? 'bullish' : 'bearish';
            signals.push({
              type: 'VOLUME_SHELF', direction,
              action: direction === 'bullish' ? 'buy' : 'sell',
              confidence: 0.5, realData: true,
              reason: `Volume shelf at ${levelPrice.toFixed(4)}`,
            });
          }
        }
      }
    }
    return signals.slice(-2);
  }

  _divergenceStrength(deltas) {
    const max = Math.max(...deltas.map(Math.abs));
    if (max === 0) return 0;
    const last = Math.abs(deltas[deltas.length - 1]);
    const avg = deltas.reduce((a, b) => a + Math.abs(b), 0) / deltas.length;
    return Math.min(last / avg, 2.0);
  }

  _getDeltaTrend() {
    if (this.deltaHistory.length < 10) return 'neutral';
    const recent = this.deltaHistory.slice(-10).reduce((a, b) => a + b, 0);
    if (recent > 0) return 'bullish';
    if (recent < 0) return 'bearish';
    return 'neutral';
  }

  _estimateTickSize(candles) {
    const prices = candles.slice(-50).map(c => c.close);
    const diffs = [];
    for (let i = 1; i < prices.length; i++) {
      const diff = Math.abs(prices[i] - prices[i - 1]);
      if (diff > 0) diffs.push(diff);
    }
    if (diffs.length === 0) return 0.01;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)] || 0.01;
  }

  _estimateATR(candles, period = 14) {
    const tr = [];
    for (let i = Math.max(1, candles.length - period - 1); i < candles.length; i++) {
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    return tr.reduce((a, b) => a + b, 0) / tr.length;
  }
}
