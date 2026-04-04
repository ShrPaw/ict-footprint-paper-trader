# 🔬 PHASE 5.5 — STRUCTURAL EDGE VALIDATION
**Generated:** 2026-04-04T02:29:52.670Z
**Data:** Binance funding rates (8h) + 1h candles, 2022-01-01 → 2026-03-31
**Assumption:** Edge is false until proven robust.

---

## CLASSIFICATION SUMMARY

| Signal | Events | Indep. | Mean 48h | t-stat | Friction OK | Stable | Class |
|--------|--------|--------|----------|--------|-------------|--------|-------|
| btc_extremeLow_p10 | 464 | 416 | 0.5778% | 3.07 | ✅ | ✅ | 🟢 ROBUST STRUCTURAL EDGE |
| btc_extremeHigh_p95 | 233 | 219 | 0.6502% | 2.32 | ✅ | ❌ | 🟢 ROBUST STRUCTURAL EDGE |
| btc_highCumDrain | 897 | 774 | 0.3406% | 2.87 | ✅ | ❌ | 🟢 ROBUST STRUCTURAL EDGE |
| eth_negStreak3 | 242 | 196 | 0.8214% | 1.91 | ✅ | ✅ | 🟡 CONDITIONAL EDGE |
| eth_highCumDrain | 466 | 418 | 0.5471% | 2.76 | ✅ | ✅ | 🟢 ROBUST STRUCTURAL EDGE |
| xrp_highCumDrain | 466 | 420 | 1.8120% | 4.17 | ✅ | ✅ | 🟢 ROBUST STRUCTURAL EDGE |
| xrp_extremeLow_p10 | 463 | 417 | 1.0403% | 3.56 | ✅ | ✅ | 🟢 ROBUST STRUCTURAL EDGE |

---

## btc_extremeLow_p10

**Classification:** ROBUST STRUCTURAL EDGE (score: 8/8)
**Flags:**
- Unbounded tail risk

### T1 — Year Stability
| Year | Mean | t-stat | n | WR |
|------|------|--------|---|----|
| 2022 | 0.2339% | 0.71 | 188 | 51.6% |
| 2023 | 1.3959% | 2.51 | 63 | 61.9% |
| 2024 | 1.3990% | 3.44 | 60 | 70.0% |
| 2025 | 0.0738% | 0.20 | 83 | 53.0% |
| 2026 | 0.6587% | 1.53 | 70 | 60.0% |

Consistency: 100%

### T2 — Regime Independence
| Regime | Mean | t-stat | n |
|--------|------|--------|---|
| RANGING | 0.5382% | 2.16 | 273 |
| LOW_VOL | 0.7820% | 1.73 | 65 |
| TRENDING_UP | 0.0011% | 0.00 | 47 |
| TRENDING_DOWN | 1.1687% | 2.14 | 56 |
| VOL_EXPANSION | 0.2103% | 0.18 | 23 |

Regime independence: 100%

### T3 — Timing
- On signal: mean=0.5778% t=3.07
- +8h delay: mean=0.3469% t=1.93
- Retention: 60%

### T4 — Friction
- low: mean=0.4978% t=2.64
- medium: mean=0.4378% t=2.32
- high: mean=0.3778% t=2.00

### T5 — Distribution
- Mean: 0.5778% | Median: 0.4030%
- Skew: 0.71 | Kurtosis: 4.48
- Outlier driven: No | Fat tailed: No

### T6 — Risk
- Worst 1%: 15.39% | Worst 5%: 8.38%
- Bounded: NO
- Avg MFE: 3.4992%
- Time to positive: mean=7.3h median=2.0h

### T7 — Event Independence
- Clustering rate: 12.9%
- Independent events (est.): 416

---

## btc_extremeHigh_p95

**Classification:** ROBUST STRUCTURAL EDGE (score: 7/8)
**Flags:**
- Unbounded tail risk

### T1 — Year Stability
| Year | Mean | t-stat | n | WR |
|------|------|--------|---|----|
| 2023 | -0.0441% | -0.11 | 58 | 48.3% |
| 2024 | 0.8803% | 2.53 | 175 | 54.3% |

Consistency: 50%

### T2 — Regime Independence
| Regime | Mean | t-stat | n |
|--------|------|--------|---|
| TRENDING_UP | 1.4451% | 1.67 | 42 |
| RANGING | 0.2604% | 0.80 | 120 |
| TRENDING_DOWN | 1.3037% | 2.16 | 20 |
| LOW_VOL | 0.4114% | 0.53 | 43 |

Regime independence: 100%

### T3 — Timing
- On signal: mean=0.6502% t=2.32
- +8h delay: mean=0.8041% t=2.90
- Retention: 124%

### T4 — Friction
- low: mean=0.5702% t=2.03
- medium: mean=0.5102% t=1.82
- high: mean=0.4502% t=1.60

### T5 — Distribution
- Mean: 0.6502% | Median: 0.1821%
- Skew: 0.74 | Kurtosis: 1.37
- Outlier driven: No | Fat tailed: No

### T6 — Risk
- Worst 1%: 12.30% | Worst 5%: 10.70%
- Bounded: NO
- Avg MFE: 3.6539%
- Time to positive: mean=6.8h median=2.0h

### T7 — Event Independence
- Clustering rate: 7.8%
- Independent events (est.): 219

---

## btc_highCumDrain

**Classification:** ROBUST STRUCTURAL EDGE (score: 7/8)
**Flags:**
- Unbounded tail risk

### T1 — Year Stability
| Year | Mean | t-stat | n | WR |
|------|------|--------|---|----|
| 2022 | -3.4884% | -6.01 | 31 | 19.4% |
| 2023 | 0.4006% | 2.32 | 308 | 56.5% |
| 2024 | 0.5821% | 3.39 | 509 | 54.0% |
| 2025 | -0.1235% | -0.67 | 49 | 46.9% |

Consistency: 50%

### T2 — Regime Independence
| Regime | Mean | t-stat | n |
|--------|------|--------|---|
| UNKNOWN | -3.7181% | -4.17 | 16 |
| RANGING | 0.3050% | 2.14 | 510 |
| LOW_VOL | 0.5771% | 1.77 | 146 |
| TRENDING_UP | 0.7093% | 1.61 | 97 |
| TRENDING_DOWN | 0.5131% | 1.51 | 95 |
| VOL_EXPANSION | 0.2312% | 0.35 | 33 |

Regime independence: 83%

### T3 — Timing
- On signal: mean=0.3406% t=2.87
- +8h delay: mean=0.3687% t=3.13
- Retention: 108%

### T4 — Friction
- low: mean=0.2606% t=2.19
- medium: mean=0.2006% t=1.69
- high: mean=0.1406% t=1.18

### T5 — Distribution
- Mean: 0.3406% | Median: 0.1821%
- Skew: 0.57 | Kurtosis: 2.31
- Outlier driven: No | Fat tailed: No

### T6 — Risk
- Worst 1%: 12.64% | Worst 5%: 8.86%
- Bounded: NO
- Avg MFE: 2.9896%
- Time to positive: mean=7.4h median=1.0h

### T7 — Event Independence
- Clustering rate: 17.2%
- Independent events (est.): 774

---

## eth_negStreak3

**Classification:** CONDITIONAL EDGE (score: 5/8)
**Flags:**
- Not significant or negative
- Killed by 8h delay
- Unbounded tail risk

### T1 — Year Stability
| Year | Mean | t-stat | n | WR |
|------|------|--------|---|----|
| 2022 | 0.5325% | 0.83 | 144 | 54.2% |
| 2023 | 0.9627% | 1.77 | 22 | 45.5% |
| 2024 | 2.5230% | 1.64 | 11 | 63.6% |
| 2025 | 0.9129% | 0.84 | 18 | 38.9% |
| 2026 | 1.2070% | 1.54 | 47 | 61.7% |

Consistency: 100%

### T2 — Regime Independence
| Regime | Mean | t-stat | n |
|--------|------|--------|---|
| RANGING | 1.4104% | 2.86 | 133 |
| TRENDING_DOWN | 0.5600% | 0.33 | 36 |
| LOW_VOL | 1.1454% | 1.32 | 36 |
| TRENDING_UP | -1.8022% | -1.18 | 18 |
| VOL_EXPANSION | -0.9355% | -0.61 | 19 |

Regime independence: 60%

### T3 — Timing
- On signal: mean=0.8214% t=1.91
- +8h delay: mean=0.4231% t=1.02
- Retention: 52%

### T4 — Friction
- low: mean=0.7414% t=1.73
- medium: mean=0.6814% t=1.59
- high: mean=0.6214% t=1.45

### T5 — Distribution
- Mean: 0.8214% | Median: 0.6017%
- Skew: -0.47 | Kurtosis: 1.89
- Outlier driven: No | Fat tailed: No

### T6 — Risk
- Worst 1%: 26.64% | Worst 5%: 13.55%
- Bounded: NO
- Avg MFE: 5.5122%
- Time to positive: mean=7.3h median=1.0h

### T7 — Event Independence
- Clustering rate: 23.6%
- Independent events (est.): 196

---

## eth_highCumDrain

**Classification:** ROBUST STRUCTURAL EDGE (score: 8/8)
**Flags:**
- Unbounded tail risk

### T1 — Year Stability
| Year | Mean | t-stat | n | WR |
|------|------|--------|---|----|
| 2023 | 0.4103% | 1.34 | 126 | 47.6% |
| 2024 | 0.5978% | 2.42 | 340 | 56.8% |

Consistency: 100%

### T2 — Regime Independence
| Regime | Mean | t-stat | n |
|--------|------|--------|---|
| TRENDING_UP | 0.6766% | 1.25 | 67 |
| RANGING | 0.3288% | 1.26 | 246 |
| TRENDING_DOWN | 1.5220% | 2.38 | 49 |
| LOW_VOL | 0.7001% | 1.27 | 76 |
| VOL_EXPANSION | 0.0337% | 0.06 | 28 |

Regime independence: 100%

### T3 — Timing
- On signal: mean=0.5471% t=2.76
- +8h delay: mean=0.5421% t=2.72
- Retention: 99%

### T4 — Friction
- low: mean=0.4671% t=2.36
- medium: mean=0.4071% t=2.06
- high: mean=0.3471% t=1.75

### T5 — Distribution
- Mean: 0.5471% | Median: 0.2694%
- Skew: -0.20 | Kurtosis: 0.39
- Outlier driven: No | Fat tailed: No

### T6 — Risk
- Worst 1%: 15.15% | Worst 5%: 11.87%
- Bounded: NO
- Avg MFE: 3.8589%
- Time to positive: mean=6.8h median=1.0h

### T7 — Event Independence
- Clustering rate: 12.9%
- Independent events (est.): 418

---

## xrp_highCumDrain

**Classification:** ROBUST STRUCTURAL EDGE (score: 7/8)
**Flags:**
- Skew-driven (>2.0)
- Unbounded tail risk

### T1 — Year Stability
| Year | Mean | t-stat | n | WR |
|------|------|--------|---|----|
| 2023 | 0.2235% | 0.64 | 129 | 49.6% |
| 2024 | 2.6003% | 4.25 | 318 | 51.6% |
| 2025 | -0.5976% | -0.59 | 19 | 57.9% |

Consistency: 67%

### T2 — Regime Independence
| Regime | Mean | t-stat | n |
|--------|------|--------|---|
| TRENDING_UP | 5.3023% | 3.21 | 68 |
| RANGING | 0.6797% | 1.38 | 246 |
| VOL_EXPANSION | 1.3832% | 1.30 | 30 |
| LOW_VOL | 3.3870% | 2.60 | 77 |
| TRENDING_DOWN | 0.3184% | 0.43 | 45 |

Regime independence: 100%

### T3 — Timing
- On signal: mean=1.8120% t=4.17
- +8h delay: mean=1.7691% t=4.07
- Retention: 98%

### T4 — Friction
- low: mean=1.7320% t=3.99
- medium: mean=1.6720% t=3.85
- high: mean=1.6120% t=3.71

### T5 — Distribution
- Mean: 1.8120% | Median: 0.1650%
- Skew: 2.27 | Kurtosis: 7.71
- Outlier driven: YES ⚠️ | Fat tailed: YES ⚠️

### T6 — Risk
- Worst 1%: 24.11% | Worst 5%: 19.14%
- Bounded: NO
- Avg MFE: 6.9455%
- Time to positive: mean=7.1h median=1.0h

### T7 — Event Independence
- Clustering rate: 12.3%
- Independent events (est.): 420

---

## xrp_extremeLow_p10

**Classification:** ROBUST STRUCTURAL EDGE (score: 8/8)
**Flags:**
- Unbounded tail risk

### T1 — Year Stability
| Year | Mean | t-stat | n | WR |
|------|------|--------|---|----|
| 2022 | 1.1119% | 2.51 | 219 | 51.1% |
| 2023 | 1.6591% | 1.96 | 65 | 66.2% |
| 2024 | -1.8151% | -2.81 | 11 | 27.3% |
| 2025 | 1.1779% | 1.90 | 101 | 54.5% |
| 2026 | 0.4676% | 0.75 | 67 | 46.3% |

Consistency: 80%

### T2 — Regime Independence
| Regime | Mean | t-stat | n |
|--------|------|--------|---|
| TRENDING_DOWN | 0.7966% | 1.19 | 91 |
| RANGING | 1.4257% | 3.56 | 249 |
| LOW_VOL | 0.5589% | 1.03 | 69 |
| VOL_EXPANSION | -0.3371% | -0.22 | 26 |
| TRENDING_UP | 0.8709% | 0.61 | 28 |

Regime independence: 80%

### T3 — Timing
- On signal: mean=1.0403% t=3.56
- +8h delay: mean=0.9182% t=3.12
- Retention: 88%

### T4 — Friction
- low: mean=0.9603% t=3.28
- medium: mean=0.9003% t=3.08
- high: mean=0.8403% t=2.87

### T5 — Distribution
- Mean: 1.0403% | Median: 0.3423%
- Skew: 1.59 | Kurtosis: 9.53
- Outlier driven: No | Fat tailed: YES ⚠️

### T6 — Risk
- Worst 1%: 20.74% | Worst 5%: 12.72%
- Bounded: NO
- Avg MFE: 5.7719%
- Time to positive: mean=5.9h median=1.0h

### T7 — Event Independence
- Clustering rate: 12.5%
- Independent events (est.): 417

---

## FINAL VERDICT

### 🟢 ROBUST STRUCTURAL EDGE (6)
- **btc_extremeLow_p10**: 464 events, mean=0.5778%, t=3.07
- **btc_extremeHigh_p95**: 233 events, mean=0.6502%, t=2.32
- **btc_highCumDrain**: 897 events, mean=0.3406%, t=2.87
- **eth_highCumDrain**: 466 events, mean=0.5471%, t=2.76
- **xrp_highCumDrain**: 466 events, mean=1.8120%, t=4.17
- **xrp_extremeLow_p10**: 463 events, mean=1.0403%, t=3.56

### 🟡 CONDITIONAL EDGE (1)
- **eth_negStreak3**: Not significant or negative; Killed by 8h delay; Unbounded tail risk

### 🔴 FRAGILE / NON-EXTRACTABLE (0)
- None
