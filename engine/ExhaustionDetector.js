// ═══════════════════════════════════════════════════════════════════
// ExhaustionDetector.js — Entry Quality Engine
// ═══════════════════════════════════════════════════════════════════
//
// PURPOSE: Answer the question — "Is this move already over?"
//
// The system's emergency stops are NOT random. They occur because
// the model confuses exhaustion for continuation:
//   1. Price makes extended move (3-5 candles)
//   2. Delta shows stacked imbalance (same direction)
//   3. Model reads this as "momentum" → enters
//   4. Price reverses sharply (exhaustion)
//   5. Emergency stop fires
//
// This engine DETECTS exhaustion conditions and blocks entries.
//
// Design principles:
//   - Conservative: reject if ANY exhaustion signal fires
//   - Transparent: return detailed diagnostics for every check
//   - Per-asset: thresholds vary by asset volatility profile
//   - Stateless: takes context, returns verdict, stores nothing

import config from '../config.js';

export default class ExhaustionDetector {
  constructor() {
    // Per-asset exhaustion thresholds
    // Tuned from backtest data: where emergency stops clustered
    this.assetThresholds = {
      SOL: {
        maxATRzScore: 1.8,          // ATR z-score above this = volatility spike = exhaustion risk
        maxPriceExtension: 1.8,     // ATR units from 20-period mean = extended
        maxStackedDelta: 4,         // consecutive same-direction deltas = exhaustion zone
        momentumDecayWindow: 5,     // candles to check for momentum deceleration
        maxRecentMove: 2.5,         // ATR moved in last N candles = too late to enter
        volumeSpikeThreshold: 2.5,  // volume ratio above this + extension = climax
      },
      BTC: {
        maxATRzScore: 1.5,
        maxPriceExtension: 2.0,
        maxStackedDelta: 5,
        momentumDecayWindow: 5,
        maxRecentMove: 3.0,
        volumeSpikeThreshold: 2.0,
      },
      ETH: {
        maxATRzScore: 1.8,
        maxPriceExtension: 2.0,
        maxStackedDelta: 4,
        momentumDecayWindow: 5,
        maxRecentMove: 2.5,
        volumeSpikeThreshold: 2.0,
      },
      XRP: {
        maxATRzScore: 2.0,
        maxPriceExtension: 2.5,
        maxStackedDelta: 5,
        momentumDecayWindow: 5,
        maxRecentMove: 3.0,
        volumeSpikeThreshold: 3.0,
      },
    };

    // Default thresholds (for unknown assets)
    this.defaultThresholds = this.assetThresholds.ETH;
  }

  /**
   * Master check: is this entry in an exhaustion zone?
   *
   * @param {object} ctx — Full context from model/backtest
   * @returns {{ blocked: boolean, reason: string, checks: object }}
   *
   * If blocked === true → DO NOT ENTER. Period.
   */
  check(ctx) {
    const coin = this._extractCoin(ctx.symbol);
    const thresholds = this.assetThresholds[coin] || this.defaultThresholds;
    const checks = {};

    // ── CHECK 1: Volatility Spike ───────────────────────────────
    // ATR z-score rising rapidly = market is expanding = late stage
    // If we enter here, we're buying into a climax
    const atrZ = ctx.atrZ ?? this._computeATRz(ctx);
    checks.volatilitySpike = {
      value: atrZ,
      threshold: thresholds.maxATRzScore,
      triggered: atrZ > thresholds.maxATRzScore,
    };

    // ── CHECK 2: Price Extension ────────────────────────────────
    // Price far from 20-period mean = move already happened
    // Entering here = chasing
    const distFromMean = ctx.distFromMean ?? this._priceDistanceFromMean(ctx);
    checks.priceExtension = {
      value: distFromMean,
      threshold: thresholds.maxPriceExtension,
      triggered: distFromMean > thresholds.maxPriceExtension,
    };

    // ── CHECK 3: Stacked Delta Exhaustion ───────────────────────
    // 5+ consecutive same-direction candles = the move is mature
    // This is NOT momentum — it's the final push before reversal
    const stackedCount = ctx.stackedCount ?? this._countStacked(ctx);
    checks.stackedExhaustion = {
      value: stackedCount,
      threshold: thresholds.maxStackedDelta,
      triggered: stackedCount >= thresholds.maxStackedDelta,
    };

    // ── CHECK 4: Recent Move Magnitude ──────────────────────────
    // How far has price moved in the last N candles?
    // If > threshold ATR, the move is already over
    const recentMove = this._recentMoveATR(ctx, thresholds.momentumDecayWindow);
    checks.recentMove = {
      value: recentMove,
      threshold: thresholds.maxRecentMove,
      triggered: recentMove > thresholds.maxRecentMove,
    };

    // ── CHECK 5: Volume Climax ──────────────────────────────────
    // Extreme volume + price extension = buying/selling climax
    // These are almost always exhaustion, not continuation
    const volRatio = ctx.volumeRatio ?? 1.0;
    const volumeClimax = volRatio > thresholds.volumeSpikeThreshold &&
                         distFromMean > thresholds.maxPriceExtension * 0.7;
    checks.volumeClimax = {
      value: volRatio,
      threshold: thresholds.volumeSpikeThreshold,
      extension: distFromMean,
      triggered: volumeClimax,
    };

    // ── CHECK 6: Momentum Deceleration ──────────────────────────
    // If delta magnitude is decreasing while price still moves → exhaustion
    // The fuel is running out
    const momentumDecay = this._momentumDeceleration(ctx, thresholds.momentumDecayWindow);
    checks.momentumDecay = {
      value: momentumDecay.ratio,
      threshold: 0.5,
      direction: momentumDecay.direction,
      triggered: momentumDecay.isDecelerating,
    };

    // ═══════════════════════════════════════════════════════════════
    // VERDICT: Block if ANY critical check fires
    // Conservative by design — false negatives are worse than false positives
    // ═══════════════════════════════════════════════════════════════

    const criticalTriggers = [
      checks.volatilitySpike.triggered,
      checks.priceExtension.triggered,
      checks.recentMove.triggered,
    ];

    const secondaryTriggers = [
      checks.stackedExhaustion.triggered,
      checks.volumeClimax.triggered,
      checks.momentumDecay.triggered,
    ];

    // Block on any critical trigger
    const criticalBlocked = criticalTriggers.some(Boolean);

    // Block on 2+ secondary triggers
    const secondaryCount = secondaryTriggers.filter(Boolean).length;
    const secondaryBlocked = secondaryCount >= 2;

    const blocked = criticalBlocked || secondaryBlocked;

    let reason = '';
    if (blocked) {
      const triggers = [];
      if (checks.volatilitySpike.triggered) triggers.push(`ATR-z=${atrZ.toFixed(2)}`);
      if (checks.priceExtension.triggered) triggers.push(`extension=${distFromMean.toFixed(2)}ATR`);
      if (checks.recentMove.triggered) triggers.push(`recent-move=${recentMove.toFixed(2)}ATR`);
      if (checks.stackedExhaustion.triggered) triggers.push(`stacked=${stackedCount}`);
      if (checks.volumeClimax.triggered) triggers.push(`vol-climax=${volRatio.toFixed(1)}x`);
      if (checks.momentumDecay.triggered) triggers.push('momentum-decay');
      reason = `EXHAUSTION: ${triggers.join(', ')}`;
    }

    return { blocked, reason, checks, coin };
  }

  /**
   * Quick check — just returns boolean, no diagnostics.
   * Use in hot paths where performance matters.
   */
  isExhausted(ctx) {
    return this.check(ctx).blocked;
  }

  // ── Internal: Exhaustion Detection Methods ───────────────────────

  _computeATRz(ctx) {
    const { candles1h, index1h } = ctx;
    if (!candles1h || index1h == null || index1h < 50) return 0;

    const atr = ctx.atr;
    if (!atr || atr === 0) return 0;

    // Compute ATR for last 50 candles, get z-score of current
    const atrValues = [];
    for (let i = Math.max(1, index1h - 50); i <= index1h; i++) {
      const c = candles1h[i];
      const prev = candles1h[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );
      atrValues.push(tr);
    }

    const mean = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;
    const variance = atrValues.reduce((s, v) => s + (v - mean) ** 2, 0) / atrValues.length;
    const std = Math.sqrt(variance);

    return std > 0 ? (atr - mean) / std : 0;
  }

  _priceDistanceFromMean(ctx) {
    const { candles1h, index1h, atr } = ctx;
    if (!candles1h || index1h == null || index1h < 20 || !atr) return 0;

    // 20-period SMA
    let sum = 0;
    for (let i = index1h - 19; i <= index1h; i++) sum += candles1h[i].close;
    const sma = sum / 20;

    return Math.abs(candles1h[index1h].close - sma) / atr;
  }

  _countStacked(ctx) {
    // Use delta array if available, otherwise estimate from candles
    const { candles15m, index15m, deltaArr } = ctx;

    if (deltaArr && index15m != null) {
      let maxStack = 1, currentStack = 1;
      let lastSign = 0;

      for (let j = Math.max(0, index15m - 9); j <= index15m; j++) {
        const sign = Math.sign(deltaArr[j]);
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

    // Fallback: estimate from candle direction
    if (!candles15m || index15m == null) return 0;

    let maxStack = 1, currentStack = 1;
    let lastDir = 0;

    for (let j = Math.max(0, index15m - 9); j <= index15m; j++) {
      const dir = Math.sign(candles15m[j].close - candles15m[j].open);
      if (dir === lastDir && dir !== 0) {
        currentStack++;
        maxStack = Math.max(maxStack, currentStack);
      } else {
        currentStack = 1;
        lastDir = dir;
      }
    }
    return maxStack;
  }

  _recentMoveATR(ctx, window = 5) {
    const { candles1h, index1h, atr } = ctx;
    if (!candles1h || index1h == null || index1h < window || !atr) return 0;

    const startPrice = candles1h[index1h - window].close;
    const endPrice = candles1h[index1h].close;

    return Math.abs(endPrice - startPrice) / atr;
  }

  _momentumDeceleration(ctx, window = 5) {
    const { candles15m, index15m, deltaArr } = ctx;

    if (!candles15m || index15m == null || index15m < window * 2) {
      return { isDecelerating: false, ratio: 1.0, direction: 'neutral' };
    }

    // Compare magnitude of recent vs older moves
    const halfWindow = Math.floor(window / 2);

    // Recent half
    let recentMove = 0;
    let recentDelta = 0;
    for (let j = index15m - halfWindow + 1; j <= index15m; j++) {
      recentMove += Math.abs(candles15m[j].close - candles15m[j].open);
      recentDelta += deltaArr ? Math.abs(deltaArr[j]) : 0;
    }

    // Older half
    let olderMove = 0;
    let olderDelta = 0;
    for (let j = index15m - window; j <= index15m - halfWindow; j++) {
      olderMove += Math.abs(candles15m[j].close - candles15m[j].open);
      olderDelta += deltaArr ? Math.abs(deltaArr[j]) : 0;
    }

    // Ratio: recent / older. < 1.0 = decelerating
    const moveRatio = olderMove > 0 ? recentMove / olderMove : 1.0;
    const deltaRatio = olderDelta > 0 ? recentDelta / olderDelta : 1.0;
    const avgRatio = (moveRatio + deltaRatio) / 2;

    // Direction of the move
    const priceDir = candles15m[index15m].close > candles15m[index15m - window].close ? 'up' : 'down';

    return {
      isDecelerating: avgRatio < 0.5,
      ratio: avgRatio,
      direction: priceDir,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────

  _extractCoin(symbol) {
    if (!symbol) return 'UNKNOWN';
    return symbol.split('/')[0].split(':')[0].toUpperCase();
  }

  /**
   * Get exhaustion diagnostics for logging/display
   */
  getDiagnostics(ctx) {
    const result = this.check(ctx);
    return {
      blocked: result.blocked,
      reason: result.reason,
      coin: result.coin,
      checks: Object.entries(result.checks).map(([name, check]) => ({
        name,
        value: typeof check.value === 'number' ? check.value.toFixed(3) : check.value,
        threshold: check.threshold,
        triggered: check.triggered,
      })),
    };
  }
}
