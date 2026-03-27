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

export default class RegimeDetector {
  constructor() {
    this.currentRegime = {};
    this.regimeHistory = {};
  }

  detect(symbol, candles) {
    if (!candles || candles.length < 50) return { regime: Regime.LOW_VOL, confidence: 0 };

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // ── 1. Volatility Analysis (ATR-based) ──────────────────────────
    const atr = this._calcATR(highs, lows, closes, config.regime.atrPeriod);
    const atrPercent = atr[atr.length - 1] / closes[closes.length - 1];
    const atrHistory = atr.slice(-50).map(a => a / closes[closes.length - 1]);
    const atrSorted = [...atrHistory].sort((a, b) => a - b);
    const atrPercentile = atrSorted.indexOf(atrPercent) / atrSorted.length;

    // ── 2. Trend Analysis (EMA + ADX) ───────────────────────────────
    const ema9 = this._ema(closes, 9);
    const ema21 = this._ema(closes, 21);
    const ema50 = this._ema(closes, 50);
    const adx = this._calcADX(highs, lows, closes, config.regime.adxPeriod);

    const currentADX = adx[adx.length - 1];
    const currentEMA9 = ema9[ema9.length - 1];
    const currentEMA21 = ema21[ema21.length - 1];
    const currentEMA50 = ema50[ema50.length - 1];
    const price = closes[closes.length - 1];

    // ── 3. Range Detection (Bollinger + price action) ───────────────
    const bb = this._bollinger(closes, 20, 2);
    const bbWidth = (bb.upper[bb.upper.length - 1] - bb.lower[bb.lower.length - 1]) / bb.middle[bb.middle.length - 1];
    const inSqueeze = bbWidth < config.regime.bollingerSqueeze;

    // Check if price is ranging (staying within recent high/low)
    const lookback = config.regime.rangeLookback;
    const recentHighs = highs.slice(-lookback);
    const recentLows = lows.slice(-lookback);
    const rangeHigh = Math.max(...recentHighs);
    const rangeLow = Math.min(...recentLows);
    const rangeSize = (rangeHigh - rangeLow) / rangeLow;
    const inRange = rangeSize < 0.03 && !inSqueeze; // < 3% range and not in squeeze

    // ── 4. Volume Analysis ──────────────────────────────────────────
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const recentVolume = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const volumeRatio = recentVolume / avgVolume;

    // ── 5. EMA Alignment ────────────────────────────────────────────
    const bullishAlignment = currentEMA9 > currentEMA21 && currentEMA21 > currentEMA50;
    const bearishAlignment = currentEMA9 < currentEMA21 && currentEMA21 < currentEMA50;

    // ── Score each regime ───────────────────────────────────────────
    const scores = {
      TRENDING_UP: 0,
      TRENDING_DOWN: 0,
      RANGING: 0,
      VOL_EXPANSION: 0,
      LOW_VOL: 0,
      ABSORPTION: 0,
    };

    // Volatility scores
    if (atrPercentile <= config.regime.lowVolPercentile / 100) scores.LOW_VOL += 3;
    if (atrPercentile >= config.regime.highVolPercentile / 100) scores.VOL_EXPANSION += 3;
    if (inSqueeze) { scores.LOW_VOL += 2; scores.VOL_EXPANSION += 1; } // squeeze = coiled spring

    // Trend scores
    if (currentADX > config.regime.strongTrendThreshold) {
      if (price > currentEMA50 && bullishAlignment) scores.TRENDING_UP += 4;
      if (price < currentEMA50 && bearishAlignment) scores.TRENDING_DOWN += 4;
    } else if (currentADX > config.regime.trendThreshold) {
      if (price > currentEMA21) scores.TRENDING_UP += 2;
      if (price < currentEMA21) scores.TRENDING_DOWN += 2;
    }

    // Range scores
    if (inRange) scores.RANGING += 3;
    if (currentADX < config.regime.trendThreshold) scores.RANGING += 1;

    // Absorption: high volume but low price movement = absorption
    const recentRange = (Math.max(...highs.slice(-5)) - Math.min(...lows.slice(-5))) / price;
    if (volumeRatio > 1.5 && recentRange < 0.005) scores.ABSORPTION += 3;

    // Volume expansion
    if (volumeRatio > 2.0 && atrPercentile > 0.5) scores.VOL_EXPANSION += 2;

    // ── Pick winner ─────────────────────────────────────────────────
    const sortedRegimes = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [regime, score] = sortedRegimes[0];
    const maxPossible = 7;
    const confidence = Math.min(score / maxPossible, 1.0);

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

  // ── Technical Indicators ──────────────────────────────────────────

  _ema(data, period) {
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  _sma(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      const slice = data.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
    return result;
  }

  _calcATR(highs, lows, closes, period) {
    const tr = [highs[0] - lows[0]];
    for (let i = 1; i < highs.length; i++) {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
    }
    return this._sma(tr, period);
  }

  _calcADX(highs, lows, closes, period) {
    // Simplified ADX calculation
    const plusDM = [];
    const minusDM = [];
    const tr = [highs[0] - lows[0]];

    for (let i = 1; i < highs.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
    }

    const smoothPlus = this._sma(plusDM, period);
    const smoothMinus = this._sma(minusDM, period);
    const smoothTR = this._sma(tr, period);

    const dx = [];
    for (let i = 0; i < smoothPlus.length; i++) {
      if (!smoothPlus[i] || !smoothMinus[i] || !smoothTR[i]) { dx.push(0); continue; }
      const plusDI = (smoothPlus[i] / smoothTR[i]) * 100;
      const minusDI = (smoothMinus[i] / smoothTR[i]) * 100;
      const diSum = plusDI + minusDI;
      dx.push(diSum === 0 ? 0 : Math.abs(plusDI - minusDI) / diSum * 100);
    }

    return this._sma(dx, period);
  }

  _bollinger(closes, period, stdDev) {
    const sma = this._sma(closes, period);
    const upper = [];
    const lower = [];
    const middle = sma;

    for (let i = 0; i < closes.length; i++) {
      if (sma[i] === null) { upper.push(null); lower.push(null); continue; }
      const slice = closes.slice(Math.max(0, i - period + 1), i + 1);
      const mean = sma[i];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / slice.length;
      const std = Math.sqrt(variance);
      upper.push(mean + stdDev * std);
      lower.push(mean - stdDev * std);
    }

    return { upper, middle, lower };
  }
}
