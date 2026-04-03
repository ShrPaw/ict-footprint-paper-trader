// ═══════════════════════════════════════════════════════════════════
// BaseModel.js — Abstract interface for per-asset models
// ═══════════════════════════════════════════════════════════════════
//
// Each asset model implements:
//   evaluate(ctx) → { signal, diagnostics } | null
//
// Context (ctx) provides precomputed data. Models extract their own features.
// Models do NOT share signal logic. Each is an independent alpha engine.

import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';

export default class BaseModel {
  constructor(name) {
    this.name = name;
    this._atrCache = {};
    this._emaCache = {};
  }

  /**
   * Evaluate context and return signal or null.
   * MUST be implemented by subclasses.
   * @returns {{ signal: object|null, diagnostics: object }}
   */
  evaluate(ctx) {
    throw new Error(`${this.name}.evaluate() not implemented`);
  }

  // ── Shared utilities (available to all models) ────────────────

  /**
   * Check killzone — returns { allowed, session, overlap }
   */
  checkKillzone(timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
    const time = now.getUTCHours() + now.getUTCMinutes() / 60;
    const kz = config.killzones;

    if (kz.deadzones.some(dz => time >= dz.start && time < dz.end)) {
      return { allowed: false, session: 'dead', overlap: false };
    }

    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = (time >= kz.asia.start || time < kz.asia.end);

    const session = inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session';
    if (session === 'off-session') return { allowed: false, session, overlap: false };

    return { allowed: true, session, overlap: inOverlap };
  }

  /**
   * Check weekend filter
   */
  isWeekend(timestamp) {
    const day = timestamp ? new Date(timestamp).getUTCDay() : new Date().getUTCDay();
    return day === 0 || day === 6;
  }

  /**
   * Check session hard-gate from profile
   */
  checkSessionGate(profile, killzone) {
    if (profile.allowedSessions && !profile.allowedSessions.includes(killzone.session)) {
      return false;
    }
    return true;
  }

  /**
   * Check regime blocking from profile
   */
  checkRegimeBlock(profile, regime) {
    return !profile.blockedRegimes?.includes(regime);
  }

  /**
   * Compute ATR z-score (current ATR relative to recent history)
   * Used for volatility expansion/contraction detection
   */
  computeATRzScore(candles, index, period = 14, lookback = 50) {
    if (index < period + lookback) return 0;

    // Current ATR
    const tr = [];
    for (let i = Math.max(1, index - period); i <= index; i++) {
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    const currentATR = tr.reduce((a, b) => a + b, 0) / tr.length;

    // Historical ATR distribution
    const atrs = [];
    for (let start = Math.max(period, index - lookback); start <= index - period; start += Math.max(1, Math.floor(period / 2))) {
      const htr = [];
      for (let i = start; i < start + period && i <= index; i++) {
        htr.push(Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - candles[Math.max(0, i - 1)].close),
          Math.abs(candles[i].low - candles[Math.max(0, i - 1)].close)
        ));
      }
      if (htr.length === period) atrs.push(htr.reduce((a, b) => a + b, 0) / htr.length);
    }

    if (atrs.length < 5) return 0;

    const mean = atrs.reduce((a, b) => a + b, 0) / atrs.length;
    const variance = atrs.reduce((s, v) => s + (v - mean) ** 2, 0) / atrs.length;
    const std = Math.sqrt(variance);

    return std > 0 ? (currentATR - mean) / std : 0;
  }

  /**
   * Price distance from 20-period mean in ATR units
   * Detects "late move" — entry too far from mean
   */
  priceDistanceFromMean(candles, index, period = 20) {
    if (index < period) return 0;
    const price = candles[index].close;
    let sum = 0;
    for (let i = index - period + 1; i <= index; i++) sum += candles[i].close;
    const mean = sum / period;

    // ATR for normalization
    const tr = [];
    for (let i = Math.max(1, index - 13); i <= index; i++) {
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    const atr = tr.reduce((a, b) => a + b, 0) / tr.length;

    return atr > 0 ? Math.abs(price - mean) / atr : 0;
  }

  /**
   * Build a standard signal object
   */
  buildSignal(ctx, { type, action, direction, confidence, reason, extra = {} }) {
    const profile = ctx.profile || getProfile(ctx.symbol);
    const regime = ctx.regime;
    const atr = ctx.atr;
    const price = ctx.price;

    const slMult = (profile.riskOverrides?.slMultiplier ?? config.risk[regime]?.slMultiplier ?? 0.9) * profile.slTightness;
    const tpMult = config.risk[regime]?.tpMultiplier || 2.5;

    const stopLoss = action === 'buy'
      ? price - atr * slMult
      : price + atr * slMult;

    const takeProfit = action === 'buy'
      ? price + atr * tpMult
      : price - atr * tpMult;

    return {
      type,
      action,
      direction,
      confidence,
      price,
      stopLoss,
      takeProfit,
      atr,
      regime,
      mode: 'DAYTRADE',
      source: this.name,
      combinedScore: confidence,
      reason,
      assetProfile: profile.name,
      profile,
      isWeekend: false,
      session: ctx.killzone?.session,
      ...extra,
    };
  }
}
