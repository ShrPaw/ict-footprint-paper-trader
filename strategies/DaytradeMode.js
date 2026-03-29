// ── Mode 1: Daytrade (Trend-Focused, Weekdays Only) ────────────────
// ICT on 1H where price action is cleaner.
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

    // 2. Killzone check
    const killzone = this._checkKillzone(lastCandle.timestamp);
    if (!killzone.allowed) return null;

    // 3. Regime detection on 1H
    const regimeResult = this.regime.detect(symbol, candles1h);
    const regime = regimeResult.regime;

    // 4. Per-asset regime filtering — each asset only trades in its winning regimes
    if (profile.allowedRegimes.length === 0) return null; // asset excluded entirely
    if (!profile.allowedRegimes.includes(regime)) return null;

    // 5. Also skip universally bad regimes
    if (regime === 'LOW_VOL') return null;
    if (regime === 'TRENDING_DOWN') return null;
    if (regime === 'TRENDING_UP') return null;

    // 6. EMA50 slope trend escape for RANGING regime
    // In Jul-Nov 2024, SOL's regime detector classified slow uptrends as "RANGING"
    // because ADX was low. But EMA50 was clearly rising → it's a trend, not a range.
    // Check: if EMA50 slope over 20 candles is > 0.5%, it's trending — not ranging.
    if (regime === 'RANGING') {
      const ema50Now = this._cachedEMA(candles1h, 50);
      const ema50Past = candles1h.length >= 70 ? this._emaFromIndex(candles1h, 50, candles1h.length - 20) : null;
      if (ema50Past && ema50Past > 0) {
        const emaSlope = (ema50Now - ema50Past) / ema50Past;
        if (Math.abs(emaSlope) > 0.005) {
          return null; // EMA50 is sloping >0.5% → trending, not ranging
        }
      }
    }

    const price = candles1h[candles1h.length - 1].close;

    // 5. EMA alignment — require price above/below EMA21 (not full 9>21>50 stack)
    // Relaxed from strict stack to just EMA21 directional filter
    const ema21 = this._cachedEMA(candles1h, 21);
    const ema50 = this._cachedEMA(candles1h, 50);

    const bullish = price > ema21 && price > ema50;
    const bearish = price < ema21 && price < ema50;

    if (!bullish && !bearish) return null;

    // 6. Run ICT analysis on 1H
    const ictResult = this.ict.analyze(symbol, candles1h);

    // 7. Run footprint (use 15m if available for micro-confirmation)
    const fpCandles = candles15m || candles1h;
    const footprintResult = this.footprint.analyze(symbol, fpCandles, realFootprint);

    // 8. Score with asset-specific weights
    const signal = this._scoreSignal(
      regime, ictResult, footprintResult, regimeResult,
      profile, bullish, killzone
    );
    if (!signal) return null;

    // 9. Direction filter
    if (signal.action === 'buy' && !bullish) return null;
    if (signal.action === 'sell' && !bearish) return null;

    // 10. Strict trend alignment in TRENDING regimes
    if (regime === 'TRENDING_UP' && signal.action === 'sell') return null;
    if (regime === 'TRENDING_DOWN' && signal.action === 'buy') return null;

    // 11. Entry confirmation — DISABLED for 1H (pin bars/engulfing too rare on hourly)
    // ICT zones on 1H are already high-quality; candle patterns add noise not signal
    // if (config.strategy.entryConfirmation.enabled) {
    //   const confirmed = this._checkEntryConfirmation(candles1h, signal);
    //   if (!confirmed) return null;
    // }

    // 12. Rate limit (longer for 1H — fewer candles)
    if (this._isRateLimited(symbol, lastCandle.timestamp)) return null;

    // 13. SL/TP — wider for daytrade (let trades develop)
    const atr = this._currentATR(candles1h);
    const slMult = (config.risk[regime]?.slMultiplier || 0.9) * profile.slTightness;
    const tpMult = config.risk[regime]?.tpMultiplier || 2.5;

    const sl = signal.action === 'buy'
      ? price - atr * slMult
      : price + atr * slMult;

    const tp = signal.action === 'buy'
      ? price + atr * tpMult
      : price - atr * tpMult;

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
    };
  }

  _scoreSignal(regime, ict, footprint, regimeResult, profile, bullish, killzone) {
    const ictSignals = ict.signals || [];
    const fpSignals = footprint.signals || [];

    if (ictSignals.length === 0 && fpSignals.length === 0) return null;

    const ictWeight = profile.daytrade.ictWeight;
    const fpWeight = profile.daytrade.footprintWeight;

    const allScored = [];
    for (const sig of ictSignals) {
      if (sig.type === 'FVG') continue; // killed — 24% WR
      if (sig.type === 'ORDER_BLOCK') {
        allScored.push({ ...sig, combinedScore: sig.confidence * ictWeight * 0.5, source: 'ict' });
        continue;
      }
      allScored.push({ ...sig, combinedScore: sig.confidence * ictWeight, source: 'ict' });
    }
    for (const sig of fpSignals) {
      let score = sig.confidence * fpWeight;
      // DELTA_DIVERGENCE: 49% WR globally, -$430. Penalized — only confluence can save it.
      if (sig.type === 'DELTA_DIVERGENCE') score *= 0.5;
      // DELTA_FLIP: 67% WR, +$737. Boosted.
      if (sig.type === 'DELTA_FLIP') score *= 1.5;
      // POC_REACTION: 100% WR. Boosted.
      if (sig.type === 'POC_REACTION') score *= 1.4;
      if (sig.realData) score *= 1.15;
      allScored.push({ ...sig, combinedScore: score, source: 'footprint' });
    }

    if (allScored.length === 0) return null;
    allScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = allScored[0];

    // Per-asset regime boosts (e.g., XRP gets 1.4x in VOL_EXPANSION)
    const regimeBoost = profile.regimeBoosts?.[regime] || 1.0;
    best.combinedScore *= regimeBoost;

    // Signal-specific regime boosts
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

    // Confluence
    const confluenceSignals = allScored.filter(s => s.action === best.action && s.source !== best.source);
    const hasConfluence = confluenceSignals.length > 0;

    if (hasConfluence) {
      best.combinedScore += config.strategy.confluenceBonus;
      best.confluence = true;
      best.confluenceSignals = [best.type, ...confluenceSignals.map(s => s.type)];
      best.reason = `${best.reason} (+ ${confluenceSignals[0].type} confluence)`;
      if (best.combinedScore >= config.strategy.minConfluenceScore) return best;
    }

    if (best.type === 'ORDER_BLOCK' && !hasConfluence) return null;
    if (best.combinedScore >= config.strategy.minSoloScore) return best;
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

  _isWeekend(timestamp) {
    const day = timestamp ? new Date(timestamp).getUTCDay() : new Date().getUTCDay();
    return day === 0 || day === 6;
  }

  _isRateLimited(symbol, timestamp) {
    const lastTime = this.lastSignalTime[symbol];
    if (!lastTime) return false;
    return (timestamp || Date.now()) - lastTime < config.strategy.signalCooldown;
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

  _emaFromIndex(candles, period, endIndex) {
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i <= endIndex && i < candles.length; i++) {
      ema = candles[i].close * k + ema * (1 - k);
    }
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
