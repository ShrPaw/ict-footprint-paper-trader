// ═══════════════════════════════════════════════════════════════════
// BTCModel.js — Institutional Structure Engine
// ═══════════════════════════════════════════════════════════════════
//
// BTC microstructure: deep institutional liquidity, clean price structure,
// strong respect for ICT levels (order blocks, OTE zones, sweeps).
// Edge comes from STRUCTURAL entries, not momentum.
//
// Core features:
//   - Order block retest (institutional supply/demand)
//   - OTE zone confluence (fibonacci-based reversal zones)
//   - Liquidity sweep → reversal (stop hunt → real move)
//   - EMA alignment (directional filter)
//   - Delta confirmation (flow validates structure)
//
// Avoids:
//   - Aggressive entries during volatility spikes
//   - Stacked imbalance / momentum-only setups (retail noise)
//   - Mid-range entries without structural context
//
// Regime behavior:
//   TRENDING_UP: +$2,343 — structure break → continuation
//   RANGING: blocked (-$728 historically)
//   VOL_EXPANSION: blocked in current config (needs structural entry)
//   TRENDING_DOWN / LOW_VOL: blocked

import BaseModel from './BaseModel.js';
import config from '../config.js';

export default class BTCModel extends BaseModel {
  constructor() {
    super('BTC_MODEL');
  }

  evaluate(ctx) {
    const { candles15m, index15m, candles1h, index1h, profile, regime } = ctx;

    // ── GATES ───────────────────────────────────────────────────
    if (this.isWeekend(ctx.timestamp)) return null;
    const killzone = this.checkKillzone(ctx.timestamp);
    if (!killzone.allowed) return null;
    if (!this.checkSessionGate(profile, killzone)) return null;
    if (!this.checkRegimeBlock(profile, regime)) return null;

    // ── FEATURE EXTRACTION ──────────────────────────────────────
    const features = this._extractFeatures(ctx);
    if (!features) return null;

    // ── SIGNAL LOGIC ────────────────────────────────────────────
    return this._evaluateSignal(ctx, features, regime, killzone);
  }

  _extractFeatures(ctx) {
    const { candles15m, index15m, candles1h, index1h, indicators1h } = ctx;
    if (index15m < 20 || index1h < 20) return null;

    const price = candles1h[index1h].close;
    const atr = indicators1h.atr[index1h];
    if (!atr || atr === 0) return null;

    // ── 1. EMA Alignment (stronger requirement for BTC) ─────────
    const ema9 = indicators1h.ema9[index1h];
    const ema21 = indicators1h.ema21[index1h];
    const ema50 = indicators1h.ema50[index1h];

    // BTC needs full EMA stack alignment (not just price > EMA21)
    const bullishStack = ema9 > ema21 && ema21 > ema50 && price > ema9;
    const bearishStack = ema9 < ema21 && ema21 < ema50 && price < ema9;
    const bullishWeak = price > ema21 && price > ema50;
    const bearishWeak = price < ema21 && price < ema50;

    // ── 2. Order Block Context ──────────────────────────────────
    const obSignals = ctx.obSignals || [];
    const activeOB = this._findActiveOB(obSignals, price, atr);

    // ── 3. OTE Zone Context ─────────────────────────────────────
    const oteSignals = ctx.oteSignals || [];
    const inOTE = oteSignals.length > 0;

    // ── 4. Liquidity Sweep Context ──────────────────────────────
    const sweepSignals = ctx.sweepSignals || [];
    const recentSweep = sweepSignals.length > 0 ? sweepSignals[0] : null;

    // ── 5. Delta Confirmation ───────────────────────────────────
    const deltaHistory = [];
    for (let j = Math.max(0, index15m - 4); j <= index15m; j++) {
      deltaHistory.push(ctx.deltaArr?.[j] ?? this._estDelta(candles15m[j]));
    }
    const deltaSum = deltaHistory.reduce((a, b) => a + b, 0);
    const deltaConfirms = deltaSum > 0 ? 'bullish' : deltaSum < 0 ? 'bearish' : 'neutral';

    // ── 6. Volatility Spike Filter ──────────────────────────────
    const atrZ = this.computeATRzScore(candles1h, index1h);

    // ── 7. Structure Break Detection ────────────────────────────
    const structureBreak = this._detectStructureBreak(candles1h, index1h);

    return {
      price, atr,
      bullishStack, bearishStack, bullishWeak, bearishWeak,
      ema9, ema21, ema50,
      activeOB, inOTE, recentSweep,
      deltaConfirms, deltaSum,
      atrZ,
      structureBreak,
    };
  }

  _evaluateSignal(ctx, features, regime, killzone) {
    const f = features;

    // ═══════════════════════════════════════════════════════════════
    // FILTER 1: Volatility spike → AVOID aggressive entries
    // BTC during spikes = knife catching. Let the move settle.
    // ═══════════════════════════════════════════════════════════════
    if (f.atrZ > 1.5) return null;

    // ═══════════════════════════════════════════════════════════════
    // CORE SIGNAL 1: Liquidity Sweep → Reversal (highest quality)
    // BTC's signature: stop hunt below/above level → real move
    // ═══════════════════════════════════════════════════════════════
    if (f.recentSweep) {
      const sweepDir = f.recentSweep.direction; // 'bullish' = sweep below → go up
      const action = sweepDir === 'bullish' ? 'buy' : 'sell';

      // Direction must align with EMA
      if ((action === 'buy' && !f.bullishWeak) || (action === 'sell' && !f.bearishWeak)) {
        return null; // Sweep against trend = trap
      }

      // Delta must confirm
      if (f.deltaConfirms !== sweepDir) {
        return null; // No flow support = weak reversal
      }

      let confidence = 0.60;
      const reasons = ['liquidity sweep reversal'];

      // Full EMA stack bonus
      if ((action === 'buy' && f.bullishStack) || (action === 'sell' && f.bearishStack)) {
        confidence += 0.15;
        reasons.push('full EMA stack');
      }

      // OB confluence
      if (f.activeOB && f.activeOB.direction === sweepDir) {
        confidence += 0.12;
        reasons.push('OB confluence');
      }

      // OTE confluence
      if (f.inOTE) {
        confidence += 0.08;
        reasons.push('OTE zone');
      }

      // Session boost
      const sessionWeight = ctx.profile.sessionWeights[killzone.session] || 1.0;
      confidence *= sessionWeight;

      // Regime multiplier
      const regimeMult = { VOL_EXPANSION: 0.90, TRENDING_UP: 1.05, RANGING: 0.95 };
      confidence *= (regimeMult[regime] ?? 1.0);

      const minSolo = ctx.profile.daytrade.minSoloScore ?? 0.88;
      if (confidence < minSolo) return null;

      return this.buildSignal(ctx, {
        type: 'BTC_SWEEP_REVERSAL',
        action,
        direction: sweepDir,
        confidence: Math.min(confidence, 0.98),
        reason: `BTC: ${reasons.join(' + ')}`,
        extra: { sweepType: f.recentSweep.type, deltaConfirms: f.deltaConfirms },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // CORE SIGNAL 2: Order Block Retest + Structure
    // BTC respects OBs. Entry at OB with EMA alignment = high probability.
    // ═══════════════════════════════════════════════════════════════
    if (f.activeOB) {
      const obDir = f.activeOB.direction;
      const action = obDir === 'bullish' ? 'buy' : 'sell';

      // MUST have full EMA stack alignment (BTC is strict)
      if ((action === 'buy' && !f.bullishStack) || (action === 'sell' && !f.bearishStack)) {
        return null;
      }

      // Delta must confirm
      if (f.deltaConfirms !== obDir) return null;

      let confidence = 0.55;
      const reasons = ['order block retest'];

      // OB confidence from precompute
      confidence += (f.activeOB.confidence || 0.5) * 0.2;

      // OTE adds confluence
      if (f.inOTE) {
        confidence += 0.12;
        reasons.push('OTE confluence');
      }

      // Structure break confirms
      if (f.structureBreak && f.structureBreak.direction === obDir) {
        confidence += 0.10;
        reasons.push('structure break');
      }

      // Volume support
      const volRatio = ctx.volumeRatio ?? 1.0;
      if (volRatio > 1.2) {
        confidence += 0.08;
        reasons.push(`vol ${volRatio.toFixed(1)}x`);
      }

      // Session boost
      const sessionWeight = ctx.profile.sessionWeights[killzone.session] || 1.0;
      confidence *= sessionWeight;

      // Regime multiplier
      const regimeMult = { VOL_EXPANSION: 0.90, TRENDING_UP: 1.05, RANGING: 0.95 };
      confidence *= (regimeMult[regime] ?? 1.0);

      // Confluence threshold (OB needs confluence)
      const minConfluence = ctx.profile.daytrade.minConfluenceScore ?? 0.78;
      if (confidence < minConfluence) return null;

      return this.buildSignal(ctx, {
        type: 'BTC_OB_RETEST',
        action,
        direction: obDir,
        confidence: Math.min(confidence, 0.95),
        reason: `BTC: ${reasons.join(' + ')}`,
        extra: { obConfidence: f.activeOB.confidence },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // CORE SIGNAL 3: OTE Zone + EMA Stack (no OB needed)
    // Price at OTE with full alignment = continuation entry
    // ═══════════════════════════════════════════════════════════════
    if (f.inOTE) {
      // Determine direction from EMA
      if (!f.bullishStack && !f.bearishStack) return null;

      const direction = f.bullishStack ? 'bullish' : 'bearish';
      const action = direction === 'bullish' ? 'buy' : 'sell';

      // Delta must confirm
      if (f.deltaConfirms !== direction) return null;

      let confidence = 0.52;
      const reasons = ['OTE zone'];

      // Full stack bonus
      confidence += 0.15;
      reasons.push('full EMA stack');

      // Structure break
      if (f.structureBreak && f.structureBreak.direction === direction) {
        confidence += 0.10;
        reasons.push('structure break');
      }

      // Session boost
      const sessionWeight = ctx.profile.sessionWeights[killzone.session] || 1.0;
      confidence *= sessionWeight;

      const regimeMult = { VOL_EXPANSION: 0.90, TRENDING_UP: 1.05, RANGING: 0.95 };
      confidence *= (regimeMult[regime] ?? 1.0);

      const minSolo = ctx.profile.daytrade.minSoloScore ?? 0.88;
      if (confidence < minSolo) return null;

      return this.buildSignal(ctx, {
        type: 'BTC_OTE_ENTRY',
        action,
        direction,
        confidence: Math.min(confidence, 0.95),
        reason: `BTC: ${reasons.join(' + ')}`,
      });
    }

    return null;
  }

  // ── BTC-Specific Helpers ────────────────────────────────────────

  /**
   * Find active order block near current price
   */
  _findActiveOB(obSignals, price, atr) {
    if (!obSignals || obSignals.length === 0) return null;
    const tolerance = atr * 1.5;

    for (const sig of obSignals) {
      if (sig.type !== 'ORDER_BLOCK') continue;
      const obMid = ((sig.top || 0) + (sig.bottom || 0)) / 2;
      if (Math.abs(price - obMid) < tolerance) return sig;
    }
    return null;
  }

  /**
   * Detect recent structure break (higher high / lower low break)
   */
  _detectStructureBreak(candles, index) {
    if (index < 15) return null;

    const lookback = 10;
    const start = index - lookback;

    // Find swing high and low in lookback
    let swingHigh = -Infinity, swingLow = Infinity;
    let swingHighIdx = start, swingLowIdx = start;

    for (let i = start; i < index - 2; i++) {
      if (candles[i].high > swingHigh) { swingHigh = candles[i].high; swingHighIdx = i; }
      if (candles[i].low < swingLow) { swingLow = candles[i].low; swingLowIdx = i; }
    }

    const currentCandle = candles[index];

    // Bullish break: price breaks above recent swing high
    if (currentCandle.close > swingHigh && currentCandle.close > currentCandle.open) {
      return { type: 'BOS', direction: 'bullish', level: swingHigh };
    }

    // Bearish break: price breaks below recent swing low
    if (currentCandle.close < swingLow && currentCandle.close < currentCandle.open) {
      return { type: 'BOS', direction: 'bearish', level: swingLow };
    }

    return null;
  }

  _estDelta(candle) {
    const range = candle.high - candle.low;
    if (range === 0) return 0;
    const closePos = (candle.close - candle.low) / range;
    return (closePos - 0.5) * 2 * candle.volume;
  }
}
