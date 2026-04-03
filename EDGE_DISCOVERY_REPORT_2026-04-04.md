# 🔬 EDGE DISCOVERY REPORT — ICT Footprint Paper Trader

**Date:** 2026-04-04
**Method:** Instrumented signal tracing + statistical analysis + production backtest validation
**Scope:** SOL, BTC, ETH (2022-01-01 → 2026-03-31)
**Role:** Quantitative Researcher — no optimization, no parameter tuning, pure discovery

---

## EXECUTIVE SUMMARY

```
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   VERDICT: NO STRUCTURAL ENTRY EDGE EXISTS IN CURRENT SIGNALS       ║
║                                                                      ║
║   The system's apparent profitability is exit management,            ║
║   not entry prediction. Emergency stops destroy all gains.           ║
║   The only real edge is: TRENDING_UP regime for SOL.                ║
║                                                                      ║
║   RECOMMENDATION: Fundamental redesign of entry logic required.     ║
║   Keep: exit management (trailing stops + partial TP).              ║
║   Rebuild: everything upstream of position opening.                 ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 1. PRODUCTION BACKTEST RESULTS (Current Code)

All backtests run with the production engine (engine/backtest.js) using the Session #12 codebase.

| Asset | Trades | WR | PF | PnL | Emergency Stops | ES Cost | Filter Rate |
|-------|--------|----|----|----|-----------------|---------|-------------|
| SOL | 14 | 85.7% | 2.02 | +$290 | 2 | -$285 | 99.6% |
| BTC | 4 | 75.0% | 0.13 | -$1,167 | 1 | -$1,344 | 99.6% |
| ETH | 16 | 87.5% | 0.99 | -$3 | 2 | -$312 | 99.4% |
| **Total** | **34** | **85.3%** | **0.55** | **-$880** | **5** | **-$1,941** | **~99.5%** |

**Key observation:** 99.5% of potential trades are filtered out. The system processes ~150K candles per asset and generates only 4-16 trades over 4 years. This is not selectivity — this is near-total suppression.

**Critical:** All three assets produce negative or breakeven PF. The only profitable asset (SOL, PF 2.02) has only 14 trades — statistically meaningless.

---

## 2. SIGNAL FUNNEL ANALYSIS (SOL, Full Dataset)

Instrumented signal tracing across 68,685 evaluations (2022-2026 SOL):

### Pre-Model Gates (backtest.js level)

| Gate | Blocked | % of Total |
|------|---------|-----------|
| Weekend | ~18,800 | 27.4% |
| Killzone | ~12,200 | 17.8% |
| Regime blocked | 29,321 | 42.7% |
| EMA alignment | ~3,000 | 4.4% |
| Cooldown | ~110 | 0.2% |
| **Reached model** | **~8,800** | **12.8%** |

### Model-Level Gates (SOLModel.evaluate())

| Gate | Blocked | % of Model Evaluations |
|------|---------|----------------------|
| ATR-z > 2.0 | 4,791 | 7.0% |
| Dist from mean > 2.0 | 7,064 | 10.3% |
| Saturated (stacked ≥ 5) | 3,230 | 4.7% |
| No direction alignment | 8,834 | 12.9% |
| Low stacking (< 3) | 3,421 | 5.0% |
| Exhaustion detector | 3,729 | 5.4% |
| Below threshold | 7,973 | 11.6% |
| **Signals generated** | **161** | **0.2%** |

### Post-Signal Gates

| Gate | Blocked |
|------|---------|
| Portfolio risk | 98 |
| **Trades opened** | **161** |

### The Funnel in Numbers

```
68,685 total candle evaluations
  ↓ (12.8% pass pre-model gates)
~8,800 model evaluations
  ↓ (1.8% generate signals)
161 signals generated
  ↓ (61% pass portfolio risk)
~100 trades opened (161 total entries with partial TPs)
```

**Observation:** The system is not "filtering for quality." It's suppressing virtually everything. The 99.5%+ filter rate means the model has almost no opportunity to demonstrate edge — or lack thereof.

---

## 3. PROFITABLE CONDITIONS ANALYSIS (SOL 189 Trades)

### By Regime

| Regime | Trades | WR | PnL | PF | Emergency Stops |
|--------|--------|----|----|----|-----------------|
| TRENDING_UP | 72 | 93.1% | +$557 | 1.90 | 4 (5.6%) |
| VOL_EXPANSION | 5 | 100% | +$67 | ∞ | 0 |
| RANGING | 112 | 83.0% | -$767 | 0.65 | 20 (17.9%) |

### By Signal Type

| Signal Type | Trades | WR | PnL | PF |
|-------------|--------|----|----|----|
| SOL_MOMENTUM_DIV | 189 | 87.3% | -$144 | 0.95 |

### By Stacked Count

| Stacked | Trades | WR | PnL | Emergency Stops | ES Rate |
|---------|--------|----|----|-----------------|---------|
| 3 | 101 | 84.2% | -$463 | 16 | 15.8% |
| 4 | 28 | 85.7% | -$102 | 4 | 14.3% |
| 5 | 29 | 100% | +$437 | 0 | 0.0% |
| 6+ | 31 | 87.1% | -$15 | 4 | 12.9% |

### By Dist from Mean

| Dist (ATR) | Trades | WR | PnL | Emergency Stops | ES Rate |
|------------|--------|----|----|-----------------|---------|
| < 0.5 | 52 | 88.5% | +$8 | 6 | 11.5% |
| 0.5-1.0 | 42 | 81.0% | -$388 | 8 | 19.0% |
| 1.0-1.5 | 62 | 88.7% | +$56 | 7 | 11.3% |
| 1.5+ | 33 | 90.9% | +$181 | 3 | 9.1% |

### By Duration

| Duration | Trades | WR | PnL |
|----------|--------|----|----|
| ≤ 60min | 39 | 100% | +$588 |
| ≤ 120min | 72 | 100% | +$1,128 |
| ≤ 240min | 98 | 100% | +$1,541 |
| ≤ 480min | 112 | 100% | +$1,778 |
| ≤ 720min | 127 | 100% | +$2,037 |
| > 720min | 62 | 48.4% | -$2,181 |

**Duration is the single strongest discriminator in the entire dataset.**

---

## 4. LOSS FORENSICS — Emergency Stop Analysis

### Scale of the Problem

| Asset | Emergency Stops | Total Loss | Avg Loss per Stop | % of All Losses |
|-------|----------------|------------|-------------------|-----------------|
| SOL | 24 | -$2,815 | -$117 | 100% |
| BTC (A/B test) | 26 | -$22,142 | -$852 | 100% |
| ETH (A/B test) | 44 | -$9,676 | -$220 | 100% |
| **All assets** | **~152** | **-$55,569** | **-$366** | **100%** |

**Every dollar the system loses comes from emergency stops.** Trailing stops and partial TPs are profitable in every backtest. The system's problem is entirely about entries that go catastrophically wrong immediately.

### Feature Profile at Entry (Emergency Stops vs Winners)

| Feature | Emergency Avg | Winner Avg | Delta | Interpretation |
|---------|--------------|------------|-------|----------------|
| Stacked count | 3.9 | 4.1 | -0.2 | **NOT predictive** |
| ATR-z | -0.009 | -0.035 | +0.026 | **NOT predictive** |
| Dist from mean | 0.906 | 0.940 | -0.034 | **NOT predictive** |
| Momentum | 0.966% | 0.921% | +0.045% | **NOT predictive** |
| Vol ratio | 1.51x | ~1.4x | ~+0.1x | **NOT predictive** |

**No feature at entry differentiates emergency stops from winners.** The average features of losing trades are statistically indistinguishable from winning trades. This means the current features do not capture the signal that determines whether a trade will succeed or fail.

### Regime Distribution of Emergency Stops (SOL)

| Regime | Stops | % of Stops | Regime PnL |
|--------|-------|-----------|------------|
| RANGING | 20 | 83.3% | -$767 |
| TRENDING_UP | 4 | 16.7% | +$557 |

RANGING produces 83% of emergency stops despite being only ~21.5% of market time.

### Duration of Emergency Stops

- Average: 2,499 minutes (41.6 hours)
- Minimum: 1,455 minutes (24.3 hours)
- Maximum: 6,615 minutes (4.6 days)

Emergency stops are stale trades. They hold for 1-5 days and then get stopped out. No winner has ever held beyond 720 minutes (12 hours).

---

## 5. FEATURE TRUTH TABLE

| Feature | Predictive? | Correlation w/ PnL | Verdict |
|---------|------------|-------------------|---------|
| Stacked imbalance count | NO | r = +0.042 | Neutral. Count 5 has 100% WR but n=29. Count 3 has 84% WR and most emergency stops. |
| ATR-z at entry | NO | r = -0.067 | Neutral. No relationship. |
| Dist from mean | WEAK | r = +0.041 | Slight edge when >1.5 ATR (90.9% WR, +$181), but weak. |
| Momentum | NO | r = -0.011 | Neutral. Strong momentum slightly better than weak, but no real edge. |
| Delta trend direction | NO | N/A | All signals are SOL_MOMENTUM_DIV. No differentiation. |
| Vol ratio | WEAK | r = +0.100 | Slight positive — higher volume → slightly better outcomes. |
| **Regime** | **YES** | N/A | **TRENDING_UP: PF 1.90, 93.1% WR. RANGING: PF 0.65, 83% WR.** |
| **Duration** | **YES** | N/A | **Trades ≤12h: 100% WR. Trades >12h: 48.4% WR.** |

### Feature Effectiveness Summary

- **Valid:** Regime (TRENDING_UP vs RANGING), Duration
- **Misleading:** Stacked imbalance (the core feature — appears to signal momentum but actually correlates with exhaustion in RANGING)
- **Neutral:** ATR-z, momentum, delta direction, vol ratio (no predictive power)

---

## 6. TEMPORAL VALIDATION

### Trade Distribution by Year (SOL signal dataset)

The signal dataset shows trades across all years, but the production backtest only produced trades in 2022. This is because:

1. The production backtest uses the actual SOLModel (which has Session #12 bugs reducing signal generation)
2. The signal dataset uses independent signal logic

The A/B test (no filters) showed trades in all years:

| Year | Trades | WR | PnL |
|------|--------|----|----|
| 2022 | 187 | 83% | +$1,079 |
| 2023 | 173 | 86% | -$2,589 |
| 2024 | 242 | 82% | +$1,630 |
| 2025 | 217 | 79% | -$14,968 |
| 2026 | 48 | 75% | -$1,663 |

**2025 is catastrophic.** The system loses $14,968 in a single year. This confirms the edge (if any) is regime-specific, not structural. 2022 was favorable (crypto winter), 2023-2025 progressively worse.

---

## 7. TOP EDGES (Ranked by Edge Score)

Edge Score = PF × log(trade_count + 1) × (1 - emergency_stop_rate)

| # | Condition | Trades | WR | PF | ES Rate | Edge Score | Verdict |
|---|-----------|--------|----|----|---------|------------|---------|
| 1 | TRENDING_UP + SOL | 72 | 93.1% | 1.90 | 5.6% | 7.74 | ✅ **VALID** (but n=72, marginal) |
| 2 | SOL + stacked=5 | 29 | 100% | ∞ | 0% | ∞ | ⚠️ n=29, below 30 threshold |
| 3 | SOL + dist>1.5 ATR | 33 | 90.9% | ~1.5 | 9.1% | 5.2 | ⚠️ Marginal |
| 4 | SOL + duration≤4h | 98 | 100% | ∞ | 0% | ∞ | ✅ **VALID** (exit rule, not entry) |

**Only one entry edge passes all criteria: TRENDING_UP regime for SOL.** Everything else either fails the PF threshold, fails the minimum trade count, or has an unacceptable emergency stop rate.

---

## 8. WORST CONDITIONS (Anti-Edge)

| # | Condition | Trades | WR | PF | ES Rate | Verdict |
|---|-----------|--------|----|----|---------|---------|
| 1 | RANGING + SOL | 112 | 83.0% | 0.65 | 17.9% | 🔴 **AVOID** — -$767, 20 emergency stops |
| 2 | SOL + stacked=3 | 101 | 84.2% | ~0.7 | 15.8% | 🔴 **AVOID** — -$463, 16 emergency stops |
| 3 | SOL + dist 0.5-1.0 ATR | 42 | 81.0% | ~0.5 | 19.0% | 🔴 **AVOID** — -$388, 8 emergency stops |
| 4 | All assets in VOL_EXP (A/B) | 304 | 79% | ~0.7 | ~15% | 🔴 **AVOID** — -$12,841 combined |
| 5 | 2025 (all assets, A/B) | 217 | 79% | ~0.3 | ~20% | 🔴 **AVOID** — -$14,968 |

---

## 9. ROOT CAUSE ANALYSIS — Why The System Fails

### Root Cause #1: Feature Inversion

The SOL model's core feature — stacked delta imbalance — is interpreted as "momentum confirmation." The data shows this interpretation is **inverted in RANGING regime**:

- In TRENDING_UP: stacked delta = continuation (correct). PF 1.90.
- In RANGING: stacked delta = range boundary exhaustion (inverted). PF 0.65.

The model applies the same signal logic regardless of regime. But the same feature has opposite meaning depending on context.

### Root Cause #2: Emergency Stop Asymmetry

The system's PnL is dominated by a severe negative skew:

```
Winning exits:  trailing_sl (+$1,818) + partial_tp (+$537) + take_profit (+$125) = +$2,480
Losing exits:   emergency_stop (-$2,815) = -$2,815
Net:            -$335
```

The emergency stop at 12 ATR is too wide. Trades that go 12 ATR against the entry within 1-5 days were fundamentally wrong — no amount of waiting will rescue them. The 12 ATR stop just makes the inevitable loss larger.

### Root Cause #3: Survivorship Bias in "Validated" Results

The README claims PF 1.72, +$1,426 for SOL. The A/B test reveals this was achieved by the portfolio risk manager suppressing 99.5% of trades. Without filters, the same system has PF 1.06 across 867 trades = breakeven before fees.

The "validated" results are not representative of the system's edge. They're cherry-picked by an overly aggressive filter.

### Root Cause #4: No Adaptive Mechanism

The system uses fixed signal logic across all regimes, all years, all market conditions. The A/B test shows:
- 2022: +$1,079 (crypto winter — favorable)
- 2025: -$14,968 (different regime — catastrophic)

A system with real edge would show consistent (if declining) performance across years. The 2022-2025 divergence proves the system has regime-specific luck, not structural edge.

### Root Cause #5: Duration Ignorance

The clearest discriminator in the data is duration:
- Trades ≤12h: 100% WR, +$2,037
- Trades >12h: 48.4% WR, -$2,181

The system has no mechanism to exit stale trades before the emergency stop. The decay engine (Session #12) was the right concept but was implemented alongside other changes that broke signal generation.

---

## 10. SESSION #12 REGRESSION — Root Cause

The Trade Lifecycle Engine (Session #12) dropped SOL trades from 50 → 14. The signal tracer reveals:

**Before Session #12 (baseline from A/B test):** SOL generated ~50 trades (2022 only)
**After Session #12 (production backtest):** SOL generated 14 trades (2022 only)
**Signal dataset (independent logic, no Session #12 changes):** 189 trades (2022-2026)

The regression is caused by the combination of:
1. Saturated filter (stacked ≥ 5 rejection) — removes ~4.7% of model evaluations
2. Context classification interfering with signal scoring — the `_classifyContext()` method is called but its output (`flowCtx`) isn't used for scoring adjustments, only for the SATURATED check
3. The exhaustion detector + portfolio risk manager already block 99%+ of signals

The saturated filter alone shouldn't cause a 72% drop. The real issue is that the Session #12 changes modified the SOLModel's control flow, and somewhere in the interaction between `_classifyContext`, `_classifyOrderFlow`, and the existing scoring logic, signals are being lost.

**The Session #12 regression is a symptom, not the disease.** The system was already broken (PF ~0.95 without filters). Session #12 just made the filtering even more aggressive.

---

## 11. ACTION PLAN

### What to KEEP (validated, works)

1. **Exit management** — trailing stops (100% WR), partial TP (100% WR). This is the system's ONLY real edge. Keep exactly as-is.
2. **Per-asset regime blocking concept** — the idea that different assets need different regime filters is correct. SOL blocks TRENDING_DOWN, BTC blocks RANGING.
3. **Architecture** — per-asset models, precompute pipeline, backtest engine. Well-designed, keep the scaffolding.

### What to REMOVE

1. **SOLModel's stacked imbalance signal** — the core "momentum" feature is inverted in RANGING regime. Either invert the interpretation or remove it entirely.
2. **The 12 ATR emergency stop** — replace with a time-based exit (all trades that don't activate trailing within 12h should be closed at market).
3. **Portfolio risk manager as a filter** — it's creating survivorship bias, not managing risk. Use it for position sizing only, not for blocking entries.
4. **The exhaustion detector's stacked delta check** — it blocks entries with stacked ≥ 4, but the data shows stacked=5 has 100% WR. The detector is wrong.

### What to REBUILD

1. **Entry signals from scratch** — the current features (stacked delta, ATR-z, dist from mean) have near-zero correlation with PnL. New signals need to capture what actually moves price: regime transitions, volume profile shifts, liquidity dynamics.
2. **Regime-adaptive logic** — the system needs to change behavior based on regime, not just filter regimes out. TRENDING_UP and RANGING require completely different entry logic.
3. **Time-based exit** — the duration analysis proves this. If trailing hasn't activated within 12h, the trade is dead. Close it.
4. **Walk-forward validation** — no parameter should be tuned on the full dataset. Use rolling 12m train / 3m OOS.

### What to TEST IMMEDIATELY

1. **SOL TRENDING_UP only** — block RANGING. This is the only validated edge (PF 1.90, 72 trades, 93.1% WR).
2. **Time-based exit at 12h** — close any trade where trailing hasn't activated within 720 minutes.
3. **Remove portfolio risk as entry filter** — let all signals through, manage risk via position sizing only.

---

## 12. FINAL VERDICT

```
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   The system does NOT currently predict the market.                 ║
║                                                                      ║
║   What appeared to be edge was:                                     ║
║   1. Exit management (trailing stops) doing heavy lifting           ║
║   2. TRENDING_UP regime luck (crypto winter 2022)                   ║
║   3. Portfolio risk survivorship bias (cherry-picking trades)       ║
║                                                                      ║
║   Without filters: PF ~1.06 across 867 trades = NO EDGE            ║
║   With filters: PF 3.36 on 50 trades = NOT VALIDATABLE             ║
║                                                                      ║
║   The ONLY validated edge:                                          ║
║   • SOL TRENDING_UP: PF 1.90, 72 trades, 93.1% WR                 ║
║   • Duration ≤12h: 100% WR (exit rule, not entry)                  ║
║                                                                      ║
║   RECOMMENDATION: The entry model must be rebuilt from scratch.     ║
║   Keep the exit management. Rebuild everything else.                ║
║   Validate with walk-forward analysis from day one.                ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## APPENDIX: Data Sources

| Source | File | Description |
|--------|------|-------------|
| SOL signal trace | `data/signal-dataset-2026-04-03T21-58-54.jsonl` | 68,685 evaluations, 189 trades |
| SOL edge report | `data/edge-report-2026-04-03T21-59-04.md` | Statistical analysis |
| SOL counters | `data/signal-counters-2026-04-03T21-58-54.json` | Gate-level rejection counts |
| SOL production | `backtest-results/stats-*.json` | 14 trades, PF 2.02 |
| BTC production | `backtest-results/stats-*.json` | 4 trades, PF 0.13 |
| ETH production | `backtest-results/stats-*.json` | 16 trades, PF 0.99 |
| A/B test results | `AB_TEST_RESULTS.md` | Filtered vs unfiltered comparison |
| REAL_DIAGNOSIS | `REAL_DIAGNOSIS.md` | Feature inversion analysis |
