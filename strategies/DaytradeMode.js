// ── Mode 1: Daytrade (Trend-Focused, Weekdays Only) ────────────────
// ICT on higher timeframes (1H) where price action is cleaner.
// Wider stops, higher R:R, trend-following only.
// Active: Monday–Friday, key trading sessions

import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';

export default class DaytradeMode {
  constructor(regimeDetector, ictAnalyzer, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.ict = ictAnalyzer;
    this.footprint = footprintAnalyzer;
    this.lastSignalTime = {};
    this._atrCache = {};
    this._emaCache = {};
    this.modeName = 'DAYTRADE';
  }

  generateSignal(symbol, candles1h, candles15m = null, realFootprint = null) {
    if (candles1h.length < 50) return null;

    const profile = getProfile(symbol);
    const lastCandle = candles1h[candles1h.length - 1];

    // 1. Weekday only
    if (this._isWeekend(lastCandle.timestamp)) return null;

    // 2. Killzone check (use asset session weights)
    const killzone = this._checkKillzone(lastCandle.timestamp, profile);
    if (!killzone.allowed) return null;

    // 3. Regime detection on 1H
    const regimeResult = this.regime.detect(symbol, candles1h);
    const regime = regimeResult.regime;

    // 4. Skip unfavorable regimes
    if (regime === 'LOW_VOL') return null;
    if (regime === 'RANGING') return null;

    // 5. ADX trend strength check (asset-specific threshold)
    const adx = parseFloat(regimeResult.metrics?.adx) || 0;
    if (adx < profile.daytrade.adxThreshold) return null;

    // 6. EMA alignment check (1H: EMA9 > EMA21 > EMA50 for longs)
    const price = candles1h[candles1h.length - 1].close;
    const ema9 = this._cachedEMA(candles1h, 9);
    const ema21 = this._cachedEMA(candles1h, 21);
    const ema50 = this._cachedEMA(candles1h, 50);

    const bullishAlignment = ema9 > ema21 && ema21 > ema50 && price > ema50;
    const bearishAlignment = ema9 < ema21 && ema21 < ema50 && price < ema50;

    if (!bullishAlignment && !bearishAlignment) return null;

    // 7. Run ICT analysis on 1H (cleaner on higher TF)
    const ictResult = this.ict.analyze(symbol, candles1h);

    // 8. Run footprint (use 15m data if available for micro-confirmation)
    const fpCandles = candles15m || candles1h;
    const footprintResult = this.footprint.analyze(symbol, fpCandles, realFootprint);

    // 9. Score with asset-specific weights
    const signal = this._scoreSignal(
      regime, ictResult, footprintResult, regimeResult,
      profile, bullishAlignment, killzone
    );
    if (!signal) return null;

    // 10. Direction filter — enforce EMA alignment
    if (signal.action === 'buy' && !bullishAlignment) return null;
    if (signal.action === 'sell' && !bearishAlignment) return null;

    // 11. Strict trend alignment
    if (regime === 'TRENDING_UP' && signal.action === 'sell') return null;
    if (regime === 'TRENDING_DOWN' && signal.action === 'buy') return null;

    // 12. Entry confirmation (pin bar, engulfing, inside bar)
    if (config.strategy.entryConfirmation.enabled) {
      const confirmed = this._checkEntryConfirmation(candles1h, signal);
      if (!confirmed) return null;
    }

    // 13. Rate limit
    if (this._isRateLimited(symbol, lastCandle.timestamp)) return null;

    // 14. Calculate SL/TP with asset-specific adjustments
    const atr = this._currentATR(candles1h);
    const slMult = config.risk[regime]?.slMultiplier || 0.9;
    const tpMult = config.risk[regime]?.tpMultiplier || 2.5;

    // Wider SL for daytrade (asset-adjusted)
    const adjustedSL = slMult * profile.slTightness;

    const sl = signal.action === 'buy'
      ? price - atr * adjustedSL
      : price + atr * adjustedSL;

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
      adx,
    };
  }

  // ── Scoring with asset-specific weights ──────────────────────────
  _scoreSignal(regime, ict, footprint, regimeResult, profile, bullishAlignment, killzone) {
    const ictSignals = ict.signals || [];
    const fpSignals = footprint.signals || [];

    if (ictSignals.length === 0 && fpSignals.length === 0) return null;

    const ictWeight = profile.daytrade.ictWeight;
    const fpWeight = profile.daytrade.footprintWeight;

    const allScored = [];
    for (const sig of ictSignals) {
      // FVG killed — 24% WR across all tests
      if (sig.type === 'FVG') continue;
      // Order Block needs confluence
      if (sig.type === 'ORDER_BLOCK') {
        allScored.push({ ...sig, combinedScore: sig.confidence * ictWeight * 0.5, source: 'ict' });
        continue;
      }
      allScored.push({ ...sig, combinedScore: sig.confidence * ictWeight, source: 'ict' });
    }
    for (const sig of fpSignals) {
      let score = sig.confidence * fpWeight;
      // Boost DELTA_DIVERGENCE — best performer
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
    if (best.type === 'DELTA_DIVERGENCE' && regime === 'ABSORPTION') {
      best.combinedScore *= 1.3;
    }
    if (best.type === 'STACKED_IMBALANCE' && (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN')) {
      best.combinedScore *= 1.4;
    }

    // Session boost
    const sessionWeight = profile.sessionWeights[killzone.session] || 1.0;
    best.combinedScore *= sessionWeight;

    // Confluence check
    const confluenceSignals = allScored.filter(s =>
      s.action === best.action && s.source !== best.source
    );
    const hasConfluence = confluenceSignals.length > 0;

    const minScore = config.strategy.minConfluenceScore;
    const minSolo = config.strategy.minSoloScore;

    if (hasConfluence) {
      best.combinedScore += config.strategy.confluenceBonus;
      best.confluence = true;
      best.confluenceSignals = [best.type, ...confluenceSignals.map(s => s.type)];
      best.reason = `${best.reason} (+ ${confluenceSignals[0].type} confluence)`;
      if (best.combinedScore >= minScore) return best;
    }

    // OB alone never enough
    if (best.type === 'ORDER_BLOCK' && !hasConfluence) return null;

    if (best.combinedScore >= minSolo) return best;
    return null;
  }

  // ── Entry Confirmation (reuse from original) ────────────────────
  _checkEntryConfirmation(candles, signal) {
    const cfg = config.strategy.entryConfirmation;
    const lookback = cfg.lookback;

    for (let i = Math.max(1, candles.length - lookback - 1); i < candles.length; i++) {
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
          if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
            signal.entryPattern = 'pin_bar_bullish';
            signal.confidence = Math.min(signal.confidence + 0.1, 1.0);
            return true;
          }
        }
      }
      if (signal.action === 'sell') {
        const wickRatio = upperWick / (body || range * 0.01);
        if (wickRatio >= cfg.pinBarMinWickRatio && bodyRatio <= cfg.pinBarMaxBodyPercent) {
          if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
            signal.entryPattern = 'pin_bar_bearish';
            signal.confidence = Math.min(signal.confidence + 0.1, 1.0);
            return true;
          }
        }
      }

      if (cfg.engulfingEnabled && i > 0) {
        const prev = candles[i - 1];
        const prevBody = Math.abs(prev.close - prev.open);
        if (signal.action === 'buy' && prev.close < prev.open && c.close > c.open &&
            body > prevBody && c.close > prev.open && c.open <= prev.close) {
          if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
            signal.entryPattern = 'bullish_engulfing';
            signal.confidence = Math.min(signal.confidence + 0.15, 1.0);
            return true;
          }
        }
        if (signal.action === 'sell' && prev.close > prev.open && c.close < c.open &&
            body > prevBody && c.close < prev.open && c.open >= prev.close) {
          if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
            signal.entryPattern = 'bearish_engulfing';
            signal.confidence = Math.min(signal.confidence + 0.15, 1.0);
            return true;
          }
        }
      }

      if (cfg.insideBarEnabled && i > 0 && i + 1 < candles.length) {
        const prev = candles[i - 1];
        if (c.high < prev.high && c.low > prev.low) {
          const next = candles[i + 1];
          if (signal.action === 'buy' && next.close > prev.high) {
            if (Math.abs(next.close - signal.price) < signal.atr * 1.5) {
              signal.entryPattern = 'inside_bar_breakout_bullish';
              return true;
            }
          }
          if (signal.action === 'sell' && next.close < prev.low) {
            if (Math.abs(next.close - signal.price) < signal.atr * 1.5) {
              signal.entryPattern = 'inside_bar_breakout_bearish';
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  // ── Killzone with session weighting ──────────────────────────────
  _checkKillzone(timestamp, profile) {
    const now = timestamp ? new Date(timestamp) : new Date();
    const utcHour = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const time = utcHour + utcMinutes / 60;

    const kz = config.killzones;
    const inDeadzone = kz.deadzones.some(dz => time >= dz.start && time < dz.end);
    if (inDeadzone) return { allowed: false, session: 'dead' };

    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = (time >= kz.asia.start || time < kz.asia.end);

    const session = inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session';

    // Off-session = block for daytrade
    if (session === 'off-session') return { allowed: false, session };

    return { allowed: true, overlap: inOverlap, session };
  }

  _isWeekend(timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
    const day = now.getUTCDay();
    return day === 0 || day === 6;
  }

  _isRateLimited(symbol, timestamp) {
    const lastTime = this.lastSignalTime[symbol];
    if (!lastTime) return false;
    return (timestamp || Date.now()) - lastTime < config.strategy.signalCooldown;
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
