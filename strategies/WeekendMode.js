// ── Mode 2: Weekend Mode (Range + Footprint/Cluster Focus) ─────────
// Active: Saturday–Sunday only
// Low volume, ranging → read real-time order flow per candle
// NO ICT (unreliable weekends) — pure footprint/cluster analysis
// More permissive dynamics but HIGHER confluence bar

import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';

export default class WeekendMode {
  constructor(regimeDetector, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.footprint = footprintAnalyzer;
    this.lastSignalTime = {};
    this._atrCache = {};
    this.modeName = 'WEEKEND';
  }

  generateSignal(symbol, candles5m, candles15m = null, realFootprint = null) {
    const profile = getProfile(symbol);
    if (!profile.weekend.enabled) return null;

    const lastCandle = candles5m[candles5m.length - 1];
    if (!this._isWeekend(lastCandle.timestamp)) return null;
    if (candles5m.length < 30) return null;

    const regimeResult = this.regime.detect(symbol, candles5m);
    const regime = regimeResult.regime;
    const price = lastCandle.close;

    // Only footprint — no ICT on weekends
    const footprintResult = this.footprint.analyze(symbol, candles5m, realFootprint);

    // 15m confluence check
    let fp15m = null;
    if (candles15m && candles15m.length >= 30) {
      fp15m = this.footprint.analyze(symbol, candles15m, null);
    }

    const signal = this._scoreWeekendSignal(
      regime, footprintResult, fp15m, regimeResult, profile, price
    );
    if (!signal) return null;

    // Rate limit — 45 min between signals (reduced from 27 min)
    const cooldown = config.strategy.signalCooldown;
    if (this._isRateLimited(symbol, lastCandle.timestamp, cooldown)) return null;

    // SL/TP
    const atr = this._currentATR(candles5m);
    const baseSlMult = config.risk[regime]?.slMultiplier || 0.8;
    const slMult = (baseSlMult + config.weekend.slMultiplierBoost) * profile.slTightness;
    // Tighter TP for weekends — take profits faster in chop
    const tpMult = (config.risk[regime]?.tpMultiplier || 2.0) * 0.7;

    const sl = signal.action === 'buy' ? price - atr * slMult : price + atr * slMult;
    const tp = signal.action === 'buy' ? price + atr * tpMult : price - atr * tpMult;

    const baseRisk = config.risk[regime]?.riskPercent || 0.5;
    const riskPercent = baseRisk * config.weekend.riskMultiplier * profile.weekend.riskMultiplier;
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
      isWeekend: true,
      assetProfile: profile.name,
      realData: !!realFootprint,
    };
  }

  // ── Weekend Scoring — HIGHER bar to reduce noise ─────────────────
  _scoreWeekendSignal(regime, fp5m, fp15m, regimeResult, profile, price) {
    const fpSignals = fp5m.signals || [];
    if (fpSignals.length === 0) return null;

    const scored = [];
    for (const sig of fpSignals) {
      let score = sig.confidence;

      if (sig.realData) score *= 1.25;

      // Absorption is king on weekends
      if (sig.type === 'ABSORPTION') {
        score *= 1.5;
        if (regime === 'RANGING') score *= 1.3;
        if (regime === 'ABSORPTION') score *= 1.4;
      }

      // POC reactions strong in ranging
      if (sig.type === 'POC_REACTION') {
        score *= 1.3;
        if (regime === 'RANGING') score *= 1.4;
      }

      if (sig.type === 'VOLUME_SHELF') {
        score *= 1.2;
        if (regime === 'RANGING') score *= 1.3;
      }

      if (sig.type === 'DELTA_DIVERGENCE') score *= 1.3;
      if (sig.type === 'STACKED_IMBALANCE') {
        score *= 1.1;
        if (regime === 'VOL_EXPANSION') score *= 1.3;
      }
      if (sig.type === 'DELTA_FLIP') score *= 1.15;
      if (sig.type === 'IMBALANCE') score *= 1.1;

      scored.push({ ...sig, combinedScore: score, source: 'footprint' });
    }

    // 15m confluence bonus
    if (fp15m && fp15m.signals.length > 0) {
      const best15m = fp15m.signals[0];
      for (const sig of scored) {
        if (sig.action === best15m.action) {
          sig.combinedScore += 0.15;
          sig.confluence = true;
          sig.confluenceSignals = [sig.type, best15m.type];
          sig.reason = `${sig.reason} (+ 15m ${best15m.type})`;
        }
      }
    }

    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = scored[0];

    // MUCH higher bar for weekends — was generating 277 trades/month!
    const minScore = config.strategy.minConfluenceScore + profile.weekend.confluenceBoost + 0.10;
    const minSolo = config.strategy.minSoloScore + profile.weekend.confluenceBoost + 0.10;

    if (best.confluence && best.combinedScore >= minScore) return best;
    if (best.combinedScore >= minSolo) return best;

    return null;
  }

  _isWeekend(timestamp) {
    const day = timestamp ? new Date(timestamp).getUTCDay() : new Date().getUTCDay();
    return day === 0 || day === 6;
  }

  _isRateLimited(symbol, timestamp, cooldown) {
    const lastTime = this.lastSignalTime[symbol];
    if (!lastTime) return false;
    return (timestamp || Date.now()) - lastTime < cooldown;
  }

  _currentATR(candles, period = 14) {
    const key = `${candles.length}-${candles[candles.length - 1].timestamp}`;
    if (this._atrCache?.key === key) return this._atrCache.value;
    const tr = [];
    for (let i = Math.max(1, candles.length - period - 1); i < candles.length; i++) {
      tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
    }
    const atr = tr.reduce((a, b) => a + b, 0) / tr.length;
    this._atrCache = { key, value: atr };
    return atr;
  }
}
