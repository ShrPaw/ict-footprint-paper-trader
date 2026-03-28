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

    // 2b. Skip LOW_VOL regime — no edge, just bleeding fees
    if (config.strategy.skipLowVol && regime === 'LOW_VOL') return null;

    // 3. Run ICT analysis
    const ictResult = this.ict.analyze(symbol, candles);

    // 4. Run Footprint analysis
    const footprintResult = this.footprint.analyze(symbol, candles);

    // 5. Score signals — strict confluence required
    const signal = this._scoreWithConfluence(regime, ictResult, footprintResult, regimeResult, inKillzone);
    if (!signal) return null;

    // 6. Apply regime-specific filters
    const filtered = this._applyRegimeFilters(signal, regime, regimeResult, candles);
    if (!filtered) return null;

    // 7. Rate limit (uses candle timestamp in backtest)
    if (this._isRateLimited(symbol, lastCandle.timestamp)) return null;

    this.lastSignalTime[symbol] = lastCandle.timestamp || Date.now();
    return filtered;
  }

  // ── Unified Scoring with Confluence Gate ─────────────────────────
  // HARD REQUIREMENT: must have ICT + Footprint agreement, OR exceptional single signal
  _scoreWithConfluence(regime, ict, footprint, regimeResult, killzone) {
    const ictSignals = ict.signals || [];
    const fpSignals = footprint.signals || [];

    if (ictSignals.length === 0 && fpSignals.length === 0) return null;

    // Score all signals
    const allScored = [];
    for (const sig of ictSignals) {
      allScored.push(this._scoreSignal(sig, regime, regimeResult, killzone, config.strategy.ictWeight));
    }
    for (const sig of fpSignals) {
      allScored.push(this._scoreSignal(sig, regime, regimeResult, killzone, config.strategy.footprintWeight));
    }

    if (allScored.length === 0) return null;
    allScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = allScored[0];

    // Check for confluence: different source agrees on direction
    const confluenceSignals = allScored.filter(s =>
      s.action === best.action && s.source !== best.source
    );

    const hasConfluence = confluenceSignals.length > 0;

    if (hasConfluence) {
      best.combinedScore += config.strategy.confluenceBonus;
      best.confluence = true;
      best.confluenceSignals = [best.type, ...confluenceSignals.map(s => s.type)];
      best.reason = `${best.reason} (+ ${confluenceSignals[0].type} confluence)`;

      // Confluence pass: check minimum score
      if (best.combinedScore >= config.strategy.minConfluenceScore) return best;
    }

    // No confluence: require exceptional solo score
    if (best.combinedScore >= config.strategy.minSoloScore) return best;

    return null; // rejected
  }

  _scoreSignal(sig, regime, regimeResult, killzone, weight) {
    let score = sig.confidence * weight;
    const source = (sig.type === 'FVG' || sig.type === 'ORDER_BLOCK' || sig.type === 'OTE' ||
                    sig.type === 'LIQUIDITY_SWEEP' || sig.type === 'BOS' || sig.type === 'CHoCH')
      ? 'ict' : 'footprint';

    // ── Regime-specific boosts ───────────────────────────────────
    if (sig.type === 'FVG' || sig.type === 'ORDER_BLOCK' || sig.type === 'OTE') {
      if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') score *= 1.3;
      if (regime === 'RANGING') score *= 0.8;
      if (regime === 'VOL_EXPANSION') score *= 1.1;
    }

    if (sig.type === 'LIQUIDITY_SWEEP') {
      // Reduced significantly — worst performer with 19% WR
      if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') score *= 0.8;
      if (regime === 'LOW_VOL') score *= 0.3;
      if (regime === 'RANGING') score *= 0.5;
      if (regime === 'VOL_EXPANSION') score *= 0.7;
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

    return { ...sig, combinedScore: score, source };
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

    // Ranging: only trade at range extremes (strict — 20/80)
    if (regime === 'RANGING') {
      const highs = candles.slice(-20).map(c => c.high);
      const lows = candles.slice(-20).map(c => c.low);
      const rangeHigh = Math.max(...highs);
      const rangeLow = Math.min(...lows);
      const rangeSpan = rangeHigh - rangeLow;
      if (rangeSpan === 0) return null;
      const rangePosition = (price - rangeLow) / rangeSpan;

      // Buy near bottom (0-20%), sell near top (80-100%)
      if (signal.action === 'buy' && rangePosition > 0.2) return null;
      if (signal.action === 'sell' && rangePosition < 0.8) return null;
    }

    // Trending: must align with trend direction — STRICT
    if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') {
      const ema21 = this._cachedEMA(candles, 21);
      // Block counter-trend trades
      if (signal.action === 'buy' && price < ema21) return null;
      if (signal.action === 'sell' && price > ema21) return null;
      // Block opposite direction entirely
      if (regime === 'TRENDING_UP' && signal.action === 'sell') return null;
      if (regime === 'TRENDING_DOWN' && signal.action === 'buy') return null;
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

  // ── Killzone Check (deadzone-based filtering) ────────────────────
  // Only blocks during true dead hours (4-6 UTC, 18-22 UTC)
  // Active zones get score boosts, everything else is neutral (allowed)
  _checkKillzone(candleTimestamp) {
    const now = candleTimestamp ? new Date(candleTimestamp) : new Date();
    const utcHour = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const time = utcHour + utcMinutes / 60;

    const kz = config.killzones;

    // Check if in a deadzone (the ONLY thing that blocks signals)
    const inDeadzone = kz.deadzones.some(dz => time >= dz.start && time < dz.end);

    if (inDeadzone) {
      return { allowed: false, overlap: false, strict: true, session: 'dead' };
    }

    // Determine session for scoring boost
    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = (time >= kz.asia.start || time < kz.asia.end); // wraps midnight

    return {
      allowed: true,       // always allowed outside deadzone
      overlap: inOverlap,
      strict: false,       // never strictly blocks outside deadzone
      session: inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session',
    };
  }

  // ── Rate Limiting (adaptive to timeframe) ─────────────────────────
  _isRateLimited(symbol, candleTimestamp) {
    const lastTime = this.lastSignalTime[symbol];
    if (!lastTime) return false;
    // Use candle timestamp for backtest, Date.now() for live
    const now = candleTimestamp || Date.now();
    return now - lastTime < config.strategy.signalCooldown;
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
