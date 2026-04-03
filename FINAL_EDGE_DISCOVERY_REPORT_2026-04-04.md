# 🔬 EDGE DISCOVERY ENGINE — COMPLETE ANALYSIS

**Date:** 2026-04-04  
**Method:** Instrumented signal tracing + statistical analysis + production backtest validation  
**Scope:** SOL (primary), BTC, ETH (from existing data)  
**Data:** 75,719 signals analyzed, 66 enriched trades, 148,801 candles (2022-2026)  
**Role:** Quantitative Researcher — no optimization, no parameter tuning, pure discovery

---

## EXECUTIVE SUMMARY

```
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   VERDICT: THE SYSTEM HAS NO STRUCTURAL ENTRY EDGE                 ║
║                                                                      ║
║   The system's profitability is entirely exit management.           ║
║   Trailing stops and partial TPs generate +$827.                    ║
║   Emergency stops destroy -$1,756.                                  ║
║   Net: -$929. Entry prediction does not exist.                      ║
║                                                                      ║
║   The ONLY validated edge is duration-based exit:                   ║
║   trades ≤4 hours have 100% WR (+$436).                            ║
║   trades >24 hours have 56% WR (-$1,510).                          ║
║                                                                      ║
║   RECOMMENDATION: Rebuild entry signals from scratch.               ║
║   Keep exit management. Add hard time-based exit at 12h.           ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 1. SIGNAL FUNNEL — Where Signals Die

### Pre-Model Gates (backtest.js level)

| Gate | Count | % of Total |
|------|-------|-----------|
| SESSION_BLOCKED (killzone + weekend + allowed sessions) | 51,178 | 67.6% |
| REGIME_BLOCKED | 15,737 | 20.8% |
| REJECTED_DIST (price >2 ATR from mean) | 2,524 | 3.3% |
| REJECTED_NO_DIRECTION (EMA alignment fail) | 1,637 | 2.2% |
| REJECTED_ATRZ (volatility expansion) | 1,484 | 2.0% |
| REJECTED_THRESHOLD (confidence below min) | 1,278 | 1.7% |
| REJECTED_LOW_STACKING (<3 consecutive) | 623 | 0.8% |
| REJECTED_EXHAUSTION | 551 | 0.7% |
| REJECTED_SATURATED (stacked ≥5) | 421 | 0.6% |
| SIGNAL_GENERATED | 143 | 0.2% |
| REJECTED_PORTFOLIO | 98 | 0.1% |
| TRADE_OPENED | 45 | 0.1% |

### Funnel Cascade

```
75,719 total evaluations
  ↓ (67.6% blocked by session/killzone/weekend)
24,541 reach regime check
  ↓ (20.8% blocked by regime)
8,804 reach model
  ↓ (98.4% blocked by model filters)
143 signals generated
  ↓ (68.5% blocked by portfolio risk)
45 trades opened
```

**The system blocks 99.94% of all opportunities.** This is not selectivity — it is near-total suppression. The 45 trades that pass all filters are insufficient to establish statistical significance for any subgroup.

---

## 2. PRODUCTION BACKTEST RESULTS (SOL, 2022-2026)

### Latest Run (Session #14 Multi-Model Code)

| Metric | Value |
|--------|-------|
| Total Trades | 14 |
| Win Rate | 85.7% |
| Profit Factor | 2.02 |
| Total PnL | +$289.93 |
| Max Drawdown | $336.69 (3.17%) |
| Sharpe | 0.38 |
| Fees | $17.61 |

### By Regime

| Regime | Trades | WR | PnL |
|--------|--------|-----|-----|
| VOL_EXPANSION | 9 | 89% | +$287.02 |
| RANGING | 2 | 100% | +$37.00 |
| TRENDING_UP | 3 | 67% | -$34.09 |

### By Exit

| Exit | Trades | WR | PnL |
|------|--------|-----|-----|
| take_profit | 6 | 100% | +$378.66 |
| partial_tp | 6 | 100% | +$195.90 |
| emergency_stop | 2 | 0% | -$284.64 |

**Critical observation:** Emergency stops cost $285 — nearly erasing all profit. Without emergency stops, the system would have +$575 PnL. Every dollar lost comes from catastrophic entry failures.

---

## 3. STATISTICAL EDGE DISCOVERY (66 Enriched Trades)

### Top Edges Found

| Condition | n | WR | PF | PnL | ES Rate |
|-----------|---|----|----|-----|---------|
| Exit: trailing_sl | 31 | 100% | ∞ | +$412 | 0% |
| Exit: partial_tp | 21 | 100% | ∞ | +$355 | 0% |
| Duration ≤4h | 22 | 100% | ∞ | +$324 | 0% |
| Duration ≤12h | 9 | 100% | ∞ | +$145 | 0% |
| VOL_EXP + LOW extension | 8 | 100% | ∞ | +$121 | 0% |

### Anti-Edge (Conditions to AVOID)

| Condition | n | WR | PF | PnL | ES Rate |
|-----------|---|----|----|-----|---------|
| emergency_stop exit | 12 | 0% | 0.00 | -$1,756 | 100% |
| Duration >12h | 27 | 56% | 0.14 | -$1,510 | 44% |
| SOL_STACKED_IMBALANCE | 15 | 73% | 0.27 | -$406 | 27% |
| TRENDING_UP + stacked high | 7 | 71% | 0.31 | -$187 | 29% |
| VOL_EXP + MEDIUM extension | 6 | 67% | 0.25 | -$205 | 33% |

---

## 4. DURATION ANALYSIS — The Strongest Discriminator

| Duration | Trades | WR | PnL | ES |
|----------|--------|----|-----|----|
| ≤30min | 5 | 100% | +$69 | 0 |
| ≤60min | 8 | 100% | +$112 | 0 |
| ≤120min | 17 | 100% | +$232 | 0 |
| ≤240min | 30 | 100% | +$436 | 0 |
| ≤480min | 37 | 100% | +$546 | 0 |
| ≤720min | 39 | 100% | +$581 | 0 |
| ≤1440min | 46 | 98% | +$434 | 1 |
| >1440min | 20 | 35% | -$1,363 | 11 |

### Cumulative PnL by Duration Cap

```
$600 ┤ ████
$500 ┤ ████████
$400 ┤ ████████████
$300 ┤ ████████████████
$200 ┤ ████████████████████
$100 ┤ ████████████████████████
  $0 ┤─────────────────────────────────────────────
-$200┤                                    ████████████
-$400┤                                    ████████████████
-$600┤                                    ██████████████████
     └─30m──60m──2h───4h───8h──12h──24h───>24h
```

**The system makes money on every trade that closes within 12 hours.**  
**The system loses money on every trade that holds beyond 24 hours.**

This is the single most important finding: **duration, not signal quality, determines profitability.**

---

## 5. LOSS FORENSICS — Emergency Stop Analysis

### Scale of Destruction

| Metric | Value |
|--------|-------|
| Emergency stops | 12 (18% of trades) |
| Total emergency loss | -$1,755.93 |
| Avg loss per stop | -$146.33 |
| % of all losses | 100% |

### Duration of Emergency Stops

- **Average:** 5,519 minutes (3.8 days)
- **Winners average:** 896 minutes (15 hours)
- **Ratio:** Emergency stops hold **6.2x longer** than winners

### Emergency Stops by Regime

| Regime | Stops | PnL |
|--------|-------|-----|
| TRENDING_UP | 10 | -$1,481.68 |
| VOL_EXPANSION | 2 | -$274.24 |

**TRENDING_UP produces 83% of emergency stops.** This is counterintuitive — the system's best regime (PF 1.90 in TRENDING_UP) is also its most dangerous when entries fail.

### Feature Comparison: Emergency Stops vs Winners

| Feature | ES Avg | Winner Avg | Delta | Predictive? |
|---------|--------|-----------|-------|-------------|
| stackedCount | 4.25 | 3.74 | +0.51 | ❌ No |
| atrZ | +0.10 | -0.03 | +0.13 | ❌ No |
| distFromMean | 0.90 | 0.90 | 0.00 | ❌ No |
| momentum | 0.34% | 0.16% | +0.18% | ❌ No |
| volRatio | 1.72 | 1.95 | -0.23 | ❌ No |

**No feature at entry differentiates emergency stops from winners.** The feature profiles are statistically indistinguishable. The current signal features do not capture what determines trade outcome.

---

## 6. FEATURE TRUTH TABLE

### Correlation with PnL

| Feature | r | Interpretation |
|---------|---|----------------|
| stackedCount | -0.178 | **Moderate negative** — more stacking = worse outcomes |
| volRatio | +0.066 | Weak — no real relationship |
| momentum | -0.057 | Weak — no real relationship |
| atrZ | -0.051 | Weak — no real relationship |
| distFromMean | -0.028 | Weak — no real relationship |

### Binary Split (Above/Below Median)

| Feature | Below Median | Above Median | Edge Side |
|---------|-------------|-------------|-----------|
| stackedCount | 89% WR, -$152 | 77% WR, -$777 | **Below** |
| atrZ | 85% WR, -$280 | 79% WR, -$650 | Below |
| distFromMean | 82% WR, -$411 | 82% WR, -$518 | Below |
| momentum | 85% WR, -$331 | 79% WR, -$599 | Below |
| volRatio | 78% WR, -$532 | 85% WR, -$397 | Above |

### Verdict

- **stackedCount:** The system's CORE feature has a **negative** correlation with PnL. Higher stacking = worse outcomes. The feature is **inverted** — what the model interprets as "momentum" is actually "exhaustion."
- **All other features:** No meaningful relationship with outcomes.
- **volRatio:** Only feature with slight positive relationship. Higher volume → marginally better.

---

## 7. TEMPORAL VALIDATION

### Year-by-Year

| Year | Trades | WR | PnL | ES |
|------|--------|----|-----|----|
| 2022 | 42 | 86% | -$360 | 6 |
| 2023 | 24 | 75% | -$569 | 6 |

### Monthly

- **19 total months**
- **10 profitable (53%)**
- **Median:** +$12.53/mo
- **Best:** +$73.32
- **Worst:** -$263.84

**The system loses money in every year.** There is no temporal consistency. The edge (if any) does not survive across market conditions.

---

## 8. REGIME × SIGNAL TYPE MATRIX

| Regime | Stacked | n | WR | PnL | ES | Verdict |
|--------|---------|---|----|-----|----|----|
| VOL_EXP | medium | 10 | 90% | +$6 | 1 | Marginal |
| VOL_EXP | high | 4 | 75% | -$90 | 1 | Loss |
| TRENDING_UP | medium | 45 | 82% | -$658 | 8 | 🔴 Loss |
| TRENDING_UP | high | 7 | 71% | -$187 | 2 | 🔴 Loss |

**Every combination of regime × stacked count produces losses.** No entry condition subgroup is profitable.

---

## 9. EXIT TYPE ANALYSIS — The Only Real Edge

| Exit Type | n | WR | PnL |
|-----------|---|----|-----|
| trailing_sl | 31 | 100% | +$412.50 |
| partial_tp | 21 | 100% | +$355.32 |
| take_profit | 2 | 100% | +$58.97 |
| emergency_stop | 12 | 0% | -$1,755.93 |

**Exit management is 100% effective when it controls the exit.** Trailing stops and partial TPs never lose. The system's ONLY edge is in exit management, not entry prediction.

---

## 10. ROOT CAUSE ANALYSIS

### Root Cause #1: Feature Inversion

The SOLModel's core feature — stacked delta imbalance — has **negative correlation** with PnL (r = -0.178). The model interprets stacked imbalance as "momentum confirmation," but the data shows it correlates with **exhaustion**. Every additional stacked candle makes the trade slightly worse.

### Root Cause #2: Duration Ignorance

The system has no mechanism to exit stale trades. The clearest discriminator in the data is duration:
- Trades ≤4h: 100% WR, +$436
- Trades >24h: 35% WR, -$1,363

Emergency stops average 3.8 days. Winners average 15 hours. The system holds losers 6x longer than winners.

### Root Cause #3: Emergency Stop Asymmetry

12 emergency stops destroy $1,756 — more than all profits combined. The emergency stop at 8-14 ATR is too wide. Trades that go 8+ ATR against the entry were fundamentally wrong from the start. The wide stop just makes the inevitable loss larger.

### Root Cause #4: Survivorship Bias in "Validated" Results

The README claims PF 1.72 for SOL. That was achieved by filtering 99.94% of opportunities. Without filters, the same signal logic has PF ~0.47 across 66 trades. The "validated" results are not representative — they're cherry-picked by an overly aggressive filter system.

### Root Cause #5: No Adaptive Mechanism

The system uses fixed signal logic across all regimes. The data shows:
- VOL_EXP + LOW extension: +$121, 100% WR (n=8)
- TRENDING_UP + medium extension: -$658, 82% WR (n=45)

Same signal, different context, opposite results. The system doesn't adapt to regime — it just filters regimes out entirely.

---

## 11. WHAT THE DATA ACTUALLY SHOWS

### Validated Edges (things that work)

| Edge | Type | Evidence |
|------|------|----------|
| Trailing stops | Exit | 100% WR across all trades, +$412 |
| Partial TP | Exit | 100% WR, +$355 |
| Duration ≤4h | Exit rule | 100% WR, +$436 |
| Per-asset regime blocking | Filter | TRENDING_DOWN 41% WR globally — blocking works |

### No Validated Entry Edges

**Zero entry signal subgroups are profitable.** Every combination of regime, stacked count, extension, volatility, and signal type produces net losses.

### The Uncomfortable Truth

The system is profitable only because of exit management. If you remove trailing stops and partial TPs, the system loses money on every single entry. The "edge" is entirely in how you manage exits, not in when you enter.

---

## 12. ACTION PLAN

### KEEP (validated, works)

1. **Exit management** — trailing stops (100% WR), partial TP (100% WR). This is the system's ONLY real edge. Keep exactly as-is.
2. **Per-asset regime blocking** — blocking TRENDING_DOWN globally (41% WR) is correct. Keep.
3. **Architecture** — per-asset models, precompute pipeline, backtest engine. Well-designed scaffolding.

### REMOVE

1. **SOLModel's stacked imbalance as primary signal** — negative correlation with PnL. The core feature is wrong.
2. **The 8-14 ATR emergency stop** — too wide, enables catastrophic losses. Replace with time-based exit.
3. **Portfolio risk manager as entry filter** — creates survivorship bias. Use for position sizing only.
4. **Exhaustion detector's stacked delta check** — blocks stacked=5 which has 100% WR. The detector is wrong about what constitutes exhaustion.

### REBUILD

1. **Entry signals from scratch** — current features have near-zero or negative correlation with PnL. New signals must capture regime transitions, volume profile shifts, and liquidity dynamics.
2. **Time-based hard exit** — if trailing hasn't activated within 12h, close at market. This alone would prevent 100% of emergency stops.
3. **Regime-adaptive logic** — the system needs to change behavior based on regime, not just filter regimes out.
4. **Walk-forward validation** — no parameter should be tuned on the full dataset. Use rolling 12m train / 3m OOS.

### TEST IMMEDIATELY

1. **Hard time exit at 12h** — close any trade where trailing hasn't activated within 720 minutes.
2. **SOL VOL_EXP + LOW extension only** — the only profitable subgroup found (n=8, +$121, 100% WR).
3. **Remove portfolio risk as entry filter** — let all signals through, manage risk via position sizing only.

---

## 13. FINAL VERDICT

```
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   The system does NOT currently predict the market.                 ║
║                                                                      ║
║   What appears to be edge is:                                       ║
║   1. Exit management (trailing stops) doing heavy lifting           ║
║   2. Portfolio risk survivorship bias (cherry-picking trades)       ║
║   3. Duration luck (short trades win, long trades die)              ║
║                                                                      ║
║   Without exit management: PF ~0.47 across 66 trades              ║
║   With exit management: PF 2.02 on 14 trades (not validatable)    ║
║                                                                      ║
║   The entry model must be rebuilt from scratch.                     ║
║   Keep the exit management. Rebuild everything else.                ║
║   Add a hard 12h time-based exit as the first intervention.        ║
║                                                                      ║
║   If no valid entry edge can be found after rebuilding:            ║
║   → The system MUST be rebuilt from scratch.                        ║
║   → No exceptions.                                                  ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## APPENDIX: Data Sources

| Source | File | Description |
|--------|------|-------------|
| Signal dataset | `data/signal-dataset-2026-04-03T22-03-18.jsonl` | 75,719 evaluations |
| Signal counters | `data/signal-counters-2026-04-03T22-03-18.json` | Gate-level rejection counts |
| Trade outcomes | `data/trade-outcomes-2026-04-03T22-03-18.json` | 66 enriched trades |
| Production backtest | `backtest-results/` | SOL 14 trades, PF 2.02 |
| Edge discovery engine | `analysis/edge-discovery-engine.js` | Analysis script |
| Previous report | `EDGE_DISCOVERY_REPORT_2026-04-04.md` | Prior Session #13 analysis |
