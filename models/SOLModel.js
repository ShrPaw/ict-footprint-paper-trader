// ═══════════════════════════════════════════════════════════════════
// SOLModel.js — Retail Momentum Engine
// ═══════════════════════════════════════════════════════════════════
//
// SOL microstructure: retail-dominated, extreme volatility, weak respect
// for institutional structure (order blocks, OTE). Edge comes from MOMENTUM
// and ORDER FLOW IMBALANCE, not from ICT levels.
//
// Core features:
//   - Stacked delta imbalance (consecutive one-sided flow)
//   - Delta divergence (flow vs price disagreement)
//   - Short-term momentum (rate of price change)
//   - Volatility expansion filter (avoid entering after big moves)
//   - Late-move filter (avoid chasing)
//
// Avoids:
//   - Order blocks (retail doesn't respect them → 0.5x penalty)
//   - OTE zones (slow, institutional → irrelevant for SOL speed)
//   - Mid-range entries without momentum confirmation
//
// Regime behavior:
//   RANGING: +$5,832 proven — use momentum bounces off range extremes
//   TRENDING_UP: +$1,191 — use continuation stacking
//   VOL_EXPANSION: filtered by ATR z-score (late-move guard)
//   TRENDING_DOWN / LOW_VOL: blocked

import BaseModel from './BaseModel.js';
import config from '../config.js';

export default class SOLModel extends BaseModel {
  constructor() {
    super('SOL_MODEL');
  }

  evaluate(ctx) {
    const { candles15m, index15m, candles1h, index1h, profile, regime } = ctx;

    // ── GATES (mandatory pre-checks) ────────────────────────────
    if (this.isWeekend(ctx.timestamp)) return null;
    const killzone = this.checkKillzone(ctx.timestamp);
    if (!killzone.allowed) return null;
    if (!this.checkSessionGate(profile, killzone)) return null;
    if (!this.checkRegimeBlock(profile, regime)) return null;

    // ── FEATURE EXTRACTION ──────────────────────────────────────
    const features = this._extractFeatures(ctx);
    if (!features) return null;

    // ── SIGNAL LOGIC ────────────────────────────────────────────
    const signal = this._evaluateSignal(ctx, features, regime, killzone);
    return signal;
  }

  _extractFeatures(ctx) {
    const { candles15m, index15m, candles1h, index1h, indicators1h } = ctx;
    if (index15m < 20 || index1h < 20) return null;

    const price = candles1h[index1h].close;
    const atr = indicators1h.atr[index1h];
    if (!atr || atr === 0) return null;

    // ── 1. Delta Context ────────────────────────────────────────
    const deltaHistory = [];
    for (let j = Math.max(0, index15m - 9); j <= index15m; j++) {
      deltaHistory.push(ctx.deltaArr?.[j] ?? this._estDelta(candles15m[j]));
    }
    const currentDelta = deltaHistory[deltaHistory.length - 1];

    // Stacked imbalance: consecutive candles with delta in same direction
    const stackedCount = this._countStacked(deltaHistory);

    // Delta trend: sum of last 10 deltas
    const deltaSum = deltaHistory.reduce((a, b) => a + b, 0);
    const deltaTrend = deltaSum > 0 ? 'bullish' : deltaSum < 0 ? 'bearish' : 'neutral';

    // ── 2. Short-term Momentum ──────────────────────────────────
    const momentumLookback = 5;
    const mStart = Math.max(0, index15m - momentumLookback);
    const momentum = (candles15m[index15m].close - candles15m[mStart].close) / candles15m[mStart].close;
    const momentumDir = momentum > 0 ? 'bullish' : momentum < 0 ? 'bearish' : 'neutral';

    // ── 3. Volatility Filter ────────────────────────────────────
    const atrZ = this.computeATRzScore(candles1h, index1h);

    // ── 4. Late-Move Filter ─────────────────────────────────────
    const distFromMean = this.priceDistanceFromMean(candles1h, index1h, 20);

    // ── 5. Volume Context ───────────────────────────────────────
    const volRatio = indicators1h.volumeMetrics?.volumeRatio?.[index1h] ?? 1.0;

    return {
      price, atr,
      deltaHistory, currentDelta, deltaSum, deltaTrend,
      stackedCount,
      momentum, momentumDir,
      atrZ,
      distFromMean,
      volRatio,
    };
  }

  _evaluateSignal(ctx, features, regime, killzone) {
    const { candles15m, index15m, candles1h, index1h } = ctx;
    const f = features;

    // ═══════════════════════════════════════════════════════════════
    // FILTER 1: Volatility expansion → NO TRADE
    // If ATR z-score > 2, the big move already happened.
    // Entering here = chasing. Emergency stop magnet.
    // ═══════════════════════════════════════════════════════════════
    if (f.atrZ > 2.0) return null;

    // ═══════════════════════════════════════════════════════════════
    // FILTER 2: Late move → NO TRADE
    // Price > 2 ATR from 20-period mean = move already extended
    // ═══════════════════════════════════════════════════════════════
    if (f.distFromMean > 2.0) return null;

    // ═══════════════════════════════════════════════════════════════
    // CORE SIGNAL: Stacked Imbalance + Momentum
    // SOL's edge: when 3+ consecutive deltas align with momentum
    // and price is confirming, the move has fuel.
    // ═══════════════════════════════════════════════════════════════

    // Determine direction from delta + momentum alignment
    const bullish = f.deltaTrend === 'bullish' && f.momentumDir === 'bullish';
    const bearish = f.deltaTrend === 'bearish' && f.momentumDir === 'bearish';

    if (!bullish && !bearish) return null;

    const direction = bullish ? 'bullish' : 'bearish';
    const action = bullish ? 'buy' : 'sell';

    // ── Confidence Scoring (SOL-specific) ──────────────────────
    let confidence = 0;
    const reasons = [];

    // A) Stacked imbalance (THE core feature for SOL)
    if (f.stackedCount >= 5) {
      confidence += 0.35;
      reasons.push(`${f.stackedCount} stacked delta`);
    } else if (f.stackedCount >= 3) {
      confidence += 0.25;
      reasons.push(`${f.stackedCount} stacked delta`);
    } else {
      return null; // SOL needs stacking — without it, no edge
    }

    // B) Momentum confirmation
    const absMom = Math.abs(f.momentum);
    if (absMom > 0.005) {
      confidence += 0.20;
      reasons.push('strong momentum');
    } else if (absMom > 0.002) {
      confidence += 0.12;
      reasons.push('moderate momentum');
    } else {
      confidence += 0.05; // weak momentum still viable with strong stacking
    }

    // C) Volume support
    if (f.volRatio > 1.5) {
      confidence += 0.15;
      reasons.push(`vol ${f.volRatio.toFixed(1)}x`);
    } else if (f.volRatio > 1.0) {
      confidence += 0.08;
    }

    // D) Regime-specific boost
    if (regime === 'RANGING') {
      // SOL thrives in RANGING — boost if near range extremes
      const pricePos = this._pricePositionInRange(candles1h, index1h, 20);
      if ((direction === 'bullish' && pricePos < 0.3) || (direction === 'bearish' && pricePos > 0.7)) {
        confidence += 0.15;
        reasons.push('range extreme bounce');
      } else {
        confidence += 0.05;
      }
    } else if (regime === 'TRENDING_UP') {
      // In trend, continuation stacking works
      if (f.stackedCount >= 4) {
        confidence += 0.10;
        reasons.push('trend continuation');
      }
    }

    // E) Session boost
    const sessionWeight = ctx.profile.sessionWeights[killzone.session] || 1.0;
    confidence *= sessionWeight;

    // F) Regime-specific threshold multiplier
    const regimeMult = { VOL_EXPANSION: 0.90, TRENDING_UP: 1.05, RANGING: 0.95 };
    confidence *= (regimeMult[regime] ?? 1.0);

    // ── Threshold Check (per-asset) ─────────────────────────────
    const minSolo = ctx.profile.daytrade.minSoloScore ?? 0.85;
    const minConfluence = ctx.profile.daytrade.minConfluenceScore ?? 0.75;

    // SOL bonus: delta divergence adds confluence
    const hasDivergence = this._checkDivergence(f.deltaHistory, candles15m, index15m);
    if (hasDivergence) {
      confidence += config.strategy.confluenceBonus;
      reasons.push('delta divergence');
    }

    const threshold = hasDivergence ? minConfluence : minSolo;
    if (confidence < threshold) return null;

    // ── Build Signal ────────────────────────────────────────────
    return this.buildSignal(ctx, {
      type: hasDivergence ? 'SOL_MOMENTUM_DIV' : 'SOL_STACKED_IMBALANCE',
      action,
      direction,
      confidence: Math.min(confidence, 0.98),
      reason: `SOL: ${reasons.join(' + ')}`,
      extra: {
        stackedCount: f.stackedCount,
        momentum: f.momentum,
        atrZ: f.atrZ,
        distFromMean: f.distFromMean,
      },
    });
  }

  // ── SOL-Specific Helpers ────────────────────────────────────────

  /**
   * Count consecutive candles with delta in the dominant direction
   */
  _countStacked(deltas) {
    if (deltas.length < 2) return 0;
    let maxStack = 1;
    let currentStack = 1;
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

  /**
   * Check delta divergence: price moving one way, delta moving opposite
   */
  _checkDivergence(deltas, candles, index) {
    if (deltas.length < 6) return false;

    const priceUp = candles[index].close > candles[Math.max(0, index - 5)].close;
    const priceDown = candles[index].close < candles[Math.max(0, index - 5)].close;

    const recentDelta = deltas.slice(-3).reduce((a, b) => a + b, 0);
    const olderDelta = deltas.slice(-6, -3).reduce((a, b) => a + b, 0);

    // Bullish divergence: price down but delta strengthening
    if (priceDown && recentDelta > olderDelta && recentDelta > 0) return true;
    // Bearish divergence: price up but delta weakening
    if (priceUp && recentDelta < olderDelta && recentDelta < 0) return true;

    return false;
  }

  /**
   * Price position within recent range (0-1)
   */
  _pricePositionInRange(candles, index, lookback) {
    const start = Math.max(0, index - lookback);
    let high = -Infinity, low = Infinity;
    for (let i = start; i <= index; i++) {
      if (candles[i].high > high) high = candles[i].high;
      if (candles[i].low < low) low = candles[i].low;
    }
    const range = high - low;
    return range > 0 ? (candles[index].close - low) / range : 0.5;
  }

  /**
   * Estimated delta from OHLCV (when real footprint unavailable)
   */
  _estDelta(candle) {
    const range = candle.high - candle.low;
    if (range === 0) return 0;
    const closePos = (candle.close - candle.low) / range;
    return (closePos - 0.5) * 2 * candle.volume;
  }
}
