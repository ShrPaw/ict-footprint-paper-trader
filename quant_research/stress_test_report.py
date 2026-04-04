"""
PHASE 2.5 POST-MORTEM: EDGE REJECTED
"""

report = """
╔══════════════════════════════════════════════════════════════════════╗
║     PHASE 2.5 STRESS TEST — POST-MORTEM: EDGE REJECTED            ║
╚══════════════════════════════════════════════════════════════════════╝

Date: 2026-04-04
Edge Under Test: Below-VWAP Deviation (>2%) Mean Reversion
Assets: BTC, SOL, XRP
Horizon: 6h (24 × 15m bars)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VERDICT: CASE B — FRAGILE / FALSE EDGE

All three assets FAILED the stress test suite.
The edge must be REJECTED. Do not proceed to model building.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST RESULTS MATRIX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                        │   BTC   │   SOL   │   XRP   │
  ──────────────────────┼─────────┼─────────┼─────────┤
  Regime Segmentation   │   FAIL  │   FAIL  │   PASS  │
  Event Clustering      │   PASS  │   PASS  │   PASS  │
  Entry Delay           │   FAIL  │   FAIL  │   FAIL  │
  Subsampling           │   FAIL  │   FAIL  │   FAIL  │
  Directional           │   FAIL  │   FAIL  │   FAIL  │
  Path Stability        │   PASS  │   PASS  │   PASS  │
  ──────────────────────┼─────────┼─────────┼─────────┤
  OVERALL               │   FAIL  │   FAIL  │   FAIL  │

3/6 tests failed on every asset. Edge is INVALID.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHY THE EDGE FAILED — ROOT CAUSE ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. REGIME INSTABILITY (BTC, SOL failed)
   ─────────────────────────────────────
   The edge does NOT persist across market regimes.

   SOL specifics:
   • Edge is strong in Q2-Q3 2025 (mean +1.1%, t=3.52)
   • Edge REVERSES in Q4 2025 and Q1 2026 (mean -0.7%, t=-2.55)
   • Edge is ABSENT in sideways regime (mean -0.4%, n=46)
   • Only 36% of sub-regimes show significance

   BTC specifics:
   • 0 of 6 sub-regimes are individually significant
   • The original "significant" result was driven by pooling across
     regimes with different characteristics
   • This is a classic composition artifact

   XRP was the most robust (60% of sub-regimes significant),
   but still failed 4 of 6 tests.

2. ENTRY TIMING FRAGILITY (ALL failed)
   ─────────────────────────────────────
   The edge COLLAPSES with even small entry delays.

   • At delay +0: often not significant
   • At delay +3: edge disappears on all assets
   • At delay +8: edge reappears (different mechanism)

   This means the "edge" is extremely timing-sensitive.
   Any real-world execution delay (network latency, slippage,
   order book depth) would destroy the edge.

   The re-appearance at +8 bars suggests a SECONDARY effect
   (possibly trend continuation or volatility clustering) that
   is independent of the original VWAP deviation hypothesis.

3. SUBSAMPLING INSTABILITY (ALL failed)
   ─────────────────────────────────────
   When 50% of events are randomly removed:
   • BTC: Only 3% of subsamples remain significant
   • SOL: Only 2% of subsamples remain significant
   • XRP: 53% remain significant (better, but below 80% threshold)

   This means the edge is NOT ROBUST to sample variation.
   It depends heavily on the specific events in the dataset.
   A different 18-month window might produce completely different
   results. This is the definition of overfitting to the observed
   sample.

4. DIRECTIONAL SYMMETRY (ALL failed)
   ─────────────────────────────────────
   The critical finding:

   • BTC: Above-VWAP mean = -0.14% (below-VWAP = +0.17%)
          Difference is NOT significant (p=0.27)
          → Can't distinguish edge from noise directionally

   • SOL: Above-VWAP mean = +0.35% (ABOVE-VWAP is BETTER!)
          The REVERSE direction outperforms the detected edge
          → The detected "edge" is actually the WRONG direction

   • XRP: Above-VWAP mean = +0.43% (similar to below-VWAP +0.39%)
          Both directions perform similarly
          → No true directional asymmetry exists

   This is devastating. For SOL, the "edge" we detected is actually
   the WEAKER direction. For XRP, both directions are equivalent.
   The directional test reveals that the below-VWAP signal is not
   structurally different from above-VWAP — it's just noise
   dressed up as signal.

5. EVENT CLUSTERING (ALL passed — but irrelevant)
   ─────────────────────────────────────────────
   Interestingly, after de-clustering, the edge STRENGTHENS.
   This tells us the edge signal is real at the cluster level,
   but the clusters themselves create statistical dependency
   that inflates the original sample size. The de-clustered
   sample (n=23-155) is too small for reliable inference.

   The fact that clustering passes while everything else fails
   confirms the edge exists in isolated market dislocations,
   but is not a systematic, repeatable pattern.

6. PATH STABILITY (ALL passed — but misleading)
   ─────────────────────────────────────────────
   While the terminal returns are "theoretically valid,"
   the path to get there is brutal:
   • MAE before MFE in 56-68% of cases
   • 40% stop-out rate at just 2% stop
   • 7-12% catastrophic outcomes
   • Worst single drawdown: -52% (XRP)

   The path passes because enough events eventually recover,
   but this is survivorship bias in the time dimension.
   A real trader would get stopped out long before recovery.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHY THE INITIAL PHASE 2 RESULTS WERE MISLEADING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The Phase 2 analysis showed:
  • "Statistically significant" (t-stats 3.6-6.1)
  • "Survives random baseline" (p ≈ 0.0000)
  • "Positive median" (not tail-driven)

But the stress tests revealed these were artifacts of:

1. REGIME POOLING
   Combining bull/bear/sideways regimes creates heterogeneity
   that inflates t-stats. The "edge" is really regime-dependent
   behavior mislabeled as a universal edge.

2. CLUSTER INFLATION
   72-76% of events are in clusters (mean cluster size 4.6-5.4).
   This means the "n=841" for SOL is really ~155 independent
   observations. The t-stat is inflated by ~√5.4 ≈ 2.3x.

3. TEMPORAL AUTOCORRELATION
   Consecutive VWAP deviations are not independent events.
   They represent the same market move viewed at different
   timestamps. The statistical tests assumed independence
   that doesn't exist.

4. LOOK-AHEAD BIAS IN HORIZON SELECTION
   The "optimal horizon" was selected by looking at all
   horizons and picking the best. This is data snooping.
   The true out-of-sample horizon performance would be
   lower than reported.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT WOULD A REAL EDGE LOOK LIKE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For an edge to survive stress testing, it must:

1. Persist in >70% of regime sub-splits
   (this edge: 0-60%)

2. Survive entry delays of +1 to +3 candles
   (this edge: dies at +3)

3. Maintain significance in >80% of random subsamples
   (this edge: 1-77%)

4. Show directional asymmetry (one direction clearly better)
   (this edge: either wrong direction or symmetric)

5. Be execution-tolerant (not collapse with realistic friction)
   (this edge: 40% stop-out at 2%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RECOMMENDATION: RETURN TO PHASE 2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The current event definition (VWAP deviation >2%) does NOT produce
a tradeable edge. Reject it completely.

Options for Phase 2 redesign:

A. DIFFERENT EVENT FAMILY
   The VWAP deviation event is fundamentally a mean-reversion
   signal. Mean-reversion edges in crypto tend to be regime-
   dependent and timing-fragile. Consider:
   - Momentum/trend events (breakouts, trend confirmation)
   - Volatility regime events (expansion/compression cycles)
   - Microstructure events (funding rate, open interest shifts)

   These may be more robust because they align with the
   directional nature of crypto markets.

B. CONDITIONAL EVENT DEFINITION
   Instead of "VWAP deviation >2%" as a standalone event,
   define it conditionally:
   - VWAP deviation >2% AND volatility regime = high
   - VWAP deviation >2% AND trend = bear (oversold bounce)
   - VWAP deviation >2% AND volume spike (capitulation)

   Adding conditions may isolate the regime where the edge
   actually lives (if any regime-specific version exists).

C. HIGHER-FREQUENCY ANALYSIS
   Move from 15m to 5m or 1m data. Short-term mean reversion
   may be more robust at higher frequencies where microstructure
   effects dominate.

D. DIFFERENT ASSET UNIVERSE
   The edge may exist in altcoins with different market structure.
   Consider adding: AVAX, DOGE, LINK, MATIC, etc.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BOTTOM LINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ╔════════════════════════════════════════════════════════════╗
  ║                                                            ║
  ║   EDGE REJECTED.                                          ║
  ║                                                            ║
  ║   The below-VWAP mean reversion signal is:                ║
  ║   • Regime-dependent (not universal)                      ║
  ║   • Timing-fragile (collapses with delays)                ║
  ║   • Sample-dependent (unstable under subsampling)         ║
  ║   • Not directionally asymmetric (fails adversarial test) ║
  ║                                                            ║
  ║   DO NOT BUILD A MODEL ON THIS EDGE.                      ║
  ║   Return to Phase 2 with redesigned event definitions.    ║
  ║                                                            ║
  ╚════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

print(report)

with open("/root/.openclaw/workspace/quant_research/results/STRESS_TEST_POSTMORTEM.txt", "w") as f:
    f.write(report)
