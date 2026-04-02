// ═══════════════════════════════════════════════════════════════════
// ClusterAnalyzer.js — Institutional-Grade Order Flow Cluster Engine
// ═══════════════════════════════════════════════════════════════════
//
// Classifies order flow into 4 cluster types:
//   A) ABSORPTION      — High volume + strong delta + price doesn't move → REVERSAL
//   B) CONTINUATION    — Strong imbalances + price moves fast + delta confirms → CONTINUATION
//   C) EXHAUSTION      — Declining volume + price still moving → POTENTIAL REVERSAL
//   D) TRAPPED_TRADERS — Breakout with volume + immediate reversal → OPPOSITE DIRECTION
//
// Each cluster produces a typed signal with confidence, direction, and edge reasoning.

import config from '../config.js';

export const ClusterType = {
  ABSORPTION: 'ABSORPTION',
  CONTINUATION: 'CONTINUATION',
  EXHAUSTION: 'EXHAUSTION',
  TRAPPED_TRADERS: 'TRAPPED_TRADERS',
};

export default class ClusterAnalyzer {
  constructor() {
    this._precomputedDelta = null;
    this._precomputedDeltaPercent = null;
  }

  /**
   * Set precomputed delta arrays (from Precompute.computeDelta).
   */
  setPrecomputedDelta(deltaArr, deltaPercentArr) {
    this._precomputedDelta = deltaArr;
    this._precomputedDeltaPercent = deltaPercentArr;
  }

  /**
   * Full cluster analysis at candle index i.
   * Returns the strongest cluster signal (or null).
   *
   * Pipeline:
   *   1. Compute volume context (avg, recent, ratio)
   *   2. Compute delta context (current, trend, strength)
   *   3. Compute price context (body ratio, wick ratio, range)
   *   4. Classify into one of 4 cluster types
   *   5. Score and return
   */
  analyzeCluster(candles, index, deltaData = null) {
    if (index < 20) return null;

    const candle = candles[index];
    const range = candle.high - candle.low;
    if (range === 0) return null;

    // ── Volume Context ───────────────────────────────────────────
    const volumeCtx = this._volumeContext(candles, index);

    // ── Delta Context ────────────────────────────────────────────
    const deltaCtx = this._deltaContext(candles, index, deltaData);

    // ── Price Context ────────────────────────────────────────────
    const priceCtx = this._priceContext(candle, range);

    // ── Classify ─────────────────────────────────────────────────
    const signals = [];

    // A) ABSORPTION — The reversal engine
    const absorption = this._detectAbsorption(candle, range, volumeCtx, deltaCtx, priceCtx);
    if (absorption) signals.push(absorption);

    // B) CONTINUATION — Momentum confirmation
    const continuation = this._detectContinuation(candles, index, volumeCtx, deltaCtx, priceCtx);
    if (continuation) signals.push(continuation);

    // C) EXHAUSTION — Weakening move
    const exhaustion = this._detectExhaustion(candles, index, volumeCtx, deltaCtx, priceCtx);
    if (exhaustion) signals.push(exhaustion);

    // D) TRAPPED TRADERS — Failed breakout
    const trapped = this._detectTrappedTraders(candles, index, volumeCtx, deltaCtx, priceCtx);
    if (trapped) signals.push(trapped);

    if (signals.length === 0) return null;

    // Return strongest cluster signal
    signals.sort((a, b) => b.confidence - a.confidence);
    return signals[0];
  }

  /**
   * Precompute-mode: analyze cluster at backtest candle index.
   * Uses precomputed delta arrays for O(1) lookup.
   */
  analyzeClusterPrecomputed(candles15m, index) {
    if (!this._precomputedDelta) return null;
    return this.analyzeCluster(candles15m, index, {
      delta: this._precomputedDelta[index] ?? 0,
      deltaPercent: this._precomputedDeltaPercent[index] ?? 0,
      deltaHistory: this._precomputedDelta.slice(Math.max(0, index - 9), index + 1),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // CLUSTER DETECTORS
  // ═══════════════════════════════════════════════════════════════

  /**
   * A) ABSORPTION — Institutional reversal signal
   *
   * Conditions:
   *   - High volume (>1.5x average)
   *   - Strong delta (buying or selling pressure)
   *   - Price does NOT move accordingly (small body relative to volume)
   *   - Long wick on the side of the delta
   *
   * Interpretation: Large player absorbing the move
   * Signal: REVERSAL in opposite direction of absorbed pressure
   */
  _detectAbsorption(candle, range, volCtx, deltaCtx, priceCtx) {
    // Need high volume
    if (volCtx.ratio < 1.5) return null;

    // Need strong delta
    if (Math.abs(deltaCtx.current) < volCtx.avgVolume * 0.3) return null;

    // Price NOT moving despite volume → the contradiction
    // Body should be small relative to range AND volume
    if (priceCtx.bodyRatio > 0.4) return null; // Too much body = price DID move

    // Wick should dominate — absorption creates long wicks
    if (priceCtx.maxWickRatio < 0.3) return null;

    // Determine direction: absorption reverses the absorbed pressure
    // If heavy buying (positive delta) but price didn't go up → sellers absorbing → bearish
    // If heavy selling (negative delta) but price didn't go down → buyers absorbing → bullish
    const isBuyAbsorption = deltaCtx.current > 0 && candle.close <= candle.open;
    const isSellAbsorption = deltaCtx.current < 0 && candle.close >= candle.open;

    if (!isBuyAbsorption && !isSellAbsorption) {
      // Alternative: high volume + tiny body + long wick
      if (priceCtx.bodyRatio > 0.25) return null;
    }

    const direction = deltaCtx.current > 0 ? 'bearish' : 'bullish'; // reverse of delta
    const action = direction === 'bullish' ? 'buy' : 'sell';

    // Confidence scales with: volume ratio, delta strength, body smallness
    let confidence = 0.5;
    confidence += Math.min((volCtx.ratio - 1.5) * 0.15, 0.2);      // volume bonus
    confidence += Math.min((1 - priceCtx.bodyRatio) * 0.2, 0.15);   // body smallness
    confidence += Math.min(priceCtx.maxWickRatio * 0.15, 0.15);      // wick presence

    return {
      type: ClusterType.ABSORPTION,
      direction,
      action,
      confidence: Math.min(confidence, 0.95),
      clusterData: {
        volumeRatio: volCtx.ratio,
        deltaStrength: Math.abs(deltaCtx.current),
        bodyRatio: priceCtx.bodyRatio,
        wickRatio: priceCtx.maxWickRatio,
      },
      reason: `${deltaCtx.current > 0 ? 'Buy' : 'Sell'} absorption — volume ${volCtx.ratio.toFixed(1)}x but price held`,
    };
  }

  /**
   * B) CONTINUATION — Momentum confirmation signal
   *
   * Conditions:
   *   - Strong imbalances (delta consistently one-sided for 3+ candles)
   *   - Price moves fast in delta direction
   *   - Volume sustaining or increasing
   *
   * Interpretation: No resistance, move has room to run
   * Signal: CONTINUATION in current direction
   */
  _detectContinuation(candles, index, volCtx, deltaCtx, priceCtx) {
    if (index < 5) return null;

    // Need consecutive delta in same direction
    const recentDeltas = deltaCtx.history.slice(-5);
    if (recentDeltas.length < 3) return null;

    const positiveCount = recentDeltas.filter(d => d > 0).length;
    const negativeCount = recentDeltas.filter(d => d < 0).length;

    // Need 4+ of 5 in same direction for strong continuation
    const isStacked = positiveCount >= 4 || negativeCount >= 4;
    if (!isStacked) return null;

    const direction = positiveCount > negativeCount ? 'bullish' : 'bearish';
    const action = direction === 'bullish' ? 'buy' : 'sell';

    // Price should be moving in the direction of the delta
    const candle = candles[index];
    const prevCandle = candles[index - 1];
    const priceMovingUp = candle.close > prevCandle.close;
    const priceMovingDown = candle.close < prevCandle.close;

    if (direction === 'bullish' && !priceMovingUp) return null;
    if (direction === 'bearish' && !priceMovingDown) return null;

    // Body should be decent — continuation candles have momentum
    if (priceCtx.bodyRatio < 0.4) return null;

    // Volume should be sustaining (not declining)
    if (volCtx.ratio < 0.8) return null;

    // Confidence: scales with stacking consistency, body ratio, volume
    let confidence = 0.5;
    const maxCount = Math.max(positiveCount, negativeCount);
    confidence += (maxCount - 3) * 0.1;                         // stacking bonus
    confidence += Math.min(priceCtx.bodyRatio * 0.2, 0.15);     // body strength
    confidence += Math.min(volCtx.ratio * 0.05, 0.1);           // volume support

    // Delta magnitude bonus
    const avgDelta = recentDeltas.reduce((a, b) => a + Math.abs(b), 0) / recentDeltas.length;
    if (avgDelta > volCtx.avgVolume * 0.4) confidence += 0.1;

    return {
      type: ClusterType.CONTINUATION,
      direction,
      action,
      confidence: Math.min(confidence, 0.90),
      clusterData: {
        stackingCount: maxCount,
        bodyRatio: priceCtx.bodyRatio,
        volumeRatio: volCtx.ratio,
        avgDeltaMagnitude: avgDelta,
      },
      reason: `${maxCount}-candle ${direction} continuation — stacked delta with momentum`,
    };
  }

  /**
   * C) EXHAUSTION — Weakening move signal
   *
   * Conditions:
   *   - Declining volume over 3+ candles
   *   - Price still moving in same direction
   *   - Delta magnitude shrinking
   *
   * Interpretation: Move is running out of fuel
   * Signal: Potential REVERSAL
   */
  _detectExhaustion(candles, index, volCtx, deltaCtx, priceCtx) {
    if (index < 6) return null;

    // Check volume decline over last 3 candles
    const vols = [];
    for (let j = Math.max(0, index - 2); j <= index; j++) {
      vols.push(candles[j].volume);
    }
    if (vols.length < 3) return null;

    // Volume should be declining: each candle less volume than previous
    const volDeclining = vols[2] < vols[1] && vols[1] < vols[0];
    if (!volDeclining) return null;

    // Price still moving (body > 0.3 of range)
    if (priceCtx.bodyRatio < 0.3) return null;

    // Delta magnitude should be shrinking
    const recentDeltas = deltaCtx.history.slice(-3);
    if (recentDeltas.length < 3) return null;
    const deltaShrinking = Math.abs(recentDeltas[2]) < Math.abs(recentDeltas[1]) &&
                           Math.abs(recentDeltas[1]) < Math.abs(recentDeltas[0]);
    if (!deltaShrinking) return null;

    // Direction: reverse of current move (exhaustion = impending reversal)
    const candle = candles[index];
    const direction = candle.close > candle.open ? 'bearish' : 'bullish';
    const action = direction === 'bullish' ? 'buy' : 'sell';

    // Confidence: scales with volume decline rate and delta shrinkage
    const volDeclineRate = 1 - (vols[2] / vols[0]);
    const deltaShrinkRate = 1 - (Math.abs(recentDeltas[2]) / (Math.abs(recentDeltas[0]) || 1));

    let confidence = 0.45;
    confidence += Math.min(volDeclineRate * 0.3, 0.2);
    confidence += Math.min(deltaShrinkRate * 0.2, 0.15);

    return {
      type: ClusterType.EXHAUSTION,
      direction,
      action,
      confidence: Math.min(confidence, 0.80),
      clusterData: {
        volumeDecline: volDeclineRate.toFixed(3),
        deltaShrink: deltaShrinkRate.toFixed(3),
        volumeSequence: vols.map(v => v.toFixed(0)),
      },
      reason: `Exhaustion — volume declining ${(volDeclineRate * 100).toFixed(0)}% with shrinking delta`,
    };
  }

  /**
   * D) TRAPPED TRADERS — Failed breakout signal
   *
   * Conditions:
   *   - Breakout candle with above-average volume
   *   - Immediate reversal in next 1-2 candles
   *   - Reversal candle has opposing delta
   *
   * Interpretation: Breakout participants trapped on wrong side
   * Signal: Move in OPPOSITE direction of failed breakout
   */
  _detectTrappedTraders(candles, index, volCtx, deltaCtx, priceCtx) {
    if (index < 4) return null;

    const current = candles[index];
    const prev = candles[index - 1];
    const prev2 = candles[index - 2];

    // Check if prev candle was a breakout attempt
    const prevRange = prev.high - prev.low;
    const prevBody = Math.abs(prev.close - prev.open);
    if (prevRange === 0) return null;

    const prevBodyRatio = prevBody / prevRange;
    const prevWasBreakout = prevBodyRatio > 0.5 && prev.volume > volCtx.avgVolume * 1.2;

    if (!prevWasBreakout) return null;

    // Current candle reverses the breakout
    const breakoutWasUp = prev.close > prev.open;
    const reversalDown = breakoutWasUp && current.close < current.open && current.close < prev.close;
    const reversalUp = !breakoutWasUp && current.close > current.open && current.close > prev.close;

    if (!reversalDown && !reversalUp) return null;

    // Reversal should have decent body
    if (priceCtx.bodyRatio < 0.35) return null;

    const direction = reversalDown ? 'bearish' : 'bullish';
    const action = direction === 'bullish' ? 'buy' : 'sell';

    // Confidence: scales with breakout volume, reversal strength
    let confidence = 0.5;
    const breakoutVolRatio = prev.volume / volCtx.avgVolume;
    confidence += Math.min((breakoutVolRatio - 1.2) * 0.1, 0.15);
    confidence += Math.min(priceCtx.bodyRatio * 0.2, 0.15);

    // Stronger if reversal candle also has volume
    if (volCtx.ratio > 1.0) confidence += 0.1;

    return {
      type: ClusterType.TRAPPED_TRADERS,
      direction,
      action,
      confidence: Math.min(confidence, 0.85),
      clusterData: {
        breakoutVolume: breakoutVolRatio.toFixed(2),
        reversalBody: priceCtx.bodyRatio.toFixed(3),
        breakoutDirection: breakoutWasUp ? 'up' : 'down',
      },
      reason: `Trapped traders — ${breakoutWasUp ? 'bullish' : 'bearish'} breakout failed, reversal confirmed`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CONTEXT BUILDERS
  // ═══════════════════════════════════════════════════════════════

  _volumeContext(candles, index) {
    const lookback = 20;
    const start = Math.max(0, index - lookback + 1);
    let sum = 0;
    for (let i = start; i <= index; i++) sum += candles[i].volume;
    const avgVolume = sum / (index - start + 1);

    const recentVol = candles[index].volume;
    const ratio = avgVolume > 0 ? recentVol / avgVolume : 1;

    // Volume trend: is recent volume increasing or decreasing?
    const recent3Start = Math.max(0, index - 2);
    let recent3Avg = 0;
    for (let i = recent3Start; i <= index; i++) recent3Avg += candles[i].volume;
    recent3Avg /= (index - recent3Start + 1);

    const older3Start = Math.max(0, index - 5);
    let older3Avg = 0;
    const older3End = Math.max(0, index - 3);
    for (let i = older3Start; i <= older3End; i++) older3Avg += candles[i].volume;
    const older3Count = older3End - older3Start + 1;
    older3Avg /= Math.max(older3Count, 1);

    const trend = recent3Avg > older3Avg * 1.1 ? 'increasing' :
                  recent3Avg < older3Avg * 0.9 ? 'decreasing' : 'stable';

    return { avgVolume, recentVolume: recentVol, ratio, trend };
  }

  _deltaContext(candles, index, deltaData) {
    let currentDelta, deltaHistory;

    if (deltaData) {
      currentDelta = deltaData.delta;
      deltaHistory = deltaData.deltaHistory || [deltaData.delta];
    } else {
      // Estimate delta from OHLCV
      const c = candles[index];
      const range = c.high - c.low;
      if (range === 0) {
        currentDelta = 0;
      } else {
        const closePos = (c.close - c.low) / range;
        currentDelta = (closePos - 0.5) * 2 * c.volume;
      }

      deltaHistory = [];
      for (let j = Math.max(0, index - 9); j <= index; j++) {
        const cc = candles[j];
        const r = cc.high - cc.low;
        if (r === 0) {
          deltaHistory.push(0);
        } else {
          const cp = (cc.close - cc.low) / r;
          deltaHistory.push((cp - 0.5) * 2 * cc.volume);
        }
      }
    }

    // Delta trend over recent candles
    const recent10 = deltaHistory.slice(-10);
    const deltaSum = recent10.reduce((a, b) => a + b, 0);
    const deltaTrend = deltaSum > 0 ? 'bullish' : deltaSum < 0 ? 'bearish' : 'neutral';

    // Delta momentum: is it accelerating or decelerating?
    const half = Math.floor(recent10.length / 2);
    const firstHalf = recent10.slice(0, half).reduce((a, b) => a + b, 0);
    const secondHalf = recent10.slice(half).reduce((a, b) => a + b, 0);
    const momentum = Math.abs(secondHalf) > Math.abs(firstHalf) * 1.2 ? 'accelerating' :
                     Math.abs(secondHalf) < Math.abs(firstHalf) * 0.8 ? 'decelerating' : 'stable';

    return {
      current: currentDelta,
      history: deltaHistory,
      trend: deltaTrend,
      momentum,
      sum: deltaSum,
    };
  }

  _priceContext(candle, range) {
    const body = Math.abs(candle.close - candle.open);
    const bodyRatio = body / range;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWickRatio = upperWick / range;
    const lowerWickRatio = lowerWick / range;
    const maxWickRatio = Math.max(upperWickRatio, lowerWickRatio);

    return {
      bodyRatio,
      upperWickRatio,
      lowerWickRatio,
      maxWickRatio,
      direction: candle.close >= candle.open ? 'bullish' : 'bearish',
    };
  }
}
