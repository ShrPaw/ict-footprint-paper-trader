# 🔬 WALK-FORWARD VALIDATION REPORT

**Generated:** 2026-04-04T21:25:59.358Z
**Method:** Rolling 12-month train / 3-month test / 3-month step
**Assets:** BTC, ETH, XRP
**Entry:** Funding extremes (p10/p95/cumulative drain)
**Exit:** Fixed 48h time exit, no stops
**Risk:** 1% per trade, max 3 concurrent
**Classification:** 🟡 CASE B — FRAGILE EDGE

---

## 1. Per-Window Metrics

| Window | Test Period | Trades | PF | WR | DD% | Net Return% | Avg Trade | Std Dev |
|--------|-------------|--------|-----|-----|-----|-------------|-----------|----------|
| 1 | 2022-01-01 → 2022-04-02 | 111 | 1.61 | 54.1% | 2.79% | 5.64% | 5.0829 | 0.0573 |
| 2 | 2022-04-02 → 2022-07-02 | 83 | 0.42 | 37.3% | 9.11% | -7.92% | -10.0501 | 0.0628 |
| 3 | 2022-07-02 → 2022-10-02 | 57 | 1.66 | 50.9% | 0.91% | 2.53% | 4.2930 | 0.0515 |
| 4 | 2022-10-02 → 2023-01-01 | 35 | 0.64 | 42.9% | 2.10% | -1.14% | -3.2149 | 0.0471 |
| 5 | 2023-01-01 → 2023-04-02 | 83 | 1.42 | 47.0% | 3.05% | 2.89% | 3.4049 | 0.0465 |
| 6 | 2023-04-02 → 2023-07-03 | 43 | 0.75 | 48.8% | 2.40% | -1.00% | -2.3316 | 0.0332 |
| 7 | 2023-07-03 → 2023-10-02 | 49 | 0.53 | 34.7% | 2.86% | -1.95% | -3.9569 | 0.0311 |
| 8 | 2023-10-02 → 2024-01-01 | 106 | 1.60 | 57.5% | 1.38% | 3.15% | 2.8908 | 0.0287 |
| 9 | 2024-01-01 → 2024-04-02 | 74 | 1.33 | 47.3% | 3.07% | 1.89% | 2.5470 | 0.0420 |
| 10 | 2024-04-02 → 2024-07-02 | 20 | 1.48 | 45.0% | 0.92% | 0.69% | 3.5220 | 0.0355 |
| 11 | 2024-07-02 → 2024-10-01 | 72 | 1.25 | 58.3% | 1.86% | 1.43% | 2.0329 | 0.0493 |
| 12 | 2024-10-01 → 2024-12-31 | 18 | 1.17 | 55.6% | 0.65% | 0.29% | 1.6401 | 0.0469 |
| 13 | 2025-01-01 → 2025-04-02 | 79 | 0.85 | 46.8% | 3.52% | -1.41% | -1.8507 | 0.0568 |
| 14 | 2025-04-02 → 2025-07-02 | 63 | 2.96 | 66.7% | 1.41% | 5.86% | 9.4994 | 0.0539 |
| 15 | 2025-07-02 → 2025-10-01 | 33 | 0.86 | 39.4% | 2.11% | -0.43% | -1.4158 | 0.0555 |
| 16 | 2025-10-01 → 2026-01-01 | 57 | 1.37 | 52.6% | 1.03% | 1.33% | 2.5129 | 0.0358 |

## 2. Aggregate Statistics

| Metric | Value |
|--------|-------|
| Mean PF | 1.243 |
| Median PF | 1.326 |
| PF Std Dev | 0.592 |
| % windows PF > 1 | 62.5% (10/16) |
| % profitable windows | 62.5% (10/16) |
| Max consecutive losing windows | 2 |
| Mean Win Rate | 49.1% |
| Mean IS PF | 1.317 |
| PF Degradation (IS→OOS) | 5.6% |

## 3. OOS Equity Curve

| Point | Equity |
|-------|--------|
| Start | $10000.00 |
| 0 | $10000.00 |
| 49 | $10124.53 |
| 98 | $10353.79 |
| 147 | $10234.56 |
| 196 | $9751.38 |
| 245 | $9998.31 |
| 294 | $10074.34 |
| 343 | $10219.54 |
| 392 | $9996.05 |
| 441 | $9919.38 |
| 490 | $10030.19 |
| 539 | $10112.96 |
| 588 | $10113.26 |
| 637 | $10362.69 |
| 686 | $10564.17 |
| 735 | $10512.91 |
| 784 | $10747.47 |
| 833 | $10422.42 |
| 882 | $10939.31 |
| 931 | $11028.23 |
| 980 | $11143.10 |
| End | $11140.67 |

**Total OOS return:** 11.41%
**Total OOS trades:** 983

## 4. Per-Asset OOS Breakdown

| Asset | Trades | PnL | WR | PF |
|-------|--------|-----|----|----|
| BTC | 327 | $810.32 | 51.1% | 1.26 |
| ETH | 292 | $78.91 | 49.3% | 1.03 |
| XRP | 364 | $251.44 | 49.5% | 1.09 |

## 5. Evaluation

### Pass Conditions

| Condition | Status | Value |
|-----------|--------|-------|
| Mean PF > 1.2 | ✅ PASS | 1.243 |
| ≥ 65% profitable windows | ❌ FAIL | 62.5% |
| No ≥ 4 consecutive losing windows | ✅ PASS | 2 |
| PF degradation < 40% vs IS | ✅ PASS | 5.6% |

### Failure Conditions

| Condition | Status | Value |
|-----------|--------|-------|
| PF ≤ 1.0 | ✅ OK | 1.243 |
| Flat/declining equity | ✅ OK | $11140.67 |
| Performance in few windows | ✅ OK | 62.5% |

## 6. Final Classification

### 🟡 CASE B — FRAGILE EDGE

The funding rate edge shows some out-of-sample viability but with notable instability across windows. The edge exists but is fragile and may not reliably produce returns in live conditions.

---

*No parameters were modified. No improvements suggested. This is a pure validation result.*
