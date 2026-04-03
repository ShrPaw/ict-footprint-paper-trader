// ═══════════════════════════════════════════════════════════════════
// Precompute.js — All indicators computed once, O(n) total
// ═══════════════════════════════════════════════════════════════════
//
// This module eliminates all redundant computation from the backtest loop.
// Every indicator is calculated exactly once before the loop starts.
// The loop performs only O(1) indexed lookups.
//
// Architecture:
//   Phase 1: computeIndicators()   — Pure math (EMAs, ATR, ADX, BB, delta)
//   Phase 2: extractFeatures()     — Domain logic (regime, FVGs, OBs, OTE, sweeps)
//   Phase 3: Backtest loop         — Indexed access only

import config from '../config.js';

// ═══════════════════════════════════════════════════════════════════
// PHASE 1: INDICATOR PRECOMPUTATION — O(n) each, called once
// ═══════════════════════════════════════════════════════════════════

/**
 * EMA array — O(n)
 * Returns array aligned with candles. Index 0 = candles[0].close (seed).
 */
export function computeEMA(candles, period) {
  const result = new Array(candles.length);
  const k = 2 / (period + 1);
  result[0] = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    result[i] = candles[i].close * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * SMA array — O(n) via rolling window
 */
export function computeSMA(data, period) {
  const result = new Array(data.length);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    result[i] = i >= period - 1 ? sum / period : null;
  }
  return result;
}

/**
 * ATR array — O(n) via running SMA of True Range
 */
export function computeATR(candles, period) {
  const tr = new Array(candles.length);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  }
  return computeSMA(tr, period);
}

/**
 * ADX array — O(n) via single-pass Wilder smoothing
 * Eliminates 5 separate loops from original implementation.
 */
export function computeADX(candles, period) {
  const n = candles.length;
  const plusDM = new Array(n);
  const minusDM = new Array(n);
  const tr = new Array(n);

  plusDM[0] = 0;
  minusDM[0] = 0;
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  // Wilder smoothing: first value = sum/period, subsequent = (prev * (period-1) + current) / period
  const smoothTR = new Array(n);
  const smoothPlus = new Array(n);
  const smoothMinus = new Array(n);
  const dx = new Array(n).fill(0);
  const adx = new Array(n).fill(null);

  // Seed with sum of first `period` values
  let sumTR = 0, sumPlus = 0, sumMinus = 0;
  for (let i = 0; i < period && i < n; i++) {
    sumTR += tr[i];
    sumPlus += plusDM[i];
    sumMinus += minusDM[i];
  }

  if (period <= n) {
    smoothTR[period - 1] = sumTR / period;
    smoothPlus[period - 1] = sumPlus / period;
    smoothMinus[period - 1] = sumMinus / period;

    const pDI = (smoothPlus[period - 1] / smoothTR[period - 1]) * 100;
    const mDI = (smoothMinus[period - 1] / smoothTR[period - 1]) * 100;
    const sum = pDI + mDI;
    dx[period - 1] = sum === 0 ? 0 : Math.abs(pDI - mDI) / sum * 100;
  }

  for (let i = period; i < n; i++) {
    smoothTR[i] = (smoothTR[i - 1] * (period - 1) + tr[i]) / period;
    smoothPlus[i] = (smoothPlus[i - 1] * (period - 1) + plusDM[i]) / period;
    smoothMinus[i] = (smoothMinus[i - 1] * (period - 1) + minusDM[i]) / period;

    const pDI = (smoothPlus[i] / smoothTR[i]) * 100;
    const mDI = (smoothMinus[i] / smoothTR[i]) * 100;
    const sum = pDI + mDI;
    dx[i] = sum === 0 ? 0 : Math.abs(pDI - mDI) / sum * 100;
  }

  // Smooth DX to get ADX
  let sumDX = 0;
  for (let i = period - 1; i < 2 * period - 1 && i < n; i++) {
    sumDX += dx[i];
  }
  if (2 * period - 1 <= n) {
    adx[2 * period - 2] = sumDX / period;
  }

  for (let i = 2 * period - 1; i < n; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }

  return adx;
}

/**
 * Bollinger Bands — O(n) via rolling window
 * Returns { upper[], middle[], lower[] }
 */
export function computeBollinger(candles, period, stdDev) {
  const n = candles.length;
  const middle = new Array(n).fill(null);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);

  // O(n) rolling: maintain sum and sum-of-squares for variance
  // var = E[x²] - E[x]² (no inner loop needed)
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = candles[i].close;
    sum += v;
    sumSq += v * v;
    if (i >= period) {
      const old = candles[i - period].close;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      middle[i] = mean;
      const variance = Math.max(0, sumSq / period - mean * mean);
      const std = Math.sqrt(variance);
      upper[i] = mean + stdDev * std;
      lower[i] = mean - stdDev * std;
    }
  }
  return { upper, middle, lower };
}

/**
 * Volume metrics — O(n) via rolling sum
 * Returns { avgVolume[], recentVolume[], volumeRatio[] }
 */
export function computeVolumeMetrics(candles, lookback = 20) {
  const n = candles.length;
  const avgVolume = new Array(n).fill(null);
  const volumeRatio = new Array(n).fill(null);

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += candles[i].volume;
    if (i >= lookback) sum -= candles[i - lookback].volume;
    if (i >= lookback - 1) {
      avgVolume[i] = sum / lookback;
      volumeRatio[i] = candles[i].volume / avgVolume[i];
    }
  }

  return { avgVolume, volumeRatio };
}

/**
 * Delta approximation — O(n)
 * Estimation from OHLCV: close position in range × volume.
 * Used when real trade-level data isn't available (backtests).
 */
export function computeDelta(candles) {
  const n = candles.length;
  const delta = new Array(n);
  const deltaPercent = new Array(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    if (range === 0 || c.volume === 0) {
      delta[i] = 0;
      deltaPercent[i] = 0;
    } else {
      const closePosition = (c.close - c.low) / range;
      delta[i] = (closePosition - 0.5) * 2 * c.volume;
      deltaPercent[i] = (closePosition - 0.5) * 200;
    }
  }
  return { delta, deltaPercent };
}

/**
 * Volume profile / POC — O(n × levels) computed per-window for footprint analysis
 * Lightweight: only aggregate, no per-candle recompute needed.
 */
export function computeVolumeProfile(candles) {
  let totalVolume = 0;
  const priceVolume = {};

  for (const c of candles) {
    const range = c.high - c.low;
    if (range === 0) continue;

    // Distribute volume evenly across price range (simplified)
    const tickSize = Math.max(range / 10, 0.01);
    const levels = Math.min(Math.ceil(range / tickSize), 100);
    const volPerLevel = c.volume / levels;

    let price = c.low;
    for (let l = 0; l < levels; l++) {
      const key = price.toFixed(6);
      if (!priceVolume[key]) priceVolume[key] = 0;
      priceVolume[key] += volPerLevel;
      price += tickSize;
    }
    totalVolume += c.volume;
  }

  let poc = null;
  let pocVol = 0;
  for (const [price, vol] of Object.entries(priceVolume)) {
    if (vol > pocVol) {
      pocVol = vol;
      poc = parseFloat(price);
    }
  }

  return { poc, pocVolume: pocVol, totalVolume, priceVolume };
}


// ═══════════════════════════════════════════════════════════════════
// PHASE 2: FEATURE EXTRACTION — Precompute domain logic arrays
// ═══════════════════════════════════════════════════════════════════

/**
 * Regime detection — O(n)
 * Returns regime[] aligned with 1h candle index.
 * Each element: { regime, confidence, scores } or null (before warmup).
 */
export function extractRegimes(candles1h, indicators1h) {
  const n = candles1h.length;
  const regime = new Array(n).fill(null);
  const warmup = 50; // minimum candles for reliable regime detection

  for (let i = warmup; i < n; i++) {
    regime[i] = _classifyRegime(
      candles1h[i], i,
      indicators1h.ema9, indicators1h.ema21, indicators1h.ema50,
      indicators1h.atr, indicators1h.adx, indicators1h.bollinger,
      candles1h
    );
  }
  return regime;
}

/**
 * Fair Value Gaps — O(n)
 * Returns { fvgSignals[], fvgState[] }
 * - fvgSignals[i] = array of FVG signals active at candle index i
 * - fvgState[i] = latest FVG fill signal (or null)
 */
export function extractFVGs(candles1h) {
  const n = candles1h.length;
  const allFVGs = []; // persistent pool of FVGs
  const fvgSignals = new Array(n).fill(null);
  const minGap = config.ict.fvgMinSize;

  for (let i = 2; i < n; i++) {
    const c1 = candles1h[i - 2];
    const c3 = candles1h[i];
    const price = candles1h[i].close;

    // Detect new FVG from this pattern
    if (c1.high < c3.low) {
      const gapSize = (c3.low - c1.high) / c1.high;
      if (gapSize >= minGap) {
        allFVGs.push({
          type: 'FVG', direction: 'bullish',
          top: c3.low, bottom: c1.high,
          size: gapSize, createdIndex: i,
          confidence: _fvgConfidence(gapSize, candles1h, i),
        });
      }
    }
    if (c1.low > c3.high) {
      const gapSize = (c1.low - c3.high) / c3.high;
      if (gapSize >= minGap) {
        allFVGs.push({
          type: 'FVG', direction: 'bearish',
          top: c1.low, bottom: c3.high,
          size: gapSize, createdIndex: i,
          confidence: _fvgConfidence(gapSize, candles1h, i),
        });
      }
    }

    // Check which FVGs the current price is filling
    const signals = [];
    for (const fvg of allFVGs) {
      if (fvg.tested) continue;

      if (price >= fvg.bottom && price <= fvg.top) {
        signals.push({
          type: 'FVG',
          direction: fvg.direction,
          action: fvg.direction === 'bullish' ? 'buy' : 'sell',
          confidence: fvg.confidence,
          reason: `Price filling ${fvg.direction} FVG`,
        });
        fvg.tested = true;
      }

      // Price has moved past the FVG entirely — mark tested
      if (fvg.direction === 'bullish' && price > fvg.top) fvg.tested = true;
      if (fvg.direction === 'bearish' && price < fvg.bottom) fvg.tested = true;
    }

    fvgSignals[i] = signals.length > 0 ? signals : null;
  }

  return fvgSignals;
}

/**
 * Order Blocks — O(n × lookback)
 * Returns orderBlockSignals[i] = OB signals at candle index i (or null)
 */
export function extractOrderBlocks(candles1h) {
  const n = candles1h.length;
  const allOBs = [];
  const obSignals = new Array(n).fill(null);
  const lookback = config.ict.orderBlockLookback;

  for (let i = 1; i < n; i++) {
    const candle = candles1h[i - 1];
    const next = candles1h[i];

    // Bullish OB: bearish candle before strong bullish move
    if (candle.close < candle.open && next.close > next.open) {
      const move = (next.close - next.open) / next.open;
      if (move > 0.003) {
        allOBs.push({
          type: 'ORDER_BLOCK', direction: 'bullish',
          top: candle.high, bottom: candle.low,
          createdIndex: i, strength: move,
          // Calibrate: map 0.3%-2% moves to 0.50-1.0 confidence range
          confidence: Math.min(0.5 + (move - 0.003) / 0.017 * 0.5, 1.0),
        });
      }
    }

    // Bearish OB: bullish candle before strong bearish move
    if (candle.close > candle.open && next.close < next.open) {
      const move = (next.open - next.close) / next.open;
      if (move > 0.003) {
        allOBs.push({
          type: 'ORDER_BLOCK', direction: 'bearish',
          top: candle.high, bottom: candle.low,
          createdIndex: i, strength: move,
          confidence: Math.min(0.5 + (move - 0.003) / 0.017 * 0.5, 1.0),
        });
      }
    }

    // Prune: only keep OBs within lookback window
    const cutoff = i - lookback;
    while (allOBs.length > 0 && allOBs[0].createdIndex < cutoff) {
      allOBs.shift();
    }

    // Check active OBs against current price
    const price = candles1h[i].close;
    const signals = [];

    for (const ob of allOBs) {
      if (ob.mitigated) continue;

      if (price <= ob.top && price >= ob.bottom && ob.direction === 'bullish') {
        signals.push({
          type: 'ORDER_BLOCK', direction: 'bullish',
          action: 'buy', confidence: ob.confidence * 0.5, // penalty: OB alone is weak
          reason: 'Price at bullish order block',
        });
      }
      if (price >= ob.bottom && price <= ob.top && ob.direction === 'bearish') {
        signals.push({
          type: 'ORDER_BLOCK', direction: 'bearish',
          action: 'sell', confidence: ob.confidence * 0.5,
          reason: 'Price at bearish order block',
        });
      }

      // Mark mitigated
      if (ob.direction === 'bullish' && price < ob.bottom) ob.mitigated = true;
      if (ob.direction === 'bearish' && price > ob.top) ob.mitigated = true;
    }

    obSignals[i] = signals.length > 0 ? signals : null;
  }

  return obSignals;
}

/**
 * Liquidity Sweeps — O(n × lookback) per sweep detection window
 * Returns sweepSignals[i] = sweep signals at candle index i (or null)
 */
export function extractLiquiditySweeps(candles1h) {
  const n = candles1h.length;
  const sweepSignals = new Array(n).fill(null);
  const minWickRatio = config.ict.liquiditySweepWickRatio;

  for (let i = 10; i < n; i++) {
    const c = candles1h[i];
    const range = c.high - c.low;
    if (range === 0) continue;

    const signals = [];

    // Bullish sweep: low below recent lows, long lower wick, closes higher
    const recentLows = [];
    for (let j = Math.max(0, i - 10); j < i; j++) recentLows.push(candles1h[j].low);
    if (recentLows.length > 0) {
      const eqLow = Math.min(...recentLows);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const wickRatio = lowerWick / range;

      if (c.low < eqLow && wickRatio >= minWickRatio && c.close > eqLow) {
        signals.push({
          type: 'LIQUIDITY_SWEEP', direction: 'bullish',
          action: 'buy',
          // Calibrate: map wickRatio 0.6-1.0 to confidence 0.65-1.0
          confidence: Math.min(0.65 + (wickRatio - 0.6) / 0.4 * 0.35, 1.0),
          reason: `Bullish liquidity sweep below ${eqLow.toFixed(4)}`,
        });
      }
    }

    // Bearish sweep
    const recentHighs = [];
    for (let j = Math.max(0, i - 10); j < i; recentHighs.push(candles1h[j].high), j++);
    if (recentHighs.length > 0) {
      const eqHigh = Math.max(...recentHighs);
      const upperWick = c.high - Math.max(c.open, c.close);
      const upperWickRatio = upperWick / range;

      if (c.high > eqHigh && upperWickRatio >= minWickRatio && c.close < eqHigh) {
        signals.push({
          type: 'LIQUIDITY_SWEEP', direction: 'bearish',
          action: 'sell',
          confidence: Math.min(0.65 + (upperWickRatio - 0.6) / 0.4 * 0.35, 1.0),
          reason: `Bearish liquidity sweep above ${eqHigh.toFixed(4)}`,
        });
      }
    }

    sweepSignals[i] = signals.length > 0 ? signals : null;
  }

  return sweepSignals;
}

/**
 * Optimal Trade Entry zones — O(n × lookback)
 * Returns oteSignals[i] = OTE signals at candle index i (or null)
 */
export function extractOTEs(candles1h) {
  const n = candles1h.length;
  const oteSignals = new Array(n).fill(null);

  for (let i = 11; i < n; i++) {
    const signals = [];
    const price = candles1h[i].close;

    // Check last 10 candles for impulse moves
    for (let j = Math.max(10, i - 20); j < i; j++) {
      const impulse = candles1h[j];
      const moveSize = Math.abs(impulse.close - impulse.open) / impulse.open;
      if (moveSize <= 0.005) continue;

      const lookbackSlice = candles1h.slice(Math.max(0, j - 10), j);

      if (impulse.close > impulse.open) {
        const low = Math.min(...lookbackSlice.map(c => c.low));
        const high = impulse.high;
        const range = high - low;
        const ote618 = high - range * config.ict.oteRetracement.min;
        const ote786 = high - range * config.ict.oteRetracement.max;

        if (price >= ote786 && price <= ote618) {
          signals.push({
            type: 'OTE', direction: 'bullish', action: 'buy',
            confidence: 0.8,
            reason: `Price in bullish OTE zone (${ote786.toFixed(4)} - ${ote618.toFixed(4)})`,
          });
        }
      } else {
        const high = Math.max(...lookbackSlice.map(c => c.high));
        const low = impulse.low;
        const range = high - low;
        const ote618 = low + range * config.ict.oteRetracement.min;
        const ote786 = low + range * config.ict.oteRetracement.max;

        if (price >= ote618 && price <= ote786) {
          signals.push({
            type: 'OTE', direction: 'bearish', action: 'sell',
            confidence: 0.8,
            reason: `Price in bearish OTE zone (${ote618.toFixed(4)} - ${ote786.toFixed(4)})`,
          });
        }
      }
    }

    oteSignals[i] = signals.length > 0 ? signals.slice(0, 2) : null; // max 2 OTE signals
  }

  return oteSignals;
}


// ═══════════════════════════════════════════════════════════════════
// PHASE 2b: INCREMENTAL FEATURE UPDATES — O(1) per step
// For live trading / real-time signal evaluation
// ═══════════════════════════════════════════════════════════════════

/**
 * Incremental feature state — maintains current feature values without recomputation.
 * Used by live bots where you can't precompute future candles.
 */
export class IncrementalFeatureState {
  constructor() {
    this.activeFVGs = [];
    this.activeOBs = [];
    this.lastFVGSignal = null;
    this.lastOBSignal = null;
    this.lastSweepSignal = null;
    this.lastOTESignal = null;
    this.fvgMinGap = config.ict.fvgMinSize;
    this.obLookback = config.ict.orderBlockLookback;
    this.sweepMinWick = config.ict.liquiditySweepWickRatio;
    this.obIndex = 0;
  }

  /**
   * Call once per new 1h candle close. O(1) amortized.
   */
  update(candles1h, index) {
    if (index < 2) return;

    const c1 = candles1h[index - 2];
    const c3 = candles1h[index];
    const price = candles1h[index].close;

    // FVG detection
    if (c1.high < c3.low) {
      const gapSize = (c3.low - c1.high) / c1.high;
      if (gapSize >= this.fvgMinGap) {
        this.activeFVGs.push({
          direction: 'bullish', top: c3.low, bottom: c1.high,
          size: gapSize, confidence: _fvgConfidence(gapSize, candles1h, index),
          tested: false,
        });
      }
    }
    if (c1.low > c3.high) {
      const gapSize = (c1.low - c3.high) / c3.high;
      if (gapSize >= this.fvgMinGap) {
        this.activeFVGs.push({
          direction: 'bearish', top: c1.low, bottom: c3.high,
          size: gapSize, confidence: _fvgConfidence(gapSize, candles1h, index),
          tested: false,
        });
      }
    }

    // Check FVG fills
    const fvgSignals = [];
    this.activeFVGs = this.activeFVGs.filter(fvg => {
      if (fvg.tested) return false;
      if (price >= fvg.bottom && price <= fvg.top) {
        fvgSignals.push({
          type: 'FVG', direction: fvg.direction,
          action: fvg.direction === 'bullish' ? 'buy' : 'sell',
          confidence: fvg.confidence,
          reason: `Price filling ${fvg.direction} FVG`,
        });
        return false;
      }
      if (fvg.direction === 'bullish' && price > fvg.top) return false;
      if (fvg.direction === 'bearish' && price < fvg.bottom) return false;
      // Prune old FVGs
      if (index - fvg.createdIndex > 500) return false;
      return true;
    });
    this.lastFVGSignal = fvgSignals.length > 0 ? fvgSignals : null;

    // OB detection
    if (index > 0) {
      const candle = candles1h[index - 1];
      const next = candles1h[index];

      if (candle.close < candle.open && next.close > next.open) {
        const move = (next.close - next.open) / next.open;
        if (move > 0.003) {
          this.activeOBs.push({
            direction: 'bullish', top: candle.high, bottom: candle.low,
            createdIndex: index, confidence: Math.min(0.5 + (move - 0.003) / 0.017 * 0.5, 1.0),
            mitigated: false,
          });
        }
      }
      if (candle.close > candle.open && next.close < next.open) {
        const move = (next.open - next.close) / next.open;
        if (move > 0.003) {
          this.activeOBs.push({
            direction: 'bearish', top: candle.high, bottom: candle.low,
            createdIndex: index, confidence: Math.min(0.5 + (move - 0.003) / 0.017 * 0.5, 1.0),
            mitigated: false,
          });
        }
      }
    }

    // Prune old OBs
    this.activeOBs = this.activeOBs.filter(ob => ob.createdIndex >= index - this.obLookback);

    // Check OB signals
    const obSignals = [];
    for (const ob of this.activeOBs) {
      if (ob.mitigated) continue;
      if (price <= ob.top && price >= ob.bottom && ob.direction === 'bullish') {
        obSignals.push({
          type: 'ORDER_BLOCK', direction: 'bullish', action: 'buy',
          confidence: ob.confidence * 0.5,
          reason: 'Price at bullish order block',
        });
      }
      if (price >= ob.bottom && price <= ob.top && ob.direction === 'bearish') {
        obSignals.push({
          type: 'ORDER_BLOCK', direction: 'bearish', action: 'sell',
          confidence: ob.confidence * 0.5,
          reason: 'Price at bearish order block',
        });
      }
      if (ob.direction === 'bullish' && price < ob.bottom) ob.mitigated = true;
      if (ob.direction === 'bearish' && price > ob.top) ob.mitigated = true;
    }
    this.lastOBSignal = obSignals.length > 0 ? obSignals : null;
  }

  getCurrentSignals() {
    return {
      fvgSignals: this.lastFVGSignal,
      obSignals: this.lastOBSignal,
    };
  }
}


// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

function _classifyRegime(candle, i, ema9Arr, ema21Arr, ema50Arr, atrArr, adxArr, bbArr, candles) {
  const price = candle.close;
  const atrPercent = atrArr[i] / price;
  const currentADX = adxArr[i] || 0;

  // ATR percentile (relative to last 50 candles)
  let atrRank = 0;
  const lookStart = Math.max(0, i - 50);
  for (let j = lookStart; j <= i; j++) {
    if (atrArr[j] / candles[j].close <= atrPercent) atrRank++;
  }
  const atrPercentile = atrRank / (i - lookStart + 1);

  // EMA alignment
  const e9 = ema9Arr[i], e21 = ema21Arr[i], e50 = ema50Arr[i];
  const bullishAlignment = e9 > e21 && e21 > e50;
  const bearishAlignment = e9 < e21 && e21 < e50;

  // Bollinger squeeze
  const bbUpper = bbArr.upper[i];
  const bbLower = bbArr.lower[i];
  const bbMiddle = bbArr.middle[i];
  const bbWidth = (bbUpper - bbLower) / bbMiddle;
  const inSqueeze = bbWidth < config.regime.bollingerSqueeze;

  // Range detection
  const rangeLookback = config.regime.rangeLookback;
  const rStart = Math.max(0, i - rangeLookback);
  let rangeHigh = -Infinity, rangeLow = Infinity;
  for (let j = rStart; j <= i; j++) {
    if (candles[j].high > rangeHigh) rangeHigh = candles[j].high;
    if (candles[j].low < rangeLow) rangeLow = candles[j].low;
  }
  const rangeSize = (rangeHigh - rangeLow) / rangeLow;
  const inRange = rangeSize < 0.03 && !inSqueeze;

  // Volume ratio (last 3 vs last 20)
  let avgVol = 0, recentVol = 0;
  const vStart = Math.max(0, i - 19);
  for (let j = vStart; j <= i; j++) avgVol += candles[j].volume;
  avgVol /= (i - vStart + 1);
  for (let j = Math.max(0, i - 2); j <= i; j++) recentVol += candles[j].volume;
  recentVol /= Math.min(3, i + 1);
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;

  // Recent range for absorption
  const absStart = Math.max(0, i - 4);
  let absHigh = -Infinity, absLow = Infinity;
  for (let j = absStart; j <= i; j++) {
    if (candles[j].high > absHigh) absHigh = candles[j].high;
    if (candles[j].low < absLow) absLow = candles[j].low;
  }
  const recentRange = (absHigh - absLow) / price;

  // Scoring
  const scores = {
    TRENDING_UP: 0, TRENDING_DOWN: 0, RANGING: 0,
    VOL_EXPANSION: 0, LOW_VOL: 0, ABSORPTION: 0,
  };

  // Volatility
  if (atrPercentile <= config.regime.lowVolPercentile / 100) scores.LOW_VOL += 3;
  if (atrPercentile >= config.regime.highVolPercentile / 100) scores.VOL_EXPANSION += 3;
  if (inSqueeze) { scores.LOW_VOL += 2; scores.VOL_EXPANSION += 1; }

  // Trend
  if (currentADX > config.regime.strongTrendThreshold) {
    if (price > e50 && bullishAlignment) scores.TRENDING_UP += 4;
    if (price < e50 && bearishAlignment) scores.TRENDING_DOWN += 4;
  } else if (currentADX > config.regime.trendThreshold) {
    if (price > e21) scores.TRENDING_UP += 2;
    if (price < e21) scores.TRENDING_DOWN += 2;
  }

  // Range
  if (inRange) scores.RANGING += 3;
  if (currentADX < config.regime.trendThreshold) scores.RANGING += 1;

  // Absorption / Volume expansion
  if (volumeRatio > 1.5 && recentRange < 0.005) scores.ABSORPTION += 3;
  if (volumeRatio > 2.0 && atrPercentile > 0.5) scores.VOL_EXPANSION += 2;

  // Pick winner
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [regime, score] = sorted[0];
  const confidence = Math.min(score / 7, 1.0);

  return { regime, confidence, scores };
}

function _fvgConfidence(gapSize, candles, index) {
  let score = 0.4;
  if (gapSize > 0.005) score += 0.2;
  if (gapSize > 0.01) score += 0.1;
  const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  if (candles[index].volume > avgVol) score += 0.15;
  const recency = 1 - (candles.length - index) / candles.length;
  score += recency * 0.15;
  return Math.min(score, 1.0);
}
