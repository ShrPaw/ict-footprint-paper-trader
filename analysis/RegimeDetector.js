import config from '../config.js';

// Market states
export const Regime = {
  TRENDING_UP:    'TRENDING',
  TRENDING_DOWN:  'TRENDING',
  RANGING:        'RANGING',
  VOL_EXPANSION:  'VOL_EXPANSION',
  LOW_VOL:        'LOW_VOL',
  ABSORPTION:     'ABSORPTION',
};

/**
 * RegimeDetector — Dual-mode: precomputed (backtest) and live (incremental).
 *
 * BACKTEST MODE: Use extractRegimes() from Precompute.js — all regimes precomputed.
 * This class provides getRegime(i) as a precomputed lookup.
 *
 * LIVE MODE: Call detect() as before — runs on each new candle for real-time regime.
 */
export default class RegimeDetector {
  constructor() {
    this.currentRegime = {};
    this.regimeHistory = {};
    // Precomputed regime array (set by setPrecomputedRegimes)
    this._precomputed = null;
  }

  /**
   * Set precomputed regimes from Precompute.extractRegimes().
   * After this, getRegimeByIndex(i) returns O(1) lookups.
   */
  setPrecomputedRegimes(regimeArray) {
    this._precomputed = regimeArray;
  }

  /**
   * O(1) lookup for precomputed regime at index i.
   * Use in backtest loop.
   */
  getRegimeByIndex(i) {
    if (!this._precomputed || !this._precomputed[i]) {
      return { regime: Regime.LOW_VOL, confidence: 0 };
    }
    return this._precomputed[i];
  }

  /**
   * Live mode: detect regime from current candle window.
   * Used by live bots (BotRunner). NOT used in backtest.
   */
  detect(symbol, candles) {
    if (!candles || candles.length < 50) return { regime: Regime.LOW_VOL, confidence: 0 };

    const n = candles.length;
    const i = n - 1;
    const candle = candles[i];
    const price = candle.close;

    // Extract closes, highs, lows, volumes (only last 50 + period needed)
    const lookStart = Math.max(0, n - 70);

    // EMA calculation (only need final values)
    const ema9 = this._lastEMA(candles, 9, lookStart);
    const ema21 = this._lastEMA(candles, 21, lookStart);
    const ema50 = this._lastEMA(candles, 50, lookStart);

    // ATR (last value)
    const atr = this._lastATR(candles, config.regime.atrPeriod);
    const atrPercent = atr / price;

    // ATR percentile
    let atrRank = 0;
    for (let j = Math.max(0, i - 50); j <= i; j++) {
      const a = this._lastATR(candles.slice(0, j + 1), config.regime.atrPeriod);
      if (a / candles[j].close <= atrPercent) atrRank++;
    }
    const atrPercentile = atrRank / Math.min(51, i + 1);

    // ADX
    const currentADX = this._lastADX(candles, config.regime.adxPeriod);

    // Bollinger
    const bb = this._lastBollinger(candles, 20, 2);
    const bbWidth = (bb.upper - bb.lower) / bb.middle;
    const inSqueeze = bbWidth < config.regime.bollingerSqueeze;

    // Range
    const rangeLookback = config.regime.rangeLookback;
    const rStart = Math.max(0, i - rangeLookback);
    let rangeHigh = -Infinity, rangeLow = Infinity;
    for (let j = rStart; j <= i; j++) {
      if (candles[j].high > rangeHigh) rangeHigh = candles[j].high;
      if (candles[j].low < rangeLow) rangeLow = candles[j].low;
    }
    const rangeSize = (rangeHigh - rangeLow) / rangeLow;
    const inRange = rangeSize < 0.03 && !inSqueeze;

    // Volume
    const vStart = Math.max(0, n - 20);
    let avgVol = 0;
    for (let j = vStart; j < n; j++) avgVol += candles[j].volume;
    avgVol /= (n - vStart);
    let recentVol = 0;
    for (let j = Math.max(0, n - 3); j < n; j++) recentVol += candles[j].volume;
    recentVol /= Math.min(3, n);
    const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;

    // Recent range
    const absStart = Math.max(0, n - 5);
    let absHigh = -Infinity, absLow = Infinity;
    for (let j = absStart; j < n; j++) {
      if (candles[j].high > absHigh) absHigh = candles[j].high;
      if (candles[j].low < absLow) absLow = candles[j].low;
    }
    const recentRange = (absHigh - absLow) / price;

    // Alignment
    const bullishAlignment = ema9 > ema21 && ema21 > ema50;
    const bearishAlignment = ema9 < ema21 && ema21 < ema50;

    // Scoring (same as Precompute._classifyRegime)
    const scores = {
      TRENDING_UP: 0, TRENDING_DOWN: 0, RANGING: 0,
      VOL_EXPANSION: 0, LOW_VOL: 0, ABSORPTION: 0,
    };

    if (atrPercentile <= config.regime.lowVolPercentile / 100) scores.LOW_VOL += 3;
    if (atrPercentile >= config.regime.highVolPercentile / 100) scores.VOL_EXPANSION += 3;
    if (inSqueeze) { scores.LOW_VOL += 2; scores.VOL_EXPANSION += 1; }
    if (currentADX > config.regime.strongTrendThreshold) {
      if (price > ema50 && bullishAlignment) scores.TRENDING_UP += 4;
      if (price < ema50 && bearishAlignment) scores.TRENDING_DOWN += 4;
    } else if (currentADX > config.regime.trendThreshold) {
      if (price > ema21) scores.TRENDING_UP += 2;
      if (price < ema21) scores.TRENDING_DOWN += 2;
    }
    if (inRange) scores.RANGING += 3;
    if (currentADX < config.regime.trendThreshold) scores.RANGING += 1;
    if (volumeRatio > 1.5 && recentRange < 0.005) scores.ABSORPTION += 3;
    if (volumeRatio > 2.0 && atrPercentile > 0.5) scores.VOL_EXPANSION += 2;

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [regime, score] = sorted[0];
    const confidence = Math.min(score / 7, 1.0);

    const result = {
      regime,
      confidence,
      metrics: {
        adx: currentADX?.toFixed(1),
        atrPercent: (atrPercent * 100).toFixed(3),
        atrPercentile: (atrPercentile * 100).toFixed(0),
        bbWidth: (bbWidth * 100).toFixed(2),
        volumeRatio: volumeRatio.toFixed(2),
        emaAlignment: bullishAlignment ? 'bullish' : bearishAlignment ? 'bearish' : 'mixed',
        price,
      },
      scores,
    };

    this.currentRegime[symbol] = result;
    return result;
  }

  getRegime(symbol) {
    return this.currentRegime[symbol] || { regime: Regime.LOW_VOL, confidence: 0 };
  }

  // ── Lightweight indicator helpers for live mode (not used in backtest) ──

  _lastEMA(candles, period, startIdx = 0) {
    const k = 2 / (period + 1);
    let ema = candles[startIdx].close;
    for (let i = startIdx + 1; i < candles.length; i++) {
      ema = candles[i].close * k + ema * (1 - k);
    }
    return ema;
  }

  _lastATR(candles, period) {
    const start = Math.max(1, candles.length - period - 1);
    let sum = 0;
    for (let i = start; i < candles.length; i++) {
      sum += Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
    }
    return sum / (candles.length - start);
  }

  _lastADX(candles, period) {
    // Simplified: compute ADX from last 2*period candles
    // For full accuracy, use Precompute.computeADX()
    const n = candles.length;
    if (n < period * 2 + 1) return 0;

    let plusDI = 0, minusDI = 0;
    // Just compute last DI values (not full ADX smoothing)
    let sumTR = 0, sumPlus = 0, sumMinus = 0;
    const start = Math.max(1, n - period);

    for (let i = start; i < n; i++) {
      const upMove = candles[i].high - candles[i - 1].high;
      const downMove = candles[i - 1].low - candles[i].low;
      sumPlus += upMove > downMove && upMove > 0 ? upMove : 0;
      sumMinus += downMove > upMove && downMove > 0 ? downMove : 0;
      sumTR += Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
    }

    if (sumTR === 0) return 0;
    plusDI = (sumPlus / sumTR) * 100;
    minusDI = (sumMinus / sumTR) * 100;
    const diSum = plusDI + minusDI;
    return diSum === 0 ? 0 : Math.abs(plusDI - minusDI) / diSum * 100;
  }

  _lastBollinger(candles, period, stdDev) {
    const n = candles.length;
    const start = Math.max(0, n - period);
    let sum = 0;
    for (let i = start; i < n; i++) sum += candles[i].close;
    const middle = sum / (n - start);

    let varSum = 0;
    for (let i = start; i < n; i++) {
      const diff = candles[i].close - middle;
      varSum += diff * diff;
    }
    const std = Math.sqrt(varSum / (n - start));
    return {
      upper: middle + stdDev * std,
      middle,
      lower: middle - stdDev * std,
    };
  }
}
