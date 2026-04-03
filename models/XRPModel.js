// ═══════════════════════════════════════════════════════════════════
// XRPModel.js — Extreme Event Engine
// ═══════════════════════════════════════════════════════════════════
//
// XRP microstructure: speculative noise machine. Low order flow reliability.
// Edge ONLY exists in extreme conditions — everything else is noise.
//
// Core rule: If not EXTREME → IGNORE.
//
// Core features:
//   - Extreme delta divergence (|delta| > 2σ from mean)
//   - Volume spike (> 2x average)
//   - Price stall (small body, range contraction after expansion)
//   - Confluence of ALL THREE required (no solo signals)
//
// Avoids:
//   - Order blocks (XRP doesn't respect them)
//   - OTE zones (irrelevant for speculative flow)
//   - Momentum setups (retail noise)
//   - Anything "normal" — only extremes have edge
//
// Regime behavior:
//   VOL_EXPANSION: only regime with proven edge (+$1,242 PF 2.27)
//   RANGING: blocked (-$282)
//   TRENDING_UP: blocked (-$171)
//   TRENDING_DOWN / LOW_VOL: blocked

import BaseModel from './BaseModel.js';
import config from '../config.js';

export default class XRPModel extends BaseModel {
  constructor() {
    super('XRP_MODEL');
    // Cache for delta distribution stats
    this._deltaStats = null;
  }

  evaluate(ctx) {
    const { candles15m, index15m, candles1h, index1h, profile, regime } = ctx;

    // ── GATES ───────────────────────────────────────────────────
    if (this.isWeekend(ctx.timestamp)) return null;
    const killzone = this.checkKillzone(ctx.timestamp);
    if (!killzone.allowed) return null;
    if (!this.checkSessionGate(profile, killzone)) return null;
    if (!this.checkRegimeBlock(profile, regime)) return null;

    // XRP only trades in VOL_EXP — double-check
    if (regime !== 'VOL_EXPANSION') return null;

    // ── FEATURE EXTRACTION ──────────────────────────────────────
    const features = this._extractFeatures(ctx);
    if (!features) return null;

    // ── SIGNAL LOGIC ────────────────────────────────────────────
    return this._evaluateSignal(ctx, features, regime, killzone);
  }

  _extractFeatures(ctx) {
    const { candles15m, index15m, candles1h, index1h, indicators1h } = ctx;
    if (index15m < 30 || index1h < 30) return null;

    const price = candles1h[index1h].close;
    const atr = indicators1h.atr[index1h];
    if (!atr || atr === 0) return null;

    // ── 1. Extreme Delta Divergence ─────────────────────────────
    const deltaHistory = [];
    for (let j = Math.max(0, index15m - 19); j <= index15m; j++) {
      deltaHistory.push(ctx.deltaArr?.[j] ?? this._estDelta(candles15m[j]));
    }
    const currentDelta = deltaHistory[deltaHistory.length - 1];

    // Compute delta stats from history
    const absDeltas = deltaHistory.map(Math.abs);
    const meanAbsDelta = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;
    const variance = absDeltas.reduce((s, v) => s + (v - meanAbsDelta) ** 2, 0) / absDeltas.length;
    const stdDelta = Math.sqrt(variance);

    // Current delta z-score
    const deltaZ = stdDelta > 0 ? (Math.abs(currentDelta) - meanAbsDelta) / stdDelta : 0;

    // Is this an EXTREME delta reading?
    const isExtremeDelta = deltaZ > 2.0;

    // Divergence: price vs delta disagreement
    const priceDir = candles15m[index15m].close > candles15m[Math.max(0, index15m - 3)].close ? 'bullish' : 'bearish';
    const deltaDir = currentDelta > 0 ? 'bullish' : 'bearish';
    const hasDivergence = priceDir !== deltaDir && isExtremeDelta;

    // ── 2. Volume Spike ─────────────────────────────────────────
    const volRatio = indicators1h.volumeMetrics?.volumeRatio?.[index1h] ?? 1.0;
    const isVolumeSpike = volRatio > 2.0;

    // Also check 15m volume
    let vol15mRatio = 1.0;
    if (index15m >= 20) {
      let sum15 = 0;
      for (let j = index15m - 19; j <= index15m; j++) sum15 += candles15m[j].volume;
      const avg15 = sum15 / 20;
      vol15mRatio = avg15 > 0 ? candles15m[index15m].volume / avg15 : 1;
    }
    const hasVolumeSpike = isVolumeSpike || vol15mRatio > 2.5;

    // ── 3. Price Stall ──────────────────────────────────────────
    // After expansion, price contracts (small body relative to recent range)
    const candle15m = candles15m[index15m];
    const range15m = candle15m.high - candle15m.low;
    const body15m = Math.abs(candle15m.close - candle15m.open);
    const bodyRatio = range15m > 0 ? body15m / range15m : 1;

    // Compare to recent average body ratio
    let avgBodyRatio = 0;
    const stallLookback = Math.min(10, index15m);
    for (let j = index15m - stallLookback + 1; j <= index15m; j++) {
      const r = candles15m[j].high - candles15m[j].low;
      if (r > 0) avgBodyRatio += Math.abs(candles15m[j].close - candles15m[j].open) / r;
    }
    avgBodyRatio /= stallLookback;

    const isStalling = bodyRatio < avgBodyRatio * 0.5 && bodyRatio < 0.35;

    // ── 4. EMA for direction bias ───────────────────────────────
    const ema21 = indicators1h.ema21[index1h];
    const ema50 = indicators1h.ema50[index1h];
    const bullish = price > ema21 && price > ema50;
    const bearish = price < ema21 && price < ema50;

    return {
      price, atr,
      currentDelta, deltaZ, isExtremeDelta,
      deltaDir, hasDivergence,
      hasVolumeSpike, volRatio, vol15mRatio,
      isStalling, bodyRatio, avgBodyRatio,
      bullish, bearish,
    };
  }

  _evaluateSignal(ctx, features, regime, killzone) {
    const f = features;

    // ═══════════════════════════════════════════════════════════════
    // MANDATORY: ALL THREE EXTREME CONDITIONS MUST BE MET
    // 1. Extreme delta divergence (|z-score| > 2)
    // 2. Volume spike (> 2x average)
    // 3. Price stall (body < 50% of recent avg body ratio)
    //
    // Missing ANY ONE → NO TRADE. XRP's edge is only at extremes.
    // ═══════════════════════════════════════════════════════════════

    if (!f.isExtremeDelta) return null;
    if (!f.hasVolumeSpike) return null;
    if (!f.isStalling) return null;

    // ── Direction ───────────────────────────────────────────────
    // Reversal: extreme delta against price direction = reversal signal
    // Example: price going up, extreme negative delta → sellers absorbing → short
    const direction = f.deltaDir; // delta direction tells us what's being absorbed
    const action = direction === 'bullish' ? 'buy' : 'sell';

    // EMA must not contradict
    if ((action === 'buy' && f.bearish) || (action === 'sell' && f.bullish)) {
      return null; // Fighting the trend = death for XRP
    }

    // ═══════════════════════════════════════════════════════════════
    // CONFIDENCE SCORING
    // ═══════════════════════════════════════════════════════════════
    let confidence = 0.50; // base for meeting all 3 extreme conditions
    const reasons = [];

    // A) Delta extremity
    if (f.deltaZ > 3.0) {
      confidence += 0.20;
      reasons.push(`extreme delta z=${f.deltaZ.toFixed(1)}`);
    } else if (f.deltaZ > 2.5) {
      confidence += 0.15;
      reasons.push(`strong delta z=${f.deltaZ.toFixed(1)}`);
    } else {
      confidence += 0.08;
      reasons.push(`delta z=${f.deltaZ.toFixed(1)}`);
    }

    // B) Volume spike intensity
    const maxVol = Math.max(f.volRatio, f.vol15mRatio);
    if (maxVol > 3.0) {
      confidence += 0.15;
      reasons.push(`vol spike ${maxVol.toFixed(1)}x`);
    } else if (maxVol > 2.5) {
      confidence += 0.10;
      reasons.push(`vol spike ${maxVol.toFixed(1)}x`);
    } else {
      confidence += 0.05;
      reasons.push(`vol ${maxVol.toFixed(1)}x`);
    }

    // C) Stall quality
    if (f.bodyRatio < 0.15) {
      confidence += 0.10;
      reasons.push('strong stall');
    } else {
      confidence += 0.05;
    }

    // D) Divergence bonus (price vs delta disagreement = reversal signal)
    if (f.hasDivergence) {
      confidence += 0.10;
      reasons.push('divergence');
    }

    // E) Session boost
    const sessionWeight = ctx.profile.sessionWeights[killzone.session] || 1.0;
    confidence *= sessionWeight;

    // ── Threshold ───────────────────────────────────────────────
    const minSolo = ctx.profile.daytrade.minSoloScore ?? 0.90;
    if (confidence < minSolo) return null;

    return this.buildSignal(ctx, {
      type: 'XRP_EXTREME_REVERSAL',
      action,
      direction,
      confidence: Math.min(confidence, 0.98),
      reason: `XRP EXTREME: ${reasons.join(' + ')}`,
      extra: {
        deltaZ: f.deltaZ,
        volSpike: maxVol,
        bodyRatio: f.bodyRatio,
        hasDivergence: f.hasDivergence,
      },
    });
  }

  _estDelta(candle) {
    const range = candle.high - candle.low;
    if (range === 0) return 0;
    const closePos = (candle.close - candle.low) / range;
    return (closePos - 0.5) * 2 * candle.volume;
  }
}
