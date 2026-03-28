// ── Mode 3: Scalping Pro (Weekday Intraday + Hybrid Model) ─────────
// Active: Monday–Friday
// Timeframe: 15m primary + lower confirmations
// NO ICT on low timeframes (too noisy) — footprint + professional scalping
// Order flow confirmation, cluster behavior, volume-based triggers
// Precise entries via confluence of microstructure variables

import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';

export default class ScalpingProMode {
  constructor(regimeDetector, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.footprint = footprintAnalyzer;
    this.lastSignalTime = {};
    this._atrCache = {};
    this._emaCache = {};
    this.modeName = 'SCALPING';
  }

  generateSignal(symbol, candles15m, candles5m = null, realFootprint = null) {
    const profile = getProfile(symbol);
    const lastCandle = candles15m[candles15m.length - 1];

    // 1. Weekday only
    if (this._isWeekend(lastCandle.timestamp)) return null;

    if (candles15m.length < 50) return null;

    // 2. Killzone — scalping works best in active sessions
    const killzone = this._checkKillzone(lastCandle.timestamp);
    if (!killzone.allowed && killzone.strict) return null;

    // 3. Regime on 15m
    const regimeResult = this.regime.detect(symbol, candles15m);
    const regime = regimeResult.regime;

    // 4. Skip dead regimes
    if (regime === 'LOW_VOL') return null;

    const price = lastCandle.close;

    // 5. EMA trend filter (lighter than daytrade — just EMA50 direction)
    const ema50 = this._cachedEMA(candles15m, 50);
    const priceAboveEMA = price > ema50;
    const priceBelowEMA = price < ema50;

    if (!priceAboveEMA && !priceBelowEMA) return null;

    // 6. Run footprint analysis — primary signal source for scalping
    const footprintResult = this.footprint.analyze(symbol, candles15m, realFootprint);

    // 7. Run 5m footprint for micro-confirmation if available
    let fp5m = null;
    if (candles5m && candles5m.length >= 30) {
      fp5m = this.footprint.analyze(symbol, candles5m, null);
    }

    // 8. Score scalping signals
    const signal = this._scoreScalpSignal(
      regime, footprintResult, fp5m, regimeResult,
      profile, priceAboveEMA, killzone, candles15m
    );
    if (!signal) return null;

    // 9. Direction filter
    if (signal.action === 'buy' && !priceAboveEMA) return null;
    if (signal.action === 'sell' && !priceBelowEMA) return null;

    // 10. Strict trend alignment in trending regimes
    if (regime === 'TRENDING_UP' && signal.action === 'sell') return null;
    if (regime === 'TRENDING_DOWN' && signal.action === 'buy') return null;

    // 11. In TRENDING_UP: only take FOOTPRINT signals, not ICT
    // Longs in uptrend with ICT signals are the worst performers
    if (regime === 'TRENDING_UP' && signal.source === 'ict') return null;

    // 12. Volume confirmation (asset-specific threshold)
    const minVolMult = profile.scalping.minVolumeMult;
    if (!this._checkVolumeFilter(candles15m, minVolMult)) return null;

    // 12. Rate limit (shorter for scalping — more frequent entries)
    const cooldown = config.strategy.signalCooldown * 0.75; // ~34 min
    if (this._isRateLimited(symbol, lastCandle.timestamp, cooldown)) return null;

    // 14. SL/TP — tighter for scalping
    const atr = this._currentATR(candles15m);
    const baseSlMult = config.risk[regime]?.slMultiplier || 0.5;
    const slMult = baseSlMult * 0.9; // slightly tighter than config default
    const tpMult = config.risk[regime]?.tpMultiplier || 2.0;

    const sl = signal.action === 'buy'
      ? price - atr * slMult
      : price + atr * slMult;

    const tp = signal.action === 'buy'
      ? price + atr * tpMult
      : price - atr * tpMult;

    // Position sizing
    const riskPercent = (config.risk[regime]?.riskPercent || 0.75) * profile.riskMultiplier;
    const riskAmount = config.engine.startingBalance * (riskPercent / 100);
    const slDistance = Math.abs(price - sl);
    const size = slDistance > 0 ? riskAmount / slDistance : 0;

    this.lastSignalTime[symbol] = lastCandle.timestamp || Date.now();

    return {
      ...signal,
      mode: this.modeName,
      regime,
      regimeConfidence: regimeResult.confidence,
      price,
      stopLoss: sl,
      takeProfit: tp,
      size: Math.max(size, 0),
      atr,
      isWeekend: false,
      assetProfile: profile.name,
      session: killzone.session,
      realData: !!realFootprint,
    };
  }

  // ── Scalping Score — Footprint + Volume + Microstructure ─────────
  _scoreScalpSignal(regime, fp15m, fp5m, regimeResult, profile, bullish, killzone, candles) {
    const fpSignals = fp15m.signals || [];
    if (fpSignals.length === 0) return null;

    const deltaImbRatio = profile.scalping.deltaImbalanceRatio;

    const scored = [];
    for (const sig of fpSignals) {
      let score = sig.confidence;

      // Real data bonus — especially critical for scalping
      if (sig.realData) score *= 1.2;

      // ── Scalping-specific boosts ──────────────────────────────
      // Delta divergence — scalper's bread and butter
      if (sig.type === 'DELTA_DIVERGENCE') {
        score *= 1.6;
        if (regime === 'VOL_EXPANSION') score *= 1.2;
        if (regime === 'ABSORPTION') score *= 1.3;
      }

      // Absorption — catching the wall
      if (sig.type === 'ABSORPTION') {
        score *= 1.4;
        if (regime === 'RANGING') score *= 1.3;
        if (regime === 'ABSORPTION') score *= 1.5;
      }

      // Stacked imbalance — momentum continuation
      if (sig.type === 'STACKED_IMBALANCE') {
        score *= 1.3;
        if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') score *= 1.4;
        if (regime === 'VOL_EXPANSION') score *= 1.2;
      }

      // Delta flip — regime shift detection
      if (sig.type === 'DELTA_FLIP') {
        score *= 1.3;
        if (regime === 'VOL_EXPANSION') score *= 1.3;
      }

      // Imbalance — directional pressure
      if (sig.type === 'IMBALANCE') {
        score *= 1.2;
        if (regime === 'VOL_EXPANSION') score *= 1.4;
      }

      // POC/Volume shelf — support/resistance
      if (sig.type === 'POC_REACTION' || sig.type === 'VOLUME_SHELF') {
        score *= 1.1;
        if (regime === 'RANGING') score *= 1.3;
      }

      // Order flow at psychological levels
      if (profile.psychologicalLevels) {
        const nearPsych = profile.psychologicalLevels.some(level =>
          Math.abs(candles[candles.length - 1].close - level) / level < 0.005
        );
        if (nearPsych) score *= 1.15;
      }

      scored.push({ ...sig, combinedScore: score, source: 'footprint' });
    }

    // 5m micro-confirmation
    if (fp5m && fp5m.signals.length > 0) {
      const best5m = fp5m.signals[0];
      for (const sig of scored) {
        if (sig.action === best5m.action) {
          sig.combinedScore += 0.12;
          sig.confluence = true;
          sig.confluenceSignals = [sig.type, best5m.type];
          sig.reason = `${sig.reason} (+ 5m ${best5m.type})`;
        }
      }
    }

    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = scored[0];

    // Thresholds — more selective for scalping
    const minScore = config.strategy.minConfluenceScore;
    const minSolo = 0.80; // higher bar for scalping without confluence

    if (best.confluence && best.combinedScore >= minScore) return best;
    if (best.combinedScore >= minSolo) return best;

    return null;
  }

  // ── Volume Filter ────────────────────────────────────────────────
  _checkVolumeFilter(candles, minMultiplier) {
    const lookback = config.volumeFilter.lookback;
    if (candles.length < lookback + 1) return true;

    const recentCandles = candles.slice(-lookback - 1, -1);
    const avgVolume = recentCandles.reduce((s, c) => s + c.volume, 0) / recentCandles.length;
    const currentVolume = candles[candles.length - 1].volume;

    return currentVolume >= avgVolume * minMultiplier;
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _isWeekend(timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
    const day = now.getUTCDay();
    return day === 0 || day === 6;
  }

  _checkKillzone(timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
    const utcHour = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const time = utcHour + utcMinutes / 60;
    const kz = config.killzones;

    const inDeadzone = kz.deadzones.some(dz => time >= dz.start && time < dz.end);
    if (inDeadzone) return { allowed: false, strict: true, session: 'dead' };

    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = (time >= kz.asia.start || time < kz.asia.end);

    return {
      allowed: true,
      strict: false,
      overlap: inOverlap,
      session: inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session',
    };
  }

  _isRateLimited(symbol, timestamp, cooldown) {
    const lastTime = this.lastSignalTime[symbol];
    if (!lastTime) return false;
    return (timestamp || Date.now()) - lastTime < cooldown;
  }

  _cachedEMA(candles, period) {
    const key = `${candles.length}-${candles[candles.length - 1].timestamp}`;
    const cacheKey = `ema${period}`;
    if (this._emaCache[cacheKey]?.key === key) return this._emaCache[cacheKey].value;
    const closes = candles.map(c => c.close);
    const k = 2 / (period + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
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
