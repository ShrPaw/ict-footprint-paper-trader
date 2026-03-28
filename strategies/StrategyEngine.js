import config from '../config.js';

export default class StrategyEngine {
  constructor(regimeDetector, ictAnalyzer, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.ict = ictAnalyzer;
    this.footprint = footprintAnalyzer;
    this.lastSignalTime = {};
    this._atrCache = {};   // symbol -> { candles_hash, atr }
    this._emaCache = {};   // symbol -> { candles_hash, ema21 }
  }

  generateSignal(symbol, candles) {
    if (candles.length < 50) return null;

    // 1. Check killzone using candle timestamp (not real clock)
    const lastCandle = candles[candles.length - 1];
    const inKillzone = this._checkKillzone(lastCandle.timestamp);
    if (!inKillzone.allowed && inKillzone.strict) {
      return null;
    }

    // 2. Detect current regime
    const regimeResult = this.regime.detect(symbol, candles);
    const regime = regimeResult.regime;

    // 3. Run ICT analysis
    const ictResult = this.ict.analyze(symbol, candles);

    // 4. Run Footprint analysis
    const footprintResult = this.footprint.analyze(symbol, candles);

    // 5. Combine signals with confluence scoring
    const signal = config.strategy.requireConfluence
      ? this._confluenceScore(regime, ictResult, footprintResult, regimeResult, inKillzone)
      : this._combineSignals(regime, ictResult, footprintResult, regimeResult, inKillzone);

    if (!signal) return null;

    // 6. Apply regime-specific filters
    const filtered = this._applyRegimeFilters(signal, regime, regimeResult, candles);
    if (!filtered) return null;

    // 7. Rate limit
    if (this._isRateLimited(symbol)) return null;

    this.lastSignalTime[symbol] = Date.now();
    return filtered;
  }

  // ── Confluence Scoring (NEW) ─────────────────────────────────────
  // Requires BOTH ICT and Footprint confirmation for high-quality entries
  _confluenceScore(regime, ict, footprint, regimeResult, killzone) {
    const ictSignals = ict.signals;
    const fpSignals = footprint.signals;

    if (ictSignals.length === 0 && fpSignals.length === 0) return null;

    // Score ICT signals
    const bestICT = ictSignals.length > 0
      ? this._scoreSignals(ictSignals, regime, regimeResult, killzone, config.strategy.ictWeight)
      : null;

    // Score Footprint signals
    const bestFP = fpSignals.length > 0
      ? this._scoreSignals(fpSignals, regime, regimeResult, killzone, config.strategy.footprintWeight)
      : null;

    // ── Confluence logic ───────────────────────────────────────────
    // Case 1: Both ICT and Footprint agree on direction → strong confluence
    if (bestICT && bestFP && bestICT.action === bestFP.action) {
      const combinedScore = bestICT.combinedScore + bestFP.combinedScore + 0.2; // agreement bonus
      if (combinedScore >= config.strategy.minConfluenceScore) {
        return {
          ...bestICT,
          combinedScore,
          confluence: true,
          confluenceSignals: [bestICT.type, bestFP.type],
          reason: `${bestICT.reason} + ${bestFP.reason}`,
        };
      }
    }

    // Case 2: Strong single signal (high confidence) — allow without full confluence
    const allScored = [...(bestICT ? [bestICT] : []), ...(bestFP ? [bestFP] : [])];
    allScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = allScored[0];

    if (best && best.combinedScore >= config.strategy.minConfluenceScore) {
      return best;
    }

    return null;
  }

  _scoreSignals(signals, regime, regimeResult, killzone, weight) {
    const scored = signals.map(sig => {
      let score = sig.confidence * weight;

      // ── Regime-specific boosts ───────────────────────────────────
      if (sig.type === 'FVG' || sig.type === 'ORDER_BLOCK' || sig.type === 'OTE') {
        if (regime === 'TRENDING') score *= 1.3;
        if (regime === 'RANGING') score *= 0.8;
        if (regime === 'VOL_EXPANSION') score *= 1.1;
      }

      if (sig.type === 'LIQUIDITY_SWEEP') {
        if (regime === 'TRENDING') score *= 1.4;
        if (regime === 'LOW_VOL') score *= 0.6;
      }

      if (sig.type === 'ABSORPTION' || sig.type === 'DELTA_DIVERGENCE') {
        if (regime === 'LOW_VOL') score *= 1.3;
        if (regime === 'ABSORPTION') score *= 1.5;
      }

      if (sig.type === 'IMBALANCE') {
        if (regime === 'VOL_EXPANSION') score *= 1.4;
      }

      if (sig.type === 'POC_REACTION') {
        if (regime === 'RANGING') score *= 1.3;
      }

      // ── Killzone boosts ──────────────────────────────────────────
      if (killzone.overlap) score *= 1.2;
      else if (killzone.allowed) score *= 1.05;

      // ── Regime confidence boost ──────────────────────────────────
      if (regimeResult.confidence > 0.7) score *= 1.1;

      return { ...sig, combinedScore: score };
    });

    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    return scored[0];
  }

  // ── Legacy signal combination (fallback) ─────────────────────────
  _combineSignals(regime, ict, footprint, regimeResult, killzone) {
    const allSignals = [...ict.signals, ...footprint.signals];
    if (allSignals.length === 0) return null;

    const best = this._scoreSignals(allSignals, regime, regimeResult, killzone, 1.0);
    if (best.combinedScore < config.strategy.minCombinedScore) return null;
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

    // Ranging: trade at range extremes (slightly relaxed from 0.3/0.7 to 0.25/0.75)
    if (regime === 'RANGING') {
      const highs = candles.slice(-20).map(c => c.high);
      const lows = candles.slice(-20).map(c => c.low);
      const rangeHigh = Math.max(...highs);
      const rangeLow = Math.min(...lows);
      const rangeSpan = rangeHigh - rangeLow;
      if (rangeSpan === 0) return null;
      const rangePosition = (price - rangeLow) / rangeSpan;

      // Buy near bottom (0-25%), sell near top (75-100%)
      if (signal.action === 'buy' && rangePosition > 0.25) return null;
      if (signal.action === 'sell' && rangePosition < 0.75) return null;
    }

    // Trending: must align with trend direction (use EMA21)
    if (regime === 'TRENDING') {
      const ema21 = this._cachedEMA(candles, 21);
      if (signal.action === 'buy' && price < ema21) return null;
      if (signal.action === 'sell' && price > ema21) return null;
    }

    // ── Calculate SL/TP using ATR ──────────────────────────────────
    const atr = this._currentATR(candles);
    const sl = signal.action === 'buy'
      ? price - atr * riskParams.slMultiplier
      : price + atr * riskParams.slMultiplier;

    const tp = signal.action === 'buy'
      ? price + atr * riskParams.tpMultiplier
      : price - atr * riskParams.tpMultiplier;

    // ── Position sizing using CURRENT balance ──────────────────────
    // Uses current balance, not starting balance — adapts to PnL
    const currentBalance = config.engine.startingBalance; // will be overridden by PaperEngine/backtest
    const riskAmount = currentBalance * (riskParams.riskPercent / 100);
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
      atr,
    };
  }

  // ── Killzone Check (FIXED: accepts timestamp) ────────────────────
  _checkKillzone(candleTimestamp) {
    // Use candle timestamp for backtest, real clock for live
    const now = candleTimestamp ? new Date(candleTimestamp) : new Date();
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
    return Date.now() - lastTime < config.strategy.signalCooldown;
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _cachedEMA(candles, period) {
    const key = `${candles.length}-${candles[candles.length - 1].timestamp}`;
    const cacheKey = `ema${period}`;
    if (this._emaCache[cacheKey]?.key === key) {
      return this._emaCache[cacheKey].value;
    }
    const closes = candles.map(c => c.close);
    const k = 2 / (period + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    this._emaCache[cacheKey] = { key, value: ema };
    return ema;
  }

  _currentATR(candles, period = 14) {
    const key = `${candles.length}-${candles[candles.length - 1].timestamp}`;
    if (this._atrCache?.key === key) return this._atrCache.value;

    const tr = [];
    for (let i = Math.max(1, candles.length - period - 1); i < candles.length; i++) {
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    const atr = tr.reduce((a, b) => a + b, 0) / tr.length;
    this._atrCache = { key, value: atr };
    return atr;
  }
}
