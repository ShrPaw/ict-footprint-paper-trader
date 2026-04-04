# 🔬 BTC-ONLY WALK-FORWARD REPORT — EDGE ISOLATION

**Generated:** 2026-04-04T21:57:56.476Z
**Method:** Rolling 12-month train / 3-month test / 3-month step
**Asset:** BTC ONLY (no ETH, no XRP, no slot competition)
**Entry:** Funding extremes (p10/p95/cumulative drain) — IDENTICAL to original
**Exit:** Fixed 48h time exit, no stops — IDENTICAL to original
**Risk:** 1% per trade, no concurrent limit — single asset
**Classification:** 🔴 NO EDGE

---

## 1. Per-Window OOS Metrics

| Window | Test Period | Trades | PF | WR | DD% | Return% | Catastrophic |
|--------|-------------|--------|-----|-----|-----|---------|-------------|
| 1 | 2022-01-01 → 2022-04-02 | 27 | 2.42 | 55.6% | 0.75% | 3.52% |  |
| 2 | 2022-04-02 → 2022-07-02 | 20 | 0.52 | 45.0% | 3.02% | -2.12% | 💀 |
| 3 | 2022-07-02 → 2022-10-02 | 7 | 2.52 | 42.9% | 0.33% | 0.51% |  |
| 4 | 2022-10-02 → 2023-01-01 | 8 | 0.37 | 25.0% | 0.78% | -0.78% | 💀 |
| 5 | 2023-01-01 → 2023-04-02 | 33 | 1.55 | 51.5% | 1.95% | 2.11% |  |
| 6 | 2023-04-02 → 2023-07-03 | 25 | 0.70 | 44.0% | 2.10% | -0.83% |  |
| 7 | 2023-07-03 → 2023-10-02 | 32 | 0.48 | 31.3% | 2.06% | -1.44% | 💀 |
| 8 | 2023-10-02 → 2024-01-01 | 40 | 2.02 | 65.0% | 0.52% | 2.05% |  |
| 9 | 2024-01-01 → 2024-04-02 | 25 | 1.75 | 56.0% | 1.35% | 1.68% |  |
| 10 | 2024-04-02 → 2024-07-02 | 8 | 1.02 | 50.0% | 0.51% | 0.02% |  |
| 11 | 2024-07-02 → 2024-10-01 | 22 | 1.09 | 54.5% | 0.93% | 0.18% |  |
| 12 | 2024-10-01 → 2024-12-31 | 8 | 1.38 | 62.5% | 0.74% | 0.35% |  |
| 13 | 2025-01-01 → 2025-04-02 | 25 | 0.85 | 48.0% | 1.65% | -0.41% |  |
| 14 | 2025-04-02 → 2025-07-02 | 19 | 5.95 | 78.9% | 0.34% | 2.54% |  |
| 15 | 2025-07-02 → 2025-10-01 | 10 | 0.55 | 30.0% | 0.48% | -0.32% | 💀 |
| 16 | 2025-10-01 → 2026-01-01 | 18 | 1.43 | 55.6% | 0.58% | 0.62% |  |

## 2. Aggregate Statistics

| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Mean PF | 1.538 | > 1.3 | ✅ |
| Median PF | 1.376 | — | — |
| PF Std Dev | 1.315 | < 0.5 | ❌ |
| Min PF | 0.368 | > 0.6 | ❌ |
| % Profitable Windows | 62.5% | ≥ 70% | ❌ |
| Max Consec Losses | 2 | < 4 | ✅ |
| Catastrophic Windows | 4 | 0 | ❌ |
| IS→OOS Degradation | -15.2% | — | — |

## 3. OOS Equity Curve

| Point | Equity |
|-------|--------|
| Start | $10000.00 |
| 0 | $10000.00 |
| 16 | $10114.14 |
| 32 | $10354.50 |
| 48 | $10132.46 |
| 64 | $10129.97 |
| 80 | $10289.20 |
| 96 | $10324.39 |
| 112 | $10180.18 |
| 128 | $10191.21 |
| 144 | $10024.40 |
| 160 | $10184.93 |
| 176 | $10202.37 |
| 192 | $10291.37 |
| 208 | $10534.91 |
| 224 | $10517.68 |
| 240 | $10459.65 |
| 256 | $10556.62 |
| 272 | $10548.23 |
| 288 | $10576.04 |
| 304 | $10743.75 |
| 320 | $10763.11 |
| End | $10772.29 |

**Total OOS return:** 7.72%
**Total OOS trades:** 327

## 4. Comparison: Multi-Asset BTC vs Isolated BTC

| Metric | Multi-Asset BTC | Isolated BTC | Delta |
|--------|-----------------|--------------|-------|
| PF | 1.26 | 1.538 | 0.278 |
| Trades | 327 | 327 | 0 |
| WR | 51.1% | 51.4% | 0.3% |

## 5. Critical Analysis

### Q1: Did removing ETH/XRP improve performance stability?
**YES** — Isolated PF 1.538 vs Multi-asset PF 1.26 (+0.278)

### Q2: Is BTC edge consistent across time or still regime-fragile?
Early windows PF: 1.324 | Late windows PF: 1.751
Shows temporal drift.

### Q3: Does the Terra/Luna window still break the system?
W1 (2022-01-01 → 2022-04-02): PF 2.42
NO — survives in isolation.

### Q4: Is the edge strong enough to justify capital?
Mean PF 1.538 with 62.5% profitable windows. Marginal — requires further scrutiny.

## 6. Final Classification

### 🔴 NO EDGE

BTC fails to demonstrate a standalone edge. The multi-asset results were masking BTC's true (lack of) performance. The entire project is invalid.

---
*Pure validation. No parameters modified. No improvements attempted.*
