// ═══════════════════════════════════════════════════════════════════
// ETHModel.js — Hybrid Confluence Engine
// ═══════════════════════════════════════════════════════════════════
//
// ETH microstructure: mixed institutional/retail flow. Noisy alone —
// both ICT and order flow signals produce false positives in isolation.
// Edge comes from CONFLUENCE ONLY: ICT signal + cluster/flow confirmation.
//
// Core rule: No confluence = No trade. Period.
//
// Core features:
//   - ICT zone presence (OB, sweep, OTE — ANY one)
//   - Cluster confirmation (absorption, continuation, trapped)
//   - OrderFlowEngine pipeline pass
//   - EMA alignment (directional bias)
//   - Volume confirmation
//
// Avoids:
//   - Solo ICT signals (too noisy for ETH's mixed flow)
//   - Solo flow signals (no structural context)
//   - Mid-range entries without BOTH ICT + flow
//
// Regime behavior:
//   TRENDING_UP: primary regime (was -$491 with old logic, now restructured)
//   RANGING: blocked historically (-$1,869) — may reopen with confluence-only
//   VOL_EXPANSION: gated through OrderFlowEngine
//   TRENDING_DOWN / LOW_VOL: blocked

import BaseModel from './BaseModel.js';
import config from '../config.js';

export default class ETHModel extends BaseModel {
  constructor() {
    super('ETH_MODEL');
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

    // ── 1. EMA Alignment ────────────────────────────────────────
    const ema21 = indicators1h.ema21[index1h];
    const ema50 = indicators1h.ema50[index1h];
    const bullish = price > ema21 && price > ema50;
    const bearish = price < ema21 && price < ema50;

    if (!bullish && !bearish) return null; // ETH needs clear direction

    // ── 2. ICT Zone Detection ───────────────────────────────────
    const hasOB = (ctx.obSignals || []).some(s => s.type === 'ORDER_BLOCK');
    const hasSweep = (ctx.sweepSignals || []).length > 0;
    const hasOTE = (ctx.oteSignals || []).length > 0;
    const hasAnyICT = hasOB || hasSweep || hasOTE;

    // ── 3. Flow Signal Detection ────────────────────────────────
    const deltaHistory = [];
    for (let j = Math.max(0, index15m - 9); j <= index15m; j++) {
      deltaHistory.push(ctx.deltaArr?.[j] ?? this._estDelta(candles15m[j]));
    }
    const deltaSum = deltaHistory.reduce((a, b) => a + b, 0);
    const deltaDir = deltaSum > 0 ? 'bullish' : deltaSum < 0 ? 'bearish' : 'neutral';

    // Flow features
    const stackedCount = this._countStacked(deltaHistory);
    const hasDivergence = this._checkDivergence(deltaHistory, candles15m, index15m);
    const hasFlowSignal = stackedCount >= 3 || hasDivergence || Math.abs(deltaSum) > (ctx.volumeRatio ?? 1) * atr * 50;

    // ── 4. Volume Context ───────────────────────────────────────
    const volRatio = indicators1h.volumeMetrics?.volumeRatio?.[index1h] ?? 1.0;

    // ── 5. Volatility Context ───────────────────────────────────
    const atrZ = this.computeATRzScore(candles1h, index1h);

    return {
      price, atr,
      bullish, bearish,
      ema21, ema50,
      hasOB, hasSweep, hasOTE, hasAnyICT,
      deltaDir, deltaSum, deltaHistory,
      stackedCount, hasDivergence, hasFlowSignal,
      volRatio,
      atrZ,
    };
  }

  _evaluateSignal(ctx, features, regime, killzone) {
    const f = features;

    // ═══════════════════════════════════════════════════════════════
    // MANDATORY RULE: No confluence = No trade
    // ETH's mixed flow means solo signals are noise.
    // MUST have both ICT zone AND flow confirmation.
    // ═══════════════════════════════════════════════════════════════

    // Need at least one ICT zone
    if (!f.hasAnyICT) return null;

    // Need at least one flow signal
    if (!f.hasFlowSignal) return null;

    // ── Determine Direction ─────────────────────────────────────
    // Direction from EMA (structural), must agree with at least one signal source
    const direction = f.bullish ? 'bullish' : 'bearish';
    const action = direction === 'bullish' ? 'buy' : 'sell';

    // ICT direction check
    const ictAgrees = this._ictDirectionAgrees(ctx, direction);

    // Flow direction check
    const flowAgrees = f.deltaDir === direction || f.hasDivergence;

    // At least one source must agree with EMA direction
    if (!ictAgrees && !flowAgrees) return null;

    // ═══════════════════════════════════════════════════════════════
    // CONFIDENCE SCORING
    // ═══════════════════════════════════════════════════════════════
    let confidence = 0;
    const reasons = [];

    // A) ICT Zone Quality
    if (f.hasSweep) {
      confidence += 0.25;
      reasons.push('liquidity sweep');
    }
    if (f.hasOB) {
      confidence += 0.15;
      reasons.push('order block');
    }
    if (f.hasOTE) {
      confidence += 0.12;
      reasons.push('OTE zone');
    }

    // Multiple ICT zones = stronger
    const ictCount = [f.hasOB, f.hasSweep, f.hasOTE].filter(Boolean).length;
    if (ictCount >= 2) {
      confidence += 0.08;
      reasons.push('multi-ICT');
    }

    // B) Flow Quality
    if (f.stackedCount >= 4) {
      confidence += 0.20;
      reasons.push(`${f.stackedCount} stacked delta`);
    } else if (f.stackedCount >= 3) {
      confidence += 0.12;
      reasons.push(`${f.stackedCount} stacked delta`);
    }

    if (f.hasDivergence) {
      confidence += 0.15;
      reasons.push('delta divergence');
    }

    // C) Directional Agreement Bonus (the confluence that matters)
    if (ictAgrees && flowAgrees) {
      confidence += config.strategy.confluenceBonus; // 0.15
      reasons.push('ICT + flow agree');
    }

    // D) Volume Confirmation
    if (f.volRatio > 1.3) {
      confidence += 0.10;
      reasons.push(`vol ${f.volRatio.toFixed(1)}x`);
    }

    // E) Regime-specific adjustments
    if (regime === 'TRENDING_UP') {
      // ETH works well in trends with confluence
      if (ictAgrees && flowAgrees) confidence += 0.05;
    }

    if (regime === 'VOL_EXPANSION') {
      // In vol expansion, require stronger confirmation
      confidence *= 0.95;
    }

    // F) Session boost
    const sessionWeight = ctx.profile.sessionWeights[killzone.session] || 1.0;
    confidence *= sessionWeight;

    // G) Regime threshold multiplier
    const regimeMult = { VOL_EXPANSION: 0.90, TRENDING_UP: 1.05, RANGING: 0.95 };
    confidence *= (regimeMult[regime] ?? 1.0);

    // ── Threshold Check ─────────────────────────────────────────
    const minConfluence = ctx.profile.daytrade.minConfluenceScore ?? 0.80;

    // ETH always uses confluence threshold (mandatory confluence rule)
    if (confidence < minConfluence) return null;

    // ── Build Signal ────────────────────────────────────────────
    return this.buildSignal(ctx, {
      type: 'ETH_CONFLUENCE',
      action,
      direction,
      confidence: Math.min(confidence, 0.98),
      reason: `ETH: ${reasons.join(' + ')}`,
      extra: {
        ictCount,
        flowType: f.hasDivergence ? 'divergence' : f.stackedCount >= 3 ? 'stacked' : 'delta',
        ictAgrees,
        flowAgrees,
      },
    });
  }

  // ── ETH-Specific Helpers ────────────────────────────────────────

  /**
   * Check if ICT signals agree with the intended direction
   */
  _ictDirectionAgrees(ctx, direction) {
    const sweepDir = ctx.sweepSignals?.[0]?.direction;
    const obDir = ctx.obSignals?.find(s => s.type === 'ORDER_BLOCK')?.direction;
    const oteDir = ctx.oteSignals?.[0]?.direction;

    return sweepDir === direction || obDir === direction || oteDir === direction;
  }

  _countStacked(deltas) {
    if (deltas.length < 2) return 0;
    let maxStack = 1, currentStack = 1;
    let lastSign = Math.sign(deltas[0]);
    for (let i = 1; i < deltas.length; i++) {
      const sign = Math.sign(deltas[i]);
      if (sign === lastSign && sign !== 0) {
        currentStack++;
        maxStack = Math.max(maxStack, currentStack);
      } else {
        currentStack = 1;
        lastSign = sign;
      }
    }
    return maxStack;
  }

  _checkDivergence(deltas, candles, index) {
    if (deltas.length < 6) return false;
    const priceUp = candles[index].close > candles[Math.max(0, index - 5)].close;
    const priceDown = candles[index].close < candles[Math.max(0, index - 5)].close;
    const recentDelta = deltas.slice(-3).reduce((a, b) => a + b, 0);
    const olderDelta = deltas.slice(-6, -3).reduce((a, b) => a + b, 0);

    if (priceDown && recentDelta > olderDelta && recentDelta > 0) return true;
    if (priceUp && recentDelta < olderDelta && recentDelta < 0) return true;
    return false;
  }

  _estDelta(candle) {
    const range = candle.high - candle.low;
    if (range === 0) return 0;
    const closePos = (candle.close - candle.low) / range;
    return (closePos - 0.5) * 2 * candle.volume;
  }
}
