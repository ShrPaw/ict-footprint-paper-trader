// ═══════════════════════════════════════════════════════════════════
// OrderFlowEngine.js — 6-Step Institutional Decision Pipeline
// ═══════════════════════════════════════════════════════════════════
//
// THE EDGE: Market intention ≠ Price result
// Example: Strong buying (positive delta, high ask volume) but price does NOT move up
// → ABSORPTION (institutional selling) → HIGH-PROBABILITY REVERSAL
//
// Pipeline (mandatory sequence — ANY step fails → NO TRADE):
//   Step 1: CONTEXT          — Market structure, price location, key zones
//   Step 2: MARKET INTENT    — What is the market TRYING to do?
//   Step 3: EVENT TRIGGER    — Valid event must have occurred
//   Step 4: CLUSTER CONFIRM  — Order flow cluster must match intent
//   Step 5: EDGE VALIDATION  — All conditions must align
//   Step 6: EXECUTION        — Entry, stop, target
//
// GOLDEN RULES:
//   1. Price is truth. Volume is explanation.
//   2. No reaction = no trade
//   3. Contradiction = opportunity
//   4. Less trades = higher quality

import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';
import ClusterAnalyzer, { ClusterType } from '../analysis/ClusterAnalyzer.js';

// ── Market Structure Types ───────────────────────────────────────
const Structure = {
  TRENDING_UP: 'TRENDING_UP',
  TRENDING_DOWN: 'TRENDING_DOWN',
  RANGING: 'RANGING',
  EXPANDING: 'EXPANDING',
};

// ── Price Location ───────────────────────────────────────────────
const PriceLocation = {
  HIGH_OF_RANGE: 'HIGH_OF_RANGE',
  LOW_OF_RANGE: 'LOW_OF_RANGE',
  MID_RANGE: 'MID_RANGE',
  KEY_LEVEL: 'KEY_LEVEL',
};

// ── Event Types ──────────────────────────────────────────────────
const EventType = {
  LIQUIDITY_SWEEP: 'LIQUIDITY_SWEEP',
  BREAKOUT: 'BREAKOUT',
  AGGRESSIVE_REJECTION: 'AGGRESSIVE_REJECTION',
  NONE: 'NONE',
};

export default class OrderFlowEngine {
  constructor() {
    this.clusterAnalyzer = new ClusterAnalyzer();
    this._precomputedDelta = null;
  }

  /**
   * Set precomputed data for backtest mode.
   */
  setPrecomputed(deltaArr, deltaPercentArr) {
    this._precomputedDelta = deltaArr;
    this.clusterAnalyzer.setPrecomputedDelta(deltaArr, deltaPercentArr);
  }

  /**
   * Run the full 6-step decision pipeline.
   * Returns { signal, pipeline } where signal is trade-ready or null.
   * Pipeline object contains full diagnostic trace.
   *
   * @param {object} ctx — Pre-built context with all data
   *   ctx = { candles15m, candles1h, index15m, index1h, indicators1h, profile, regime, ... }
   */
  evaluate(ctx) {
    const pipeline = {
      step1_context: null,
      step2_intent: null,
      step3_event: null,
      step4_cluster: null,
      step5_validation: null,
      passed: false,
      rejectionReason: null,
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: CONTEXT (PRIMARY FILTER — rejects ~80% of setups)
    // ═══════════════════════════════════════════════════════════════
    const context = this._analyzeContext(ctx);
    pipeline.step1_context = context;

    if (!context.valid) {
      pipeline.rejectionReason = context.reason;
      return { signal: null, pipeline };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: MARKET INTENT
    // ═══════════════════════════════════════════════════════════════
    const intent = this._analyzeIntent(ctx, context);
    pipeline.step2_intent = intent;

    if (!intent.valid) {
      pipeline.rejectionReason = intent.reason;
      return { signal: null, pipeline };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: EVENT TRIGGER (NON-NEGOTIABLE)
    // ═══════════════════════════════════════════════════════════════
    const event = this._detectEvent(ctx, context);
    pipeline.step3_event = event;

    if (event.type === EventType.NONE) {
      pipeline.rejectionReason = 'No valid event trigger';
      return { signal: null, pipeline };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: CLUSTER CONFIRMATION
    // ═══════════════════════════════════════════════════════════════
    const cluster = this._analyzeCluster(ctx);
    pipeline.step4_cluster = cluster;

    if (!cluster) {
      pipeline.rejectionReason = 'No cluster confirmation';
      return { signal: null, pipeline };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: EDGE VALIDATION (CRITICAL — all must align)
    // ═══════════════════════════════════════════════════════════════
    const validation = this._validateEdge(context, intent, event, cluster, ctx);
    pipeline.step5_validation = validation;

    if (!validation.valid) {
      pipeline.rejectionReason = validation.reason;
      return { signal: null, pipeline };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: EXECUTION DECISION
    // ═══════════════════════════════════════════════════════════════
    const signal = this._buildExecutionSignal(ctx, context, intent, event, cluster, validation);
    pipeline.passed = true;

    return { signal, pipeline };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: CONTEXT — Market structure, price location, key zones
  // ═══════════════════════════════════════════════════════════════

  _analyzeContext(ctx) {
    const { candles1h, index1h, indicators1h, profile, regime } = ctx;
    const price = candles1h[index1h].close;

    // Market structure from regime
    let structure;
    if (regime === 'TRENDING_UP') structure = Structure.TRENDING_UP;
    else if (regime === 'TRENDING_DOWN') structure = Structure.TRENDING_DOWN;
    else if (regime === 'VOL_EXPANSION') structure = Structure.EXPANDING;
    else structure = Structure.RANGING;

    // Price location within range
    const rangeLookback = Math.min(config.regime.rangeLookback, index1h);
    const rangeStart = index1h - rangeLookback;
    let rangeHigh = -Infinity, rangeLow = Infinity;
    for (let j = rangeStart; j <= index1h; j++) {
      if (candles1h[j].high > rangeHigh) rangeHigh = candles1h[j].high;
      if (candles1h[j].low < rangeLow) rangeLow = candles1h[j].low;
    }
    const rangeSize = rangeHigh - rangeLow;
    const pricePosition = rangeSize > 0 ? (price - rangeLow) / rangeSize : 0.5;

    let priceLocation;
    if (pricePosition > 0.75) priceLocation = PriceLocation.HIGH_OF_RANGE;
    else if (pricePosition < 0.25) priceLocation = PriceLocation.LOW_OF_RANGE;
    else priceLocation = PriceLocation.MID_RANGE;

    // Check for key levels: ICT signals (OBs, sweeps, OTEs) near current price
    const hasKeyLevel = this._hasNearbyKeyLevel(ctx, price);

    // RULE: If price is in the middle of a range with no key level → IGNORE
    if (priceLocation === PriceLocation.MID_RANGE && !hasKeyLevel) {
      return {
        valid: false,
        reason: `Mid-range (${(pricePosition * 100).toFixed(0)}%) with no key level`,
        structure, priceLocation, pricePosition, hasKeyLevel,
        rangeHigh, rangeLow,
      };
    }

    // EMA alignment (directional filter)
    const ema21 = indicators1h.ema21[index1h];
    const ema50 = indicators1h.ema50[index1h];
    const bullish = price > ema21 && price > ema50;
    const bearish = price < ema21 && price < ema50;

    if (!bullish && !bearish) {
      return {
        valid: false,
        reason: 'Price between EMAs — no directional bias',
        structure, priceLocation, pricePosition, hasKeyLevel,
        rangeHigh, rangeLow,
      };
    }

    return {
      valid: true,
      structure, priceLocation, pricePosition, hasKeyLevel,
      rangeHigh, rangeLow,
      bullish, bearish,
      direction: bullish ? 'bullish' : 'bearish',
    };
  }

  _hasNearbyKeyLevel(ctx, price) {
    const { candles1h, index1h } = ctx;
    const atr = ctx.indicators1h.atr[index1h] || price * 0.02;
    const tolerance = atr * 2; // Key level is "nearby" if within 2 ATR

    // Check ICT signals from precomputed arrays
    const checkSignals = (signals) => {
      if (!signals) return false;
      for (const sig of signals) {
        if (sig.type === 'ORDER_BLOCK') {
          const obMid = (sig.top + sig.bottom) / 2;
          if (Math.abs(price - obMid) < tolerance) return true;
        }
        if (sig.type === 'LIQUIDITY_SWEEP' && Math.abs(price - sig.price) < tolerance) return true;
        if (sig.type === 'OTE') return true; // OTE signal implies price is at a key level
      }
      return false;
    };

    // Check from context (precomputed or live)
    if (checkSignals(ctx.ictSignals)) return true;

    // Check OTE zones
    if (ctx.oteSignals && checkSignals(ctx.oteSignals)) return true;

    // Check sweep signals
    if (ctx.sweepSignals && checkSignals(ctx.sweepSignals)) return true;

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: MARKET INTENT — What is the market TRYING to do?
  // ═══════════════════════════════════════════════════════════════

  _analyzeIntent(ctx, context) {
    const { candles1h, index1h, indicators1h, regime } = ctx;

    // Intent is derived from:
    // 1. Trend direction (EMA stack)
    // 2. Recent price action (higher highs / lower lows)
    // 3. Volume/delta trend
    // 4. Current regime

    const price = candles1h[index1h].close;
    const ema9 = indicators1h.ema9[index1h];
    const ema21 = indicators1h.ema21[index1h];

    // Recent structure: higher highs / lower lows?
    const lookback = Math.min(10, index1h);
    let higherHighs = 0, lowerLows = 0;
    for (let j = index1h - lookback + 1; j <= index1h; j++) {
      if (j > 0) {
        if (candles1h[j].high > candles1h[j - 1].high) higherHighs++;
        if (candles1h[j].low < candles1h[j - 1].low) lowerLows++;
      }
    }

    // Delta trend from precomputed or live
    let deltaTrend = 'neutral';
    if (this._precomputedDelta) {
      const start = Math.max(0, ctx.index15m - 9);
      let sum = 0;
      for (let j = start; j <= ctx.index15m; j++) sum += this._precomputedDelta[j] ?? 0;
      deltaTrend = sum > 0 ? 'bullish' : sum < 0 ? 'bearish' : 'neutral';
    }

    // Intent classification
    let intent, direction, strength;

    if (regime === 'TRENDING_UP' || (context.bullish && higherHighs > lowerLows)) {
      intent = 'MOVE_TO_HIGHS';
      direction = 'bullish';
      strength = regime === 'TRENDING_UP' ? 'strong' : 'moderate';
    } else if (regime === 'TRENDING_DOWN' || (context.bearish && lowerLows > higherHighs)) {
      intent = 'MOVE_TO_LOWS';
      direction = 'bearish';
      strength = regime === 'TRENDING_DOWN' ? 'strong' : 'moderate';
    } else if (regime === 'VOL_EXPANSION') {
      // In vol expansion, intent depends on EMA + delta
      if (context.bullish && deltaTrend === 'bullish') {
        intent = 'BREAKOUT_UP';
        direction = 'bullish';
        strength = 'moderate';
      } else if (context.bearish && deltaTrend === 'bearish') {
        intent = 'BREAKOUT_DOWN';
        direction = 'bearish';
        strength = 'moderate';
      } else {
        intent = 'EXPANSION_UNCERTAIN';
        direction = deltaTrend !== 'neutral' ? deltaTrend : context.direction;
        strength = 'weak';
      }
    } else {
      // RANGING
      if (context.priceLocation === PriceLocation.HIGH_OF_RANGE) {
        intent = 'DISTRIBUTION'; // likely selling at highs
        direction = 'bearish';
        strength = 'moderate';
      } else if (context.priceLocation === PriceLocation.LOW_OF_RANGE) {
        intent = 'ACCUMULATION'; // likely buying at lows
        direction = 'bullish';
        strength = 'moderate';
      } else {
        intent = 'CHOP';
        direction = 'neutral';
        strength = 'none';
        return {
          valid: false,
          reason: 'Choppy mid-range — no clear intent',
          intent, direction, strength, deltaTrend,
          higherHighs, lowerLows,
        };
      }
    }

    return {
      valid: true,
      intent, direction, strength, deltaTrend,
      higherHighs, lowerLows,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: EVENT TRIGGER — Valid event must have occurred
  // ═══════════════════════════════════════════════════════════════

  _detectEvent(ctx, context) {
    const { candles1h, index1h, sweepSignals } = ctx;

    // Valid events:
    //   1. Liquidity sweep (stop hunt) — from ICT analyzer
    //   2. Breakout from range — price breaks range high/low
    //   3. Aggressive rejection — long wick + reaction

    // Check for liquidity sweep (from precomputed ICT signals)
    if (sweepSignals) {
      for (const sig of sweepSignals) {
        if (sig.type === 'LIQUIDITY_SWEEP') {
          return {
            type: EventType.LIQUIDITY_SWEEP,
            direction: sig.direction,
            confidence: sig.confidence,
            data: sig,
            valid: true,
          };
        }
      }
    }

    // Check for aggressive rejection (wick > 60% of range)
    const candle = candles1h[index1h];
    const range = candle.high - candle.low;
    if (range > 0) {
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const upperWickRatio = upperWick / range;
      const lowerWickRatio = lowerWick / range;

      if (lowerWickRatio >= 0.6 && candle.close > candle.open) {
        return {
          type: EventType.AGGRESSIVE_REJECTION,
          direction: 'bullish',
          confidence: Math.min(0.65 + (lowerWickRatio - 0.6) * 0.5, 0.95),
          data: { wickRatio: lowerWickRatio, side: 'lower' },
          valid: true,
        };
      }
      if (upperWickRatio >= 0.6 && candle.close < candle.open) {
        return {
          type: EventType.AGGRESSIVE_REJECTION,
          direction: 'bearish',
          confidence: Math.min(0.65 + (upperWickRatio - 0.6) * 0.5, 0.95),
          data: { wickRatio: upperWickRatio, side: 'upper' },
          valid: true,
        };
      }
    }

    // Check for breakout from range
    if (context.priceLocation === PriceLocation.HIGH_OF_RANGE ||
        context.priceLocation === PriceLocation.LOW_OF_RANGE) {
      const price = candle.close;
      const body = Math.abs(candle.close - candle.open);
      const bodyRatio = range > 0 ? body / range : 0;

      if (bodyRatio > 0.5) { // Strong body = breakout candle
        if (context.priceLocation === PriceLocation.HIGH_OF_RANGE && candle.close > candle.open) {
          return {
            type: EventType.BREAKOUT,
            direction: 'bullish',
            confidence: 0.6,
            data: { level: context.rangeHigh, bodyRatio },
            valid: true,
          };
        }
        if (context.priceLocation === PriceLocation.LOW_OF_RANGE && candle.close < candle.open) {
          return {
            type: EventType.BREAKOUT,
            direction: 'bearish',
            confidence: 0.6,
            data: { level: context.rangeLow, bodyRatio },
            valid: true,
          };
        }
      }
    }

    return { type: EventType.NONE, valid: false };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: CLUSTER CONFIRMATION — Order flow analysis
  // ═══════════════════════════════════════════════════════════════

  _analyzeCluster(ctx) {
    const { candles15m, index15m } = ctx;

    if (this._precomputedDelta) {
      return this.clusterAnalyzer.analyzeClusterPrecomputed(candles15m, index15m);
    }

    // Live mode — estimate delta from OHLCV
    return this.clusterAnalyzer.analyzeCluster(candles15m, index15m);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: EDGE VALIDATION — All must align
  // ═══════════════════════════════════════════════════════════════

  _validateEdge(context, intent, event, cluster, ctx) {
    // Validations:
    // ✅ Correct context (key level present)
    // ✅ Clear event trigger
    // ✅ Logical cluster behavior (matches intent)
    // ✅ Cluster direction aligns with event or is a reversal signal
    // ✅ Price is at a meaningful level

    // 1. Context validation
    if (!context.valid) {
      return { valid: false, reason: 'Context invalid' };
    }

    // 2. Event validation
    if (!event.valid) {
      return { valid: false, reason: 'No event trigger' };
    }

    // 3. Cluster-intent alignment
    // The cluster should either CONFIRM the intent (continuation) or CONTRADICT it (reversal)
    const eventDir = event.direction;
    const clusterDir = cluster.direction;

    // For continuation clusters: must agree with event direction
    if (cluster.type === ClusterType.CONTINUATION && clusterDir !== eventDir) {
      return {
        valid: false,
        reason: `Continuation cluster (${clusterDir}) disagrees with event (${eventDir})`,
      };
    }

    // For absorption: must OPPOSE the event direction (reversal signal)
    if (cluster.type === ClusterType.ABSORPTION && clusterDir === eventDir) {
      return {
        valid: false,
        reason: `Absorption cluster (${clusterDir}) should oppose event (${eventDir})`,
      };
    }

    // For trapped traders: must oppose the breakout direction
    if (cluster.type === ClusterType.TRAPPED_TRADERS) {
      // Trapped traders always trade against the failed breakout
      // This is already handled by the cluster direction being the reversal
    }

    // 4. FALSE SIGNAL FILTER — mandatory rejections
    // Reject if: high volume in mid-range (no key level context)
    if (context.priceLocation === PriceLocation.MID_RANGE && !context.hasKeyLevel) {
      return { valid: false, reason: 'High volume in mid-range — no edge' };
    }

    // Reject if: cluster is weak (< 0.5 confidence)
    if (cluster.confidence < 0.5) {
      return { valid: false, reason: `Cluster too weak (${cluster.confidence.toFixed(2)})` };
    }

    // Reject if: event is weak AND cluster is weak
    if (event.confidence < 0.6 && cluster.confidence < 0.6) {
      return { valid: false, reason: 'Both event and cluster are weak — insufficient edge' };
    }

    // 5. CONFLUENCE SCORING — compute combined edge strength
    let edgeScore = 0;

    // Context quality
    if (context.hasKeyLevel) edgeScore += 0.2;
    if (context.priceLocation !== PriceLocation.MID_RANGE) edgeScore += 0.15;

    // Event quality
    edgeScore += event.confidence * 0.25;

    // Cluster quality
    edgeScore += cluster.confidence * 0.25;

    // Alignment bonus
    const aligned = cluster.type === ClusterType.CONTINUATION ? clusterDir === eventDir :
                    cluster.type === ClusterType.ABSORPTION ? clusterDir !== eventDir : true;
    if (aligned) edgeScore += 0.15;

    edgeScore = Math.min(edgeScore, 1.0);

    // Minimum edge score gate
    const minEdge = config.orderFlow?.minEdgeScore ?? 0.60;
    if (edgeScore < minEdge) {
      return { valid: false, reason: `Edge score ${edgeScore.toFixed(2)} below minimum ${minEdge}` };
    }

    return {
      valid: true,
      edgeScore,
      alignment: aligned ? 'aligned' : 'conflicting',
      clusterType: cluster.type,
      eventType: event.type,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 6: EXECUTION — Build the trade signal
  // ═══════════════════════════════════════════════════════════════

  _buildExecutionSignal(ctx, context, intent, event, cluster, validation) {
    const { candles1h, index1h, profile, regime } = ctx;
    const price = candles1h[index1h].close;
    const atr = ctx.indicators1h.atr[index1h];
    const direction = cluster.direction;
    const action = direction === 'bullish' ? 'buy' : 'sell';

    // SL/TP calculation (per-asset overrides)
    const slMult = (profile.riskOverrides?.slMultiplier ?? config.risk[regime]?.slMultiplier ?? 0.9) * profile.slTightness;
    const tpMult = config.risk[regime]?.tpMultiplier || 2.5;

    const stopLoss = action === 'buy'
      ? price - atr * slMult
      : price + atr * slMult;

    const takeProfit = action === 'buy'
      ? price + atr * tpMult
      : price - atr * tpMult;

    // Combined confidence
    const combinedConfidence = Math.min(
      (cluster.confidence * 0.4) + (event.confidence * 0.3) + (validation.edgeScore * 0.3),
      1.0
    );

    // Build the signal
    return {
      type: `OF_${cluster.type}`,
      action,
      direction,
      confidence: combinedConfidence,
      price,
      stopLoss,
      takeProfit,
      atr,
      regime,
      mode: 'ORDER_FLOW',

      // Pipeline metadata
      clusterType: cluster.type,
      eventType: event.type,
      marketIntent: intent.intent,
      priceLocation: context.priceLocation,
      structure: context.structure,
      edgeScore: validation.edgeScore,

      // Cluster details
      clusterData: cluster.clusterData,
      eventData: event.data,

      // For scoring integration
      source: 'order_flow',
      combinedScore: combinedConfidence,

      reason: this._formatReason(cluster, event, intent, context),

      // Asset metadata
      assetProfile: profile.name,
      profile,
      isWeekend: false,
    };
  }

  _formatReason(cluster, event, intent, context) {
    const parts = [];

    // Cluster type
    const clusterLabels = {
      [ClusterType.ABSORPTION]: '🔄 Absorption',
      [ClusterType.CONTINUATION]: '🚀 Continuation',
      [ClusterType.EXHAUSTION]: '⚡ Exhaustion',
      [ClusterType.TRAPPED_TRADERS]: '🪤 Trapped',
    };
    parts.push(clusterLabels[cluster.type] || cluster.type);

    // Event
    const eventLabels = {
      [EventType.LIQUIDITY_SWEEP]: 'Sweep',
      [EventType.BREAKOUT]: 'Breakout',
      [EventType.AGGRESSIVE_REJECTION]: 'Rejection',
    };
    parts.push(`on ${eventLabels[event.type] || event.type}`);

    // Location
    const locLabels = {
      [PriceLocation.HIGH_OF_RANGE]: '@ range high',
      [PriceLocation.LOW_OF_RANGE]: '@ range low',
      [PriceLocation.KEY_LEVEL]: '@ key level',
    };
    if (context.priceLocation !== PriceLocation.MID_RANGE) {
      parts.push(locLabels[context.priceLocation] || '');
    }

    // Intent
    parts.push(`(${intent.intent})`);

    return parts.filter(Boolean).join(' ');
  }
}
