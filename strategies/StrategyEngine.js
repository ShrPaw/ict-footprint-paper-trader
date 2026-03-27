import config from '../config.js';
import { Regime } from '../analysis/RegimeDetector.js';

export default class StrategyEngine {
  constructor(regimeDetector, ictAnalyzer, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.ict = ictAnalyzer;
    this.footprint = footprintAnalyzer;
    this.lastSignalTime = {};
  }

  generateSignal(symbol, candles) {
    // 1. Check if we're in a killzone
    const inKillzone = this._checkKillzone();
    if (!inKillzone.allowed && inKillzone.strict) {
      return null; // outside trading hours
    }

    // 2. Detect current regime
    const regimeResult = this.regime.detect(symbol, candles);
    const regime = regimeResult.regime;

    // 3. Run ICT analysis
    const ictResult = this.ict.analyze(symbol, candles);

    // 4. Run Footprint analysis
    const footprintResult = this.footprint.analyze(symbol, candles);

    // 5. Combine signals based on regime
    const combined = this._combineSignals(
      regime,
      ictResult,
      footprintResult,
      regimeResult,
      inKillzone
    );

    // 6. Apply regime-specific filters
    const filtered = this._applyRegimeFilters(combined, regime, regimeResult, candles);

    // 7. Rate limit — don't spam signals
    if (filtered && this._isRateLimited(symbol)) return null;

    if (filtered) {
      this.lastSignalTime[symbol] = Date.now();
    }

    return filtered;
  }

  // ── Signal Combination ───────────────────────────────────────────
  _combineSignals(regime, ict, footprint, regimeResult, killzone) {
    const allSignals = [...ict.signals, ...footprint.signals];
    if (allSignals.length === 0) return null;

    // Score each signal type by regime
    const scored = allSignals.map(sig => {
      let score = sig.confidence;

      // ICT signals get boost in trending and ranging regimes
      if (sig.type === 'FVG' || sig.type === 'ORDER_BLOCK' || sig.type === 'OTE') {
        if (regime === 'TRENDING') score *= 1.3;
        if (regime === 'RANGING') score *= 0.8;
      }

      // Liquidity sweeps are great in trending
      if (sig.type === 'LIQUIDITY_SWEEP') {
        if (regime === 'TRENDING') score *= 1.4;
        if (regime === 'LOW_VOL') score *= 0.6;
      }

      // Footprint signals get boost in low vol / absorption
      if (sig.type === 'ABSORPTION' || sig.type === 'DELTA_DIVERGENCE') {
        if (regime === 'LOW_VOL') score *= 1.3;
        if (regime === 'ABSORPTION') score *= 1.5;
      }

      if (sig.type === 'IMBALANCE') {
        if (regime === 'VOL_EXPANSION') score *= 1.4;
      }

      // Killzone boost
      if (killzone.overlap) score *= 1.2;
      else if (killzone.allowed) score *= 1.05;

      // Confidence bonus
      if (regimeResult.confidence > 0.7) score *= 1.1;

      return { ...sig, combinedScore: score };
    });

    // Pick the best signal
    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = scored[0];

    if (best.combinedScore < 0.4) return null;

    return best;
  }

  // ── Regime-Specific Filters ──────────────────────────────────────
  _applyRegimeFilters(signal, regime, regimeResult, candles) {
    if (!signal) return null;

    const price = candles[candles.length - 1].close;
    const riskParams = config.risk[regime] || config.risk.RANGING;

    // Low volatility: only take high-confidence, tight stops
    if (regime === 'LOW_VOL') {
      if (signal.confidence < 0.6) return null;
    }

    // Ranging: only trade at range extremes
    if (regime === 'RANGING') {
      // Check if price is near range high or low
      const highs = candles.slice(-20).map(c => c.high);
      const lows = candles.slice(-20).map(c => c.low);
      const rangeHigh = Math.max(...highs);
      const rangeLow = Math.min(...lows);
      const rangePosition = (price - rangeLow) / (rangeHigh - rangeLow);

      // In ranging, only buy near bottom (discount) and sell near top (premium)
      if (signal.action === 'buy' && rangePosition > 0.3) return null;
      if (signal.action === 'sell' && rangePosition < 0.7) return null;
    }

    // Trending: must align with trend direction
    if (regime === 'TRENDING') {
      const ema21 = this._emaValue(candles.map(c => c.close), 21);
      if (signal.action === 'buy' && price < ema21) return null;
      if (signal.action === 'sell' && price > ema21) return null;
    }

    // Calculate SL/TP based on regime
    const atr = this._currentATR(candles);
    const sl = signal.action === 'buy'
      ? price - atr * riskParams.slMultiplier
      : price + atr * riskParams.slMultiplier;

    const tp = signal.action === 'buy'
      ? price + atr * riskParams.tpMultiplier
      : price - atr * riskParams.tpMultiplier;

    // Position sizing based on regime risk
    const accountBalance = 10000; // will be injected from engine
    const riskAmount = accountBalance * (riskParams.riskPercent / 100);
    const slDistance = Math.abs(price - sl);
    const size = slDistance > 0 ? riskAmount / slDistance : 0;

    return {
      ...signal,
      regime,
      regimeConfidence: regimeResult.confidence,
      price,
      stopLoss: sl,
      takeProfit: tp,
      size: Math.max(size, 0),
      riskParams,
    };
  }

  // ── Killzone Check ───────────────────────────────────────────────
  _checkKillzone() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const time = utcHour + utcMinutes / 60;

    const kz = config.killzones;

    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = time >= kz.asia.start && time < kz.asia.end;

    return {
      allowed: inLondon || inNY || inAsia,
      overlap: inOverlap,
      strict: !inAsia, // Asia zone is lenient (for low-vol regime)
      session: inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'none',
    };
  }

  // ── Rate Limiting ────────────────────────────────────────────────
  _isRateLimited(symbol) {
    const lastTime = this.lastSignalTime[symbol];
    if (!lastTime) return false;
    const cooldown = 60000; // 1 minute cooldown between signals
    return Date.now() - lastTime < cooldown;
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _emaValue(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  _currentATR(candles, period = 14) {
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    const recent = tr.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }
}
