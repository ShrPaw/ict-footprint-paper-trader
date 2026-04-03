// ── Mode 1: Daytrade (Trend-Focused, Weekdays Only) ────────────────
// ICT on 1H where price action is cleaner.
// Wider stops, higher R:R, trend-following only.
// Active: Monday–Friday, key trading sessions
//
// v4.0: Integrated institutional OrderFlowEngine (6-step pipeline)
// Adds: Context → Intent → Event → Cluster → Edge Validation → Execution

import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';
import OrderFlowEngine from '../engine/OrderFlowEngine.js';
import ModelRouter from '../models/ModelRouter.js';

export default class DaytradeMode {
  constructor(regimeDetector, ictAnalyzer, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.ict = ictAnalyzer;
    this.footprint = footprintAnalyzer;
    this.orderFlow = new OrderFlowEngine();
    this.modelRouter = new ModelRouter();
    this.lastSignalTime = {};
    this._atrCache = {};
    this._emaCache = {};
    this.modeName = 'DAYTRADE';
  }

  generateSignal(symbol, candles1h, candles15m = null, realFootprint = null) {
    if (candles1h.length < 50) return null;

    const profile = getProfile(symbol);
    const lastCandle = candles1h[candles1h.length - 1];
    const price = candles1h[candles1h.length - 1].close;

    // ── Data Preparation (shared infrastructure) ─────────────────
    // Regime detection on 1H
    const regimeResult = this.regime.detect(symbol, candles1h);
    const regime = regimeResult.regime;

    // ICT analysis on 1H
    const ictResult = this.ict.analyze(symbol, candles1h);

    // Footprint (use 15m if available for micro-confirmation)
    const fpCandles = candles15m || candles1h;
    const footprintResult = this.footprint.analyze(symbol, fpCandles, realFootprint);

    // EMA values
    const ema21 = this._cachedEMA(candles1h, 21);
    const ema50 = this._cachedEMA(candles1h, 50);
    const ema9 = this._cachedEMA(candles1h, 9);

    // ── Build Model Context ─────────────────────────────────────
    // Each per-asset model extracts its own features from this shared data
    const ctx = {
      symbol,
      candles1h,
      candles15m: fpCandles,
      index1h: candles1h.length - 1,
      index15m: fpCandles.length - 1,
      timestamp: lastCandle.timestamp,
      price,
      profile,
      regime,
      regimeResult,
      atr: this._currentATR(candles1h),
      killzone: this._checkKillzone(lastCandle.timestamp),

      // Indicators (scalars for current candle — models can access arrays too)
      indicators1h: {
        ema9: new Array(candles1h.length).fill(null),  // models compute from candles
        ema21: new Array(candles1h.length).fill(null),
        ema50: new Array(candles1h.length).fill(null),
        atr: new Array(candles1h.length).fill(null),
      },

      // Pre-populate last values for model convenience
      ema9, ema21, ema50,

      // ICT signals (from analyzer)
      ictSignals: ictResult.signals || [],
      obSignals: ictResult.signals?.filter(s => s.type === 'ORDER_BLOCK') || [],
      sweepSignals: ictResult.signals?.filter(s => s.type === 'LIQUIDITY_SWEEP') || [],
      oteSignals: ictResult.signals?.filter(s => s.type === 'OTE') || [],

      // Footprint signals
      fpSignals: footprintResult.signals || [],
      deltaArr: null, // live mode uses footprint analyzer directly
      volumeRatio: null,

      // Volume metrics (if available)
      volumeRatio: this._getVolumeRatio(candles1h),
    };

    // ── Route to Per-Asset Model ────────────────────────────────
    // Each model has its OWN feature extraction, signal logic, and thresholds.
    // This is NOT parameter tuning — it's independent alpha engines.
    const result = this.modelRouter.evaluate(symbol, ctx);
    if (result) return result;

    // ── Fallback: Legacy scoring (transition period) ────────────
    // Remove this once all models are validated in backtests.
    // The legacy path uses the old single-strategy approach as safety net.
    return this._legacyFallback(symbol, ctx, ictResult, footprintResult, regimeResult);
  }

  /**
   * Legacy fallback — old _scoreSignal logic, kept during transition.
   * Once per-asset models are validated, remove this method entirely.
   */
  _legacyFallback(symbol, ctx, ictResult, footprintResult, regimeResult) {
    const profile = ctx.profile;
    const regime = ctx.regime;
    const killzone = ctx.killzone;
    const candles1h = ctx.candles1h;

    // Only run legacy if model returned null AND basic gates pass
    if (this.isWeekend(ctx.timestamp)) return null;
    if (!killzone.allowed) return null;
    if (profile.allowedSessions && !profile.allowedSessions.includes(killzone.session)) return null;
    if (profile.blockedRegimes?.includes(regime)) return null;

    const bullish = ctx.price > ctx.ema21 && ctx.price > ctx.ema50;
    const bearish = ctx.price < ctx.ema21 && ctx.price < ctx.ema50;
    if (!bullish && !bearish) return null;

    const legacySignal = this._scoreSignal(
      regime, ictResult, footprintResult, regimeResult,
      profile, bullish, killzone
    );

    if (!legacySignal) return null;

    // Apply same SL/TP logic
    const atr = legacySignal.atr || ctx.atr;
    const slMult = (profile.riskOverrides?.slMultiplier ?? config.risk[regime]?.slMultiplier ?? 0.9) * profile.slTightness;
    const tpMult = config.risk[regime]?.tpMultiplier || 2.5;
    const sl = legacySignal.action === 'buy' ? ctx.price - atr * slMult : ctx.price + atr * slMult;
    const tp = legacySignal.action === 'buy' ? ctx.price + atr * tpMult : ctx.price - atr * tpMult;
    const riskPercent = (config.risk[regime]?.riskPercent || 0.75) * profile.riskMultiplier;
    const riskAmount = config.engine.startingBalance * (riskPercent / 100);
    const slDistance = Math.abs(ctx.price - sl);
    const size = slDistance > 0 ? riskAmount / slDistance : 0;

    this.lastSignalTime[symbol] = ctx.timestamp || Date.now();

    return {
      ...legacySignal,
      mode: this.modeName,
      regime,
      regimeConfidence: regimeResult.confidence,
      price: ctx.price,
      stopLoss: sl,
      takeProfit: tp,
      size: Math.max(size, 0),
      atr,
      isWeekend: false,
      assetProfile: profile.name,
      profile,
      session: killzone.session,
      source: 'legacy_fallback',
    };
  }

  // ── Helpers ────────────────────────────────────────────────────

  isWeekend(timestamp) {
    const day = timestamp ? new Date(timestamp).getUTCDay() : new Date().getUTCDay();
    return day === 0 || day === 6;
  }

  _checkKillzone(timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
    const time = now.getUTCHours() + now.getUTCMinutes() / 60;
    const kz = config.killzones;
    if (kz.deadzones.some(dz => time >= dz.start && time < dz.end)) return { allowed: false, session: 'dead' };
    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = (time >= kz.asia.start || time < kz.asia.end);
    const session = inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session';
    if (session === 'off-session') return { allowed: false, session };
    return { allowed: true, overlap: inOverlap, session };
  }

  _getVolumeRatio(candles1h) {
    const n = candles1h.length;
    if (n < 21) return 1.0;
    let sum = 0;
    for (let i = n - 21; i < n - 1; i++) sum += candles1h[i].volume;
    const avg = sum / 20;
    return avg > 0 ? candles1h[n - 1].volume / avg : 1.0;
  }

  _scoreSignal(regime, ict, footprint, regimeResult, profile, bullish, killzone) {
    const ictSignals = ict.signals || [];
    const fpSignals = footprint.signals || [];

    if (ictSignals.length === 0 && fpSignals.length === 0) return null;

    const ictWeight = profile.daytrade.ictWeight;
    const fpWeight = profile.daytrade.footprintWeight;

    // Score signals using RAW confidence (no weight multiplication here).
    // Weights are informational only — both backtest and live use the same
    // threshold scale after this fix. Backtest normalizes by dividing by weight;
    // live simply doesn't multiply by weight in the first place.
    const allScored = [];
    for (const sig of ictSignals) {
      if (sig.type === 'FVG') continue; // killed — 24% WR
      if (sig.type === 'ORDER_BLOCK') {
        allScored.push({ ...sig, combinedScore: sig.confidence * 0.5, source: 'ict' });
        continue;
      }
      allScored.push({ ...sig, combinedScore: sig.confidence, source: 'ict' });
    }
    for (const sig of fpSignals) {
      let score = sig.confidence;
      if (sig.type === 'DELTA_DIVERGENCE') score *= 1.5;
      if (sig.realData) score *= 1.15;
      allScored.push({ ...sig, combinedScore: score, source: 'footprint' });
    }

    if (allScored.length === 0) return null;
    allScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = allScored[0];

    // Regime boosts
    if (best.source === 'ict' && (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN')) {
      best.combinedScore *= 1.3;
    }
    if (best.type === 'DELTA_DIVERGENCE' && regime === 'ABSORPTION') best.combinedScore *= 1.3;
    if (best.type === 'STACKED_IMBALANCE' && (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN')) {
      best.combinedScore *= 1.4;
    }

    // Session boost
    const sessionWeight = profile.sessionWeights[killzone.session] || 1.0;
    best.combinedScore *= sessionWeight;

    // Regime-specific threshold multiplier (matches backtest.js)
    const regimeMultipliers = {
      VOL_EXPANSION: 0.90,
      TRENDING_UP: 1.05,
      RANGING: 0.95,
      TRENDING_DOWN: 0.90,
      LOW_VOL: 1.0,
    };
    best.combinedScore *= (regimeMultipliers[regime] ?? 1.0);

    // Confluence
    const confluenceSignals = allScored.filter(s => s.action === best.action && s.source !== best.source);
    const hasConfluence = confluenceSignals.length > 0;

    // Per-asset thresholds (fallback to global config if not set)
    const minConfluenceScore = profile.daytrade.minConfluenceScore ?? config.strategy.minConfluenceScore;
    const minSoloScore = profile.daytrade.minSoloScore ?? config.strategy.minSoloScore;

    if (hasConfluence) {
      best.combinedScore += config.strategy.confluenceBonus;
      best.confluence = true;
      best.confluenceSignals = [best.type, ...confluenceSignals.map(s => s.type)];
      best.reason = `${best.reason} (+ ${confluenceSignals[0].type} confluence)`;
      if (best.combinedScore >= minConfluenceScore) return best;
    }

    if (best.type === 'ORDER_BLOCK' && !hasConfluence) return null;
    if (best.combinedScore >= minSoloScore) return best;
    return null;
  }

  _checkEntryConfirmation(candles, signal) {
    const cfg = config.strategy.entryConfirmation;
    for (let i = Math.max(1, candles.length - cfg.lookback - 1); i < candles.length; i++) {
      const c = candles[i];
      const range = c.high - c.low;
      if (range === 0) continue;
      const body = Math.abs(c.close - c.open);
      const bodyRatio = body / range;
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;

      if (signal.action === 'buy') {
        const wickRatio = lowerWick / (body || range * 0.01);
        if (wickRatio >= cfg.pinBarMinWickRatio && bodyRatio <= cfg.pinBarMaxBodyPercent) {
          if (Math.abs(c.close - signal.price) < signal.atr * 2.0) {
            signal.entryPattern = 'pin_bar_bullish';
            return true;
          }
        }
      }
      if (signal.action === 'sell') {
        const wickRatio = upperWick / (body || range * 0.01);
        if (wickRatio >= cfg.pinBarMinWickRatio && bodyRatio <= cfg.pinBarMaxBodyPercent) {
          if (Math.abs(c.close - signal.price) < signal.atr * 2.0) {
            signal.entryPattern = 'pin_bar_bearish';
            return true;
          }
        }
      }
      if (cfg.engulfingEnabled && i > 0) {
        const prev = candles[i - 1];
        const prevBody = Math.abs(prev.close - prev.open);
        if (signal.action === 'buy' && prev.close < prev.open && c.close > c.open &&
            body > prevBody && c.close > prev.open && c.open <= prev.close) {
          if (Math.abs(c.close - signal.price) < signal.atr * 2.0) {
            signal.entryPattern = 'bullish_engulfing';
            return true;
          }
        }
        if (signal.action === 'sell' && prev.close > prev.open && c.close < c.open &&
            body > prevBody && c.close < prev.open && c.open >= prev.close) {
          if (Math.abs(c.close - signal.price) < signal.atr * 2.0) {
            signal.entryPattern = 'bearish_engulfing';
            return true;
          }
        }
      }
    }
    return false;
  }


  _cachedEMA(candles, period) {
    const key = `${candles.length}-${candles[candles.length - 1].timestamp}`;
    const ck = `ema${period}`;
    if (this._emaCache[ck]?.key === key) return this._emaCache[ck].value;
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) ema = candles[i].close * k + ema * (1 - k);
    this._emaCache[ck] = { key, value: ema };
    return ema;
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
