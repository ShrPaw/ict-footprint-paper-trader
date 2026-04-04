# 🔬 EDGE DISCOVERY REPORT v2.0
**Generated:** 2026-04-04T00:59:53.909Z
**Method:** Structural event hypothesis testing with early rejection
**Data:** binance 1h, 2022-01-01T00:00:00Z → 2026-03-31T23:59:59Z

---

## SUMMARY

- **Hypotheses tested:** 64
- **Survived early filters:** 14
- **Rejection rate:** 78.1%

---

## ETH

### Event Inventory

| Hypothesis | Raw Events | Independent | Cluster % | Status |
|------------|-----------|-------------|-----------|--------|
| breakout_20_high | 3336 | 1791 | 57.9% | REJECTED |
| breakout_50_high | 1957 | 1061 | 57.2% | REJECTED |
| breakout_20_low | 2912 | 1641 | 54.6% | REJECTED |
| range_expansion_2x | 3804 | 3172 | 20.8% | REJECTED |
| range_expansion_3x | 1383 | 1313 | 6.3% | REJECTED |
| strong_continuation_1x | 2033 | 1713 | 19.7% | SURVIVED |
| momentum_confluence | 14496 | 4686 | 84.6% | REJECTED |
| vol_compression_expansion | 662 | 340 | 60.7% | REJECTED |
| atr_spike_1.5 | 3731 | 1023 | 90.7% | REJECTED |
| atr_spike_2.0 | 2188 | 635 | 88.7% | REJECTED |
| abnormal_range_2.5x | 1184 | 984 | 21.1% | REJECTED |
| vol_squeeze | 5565 | 1575 | 89.6% | REJECTED |
| stop_run_continuation | 2875 | 2299 | 25.0% | SURVIVED |
| displacement_candle | 871 | 801 | 10.1% | SURVIVED |
| imbalance_gap | — | — | — | REJECTED |
| poc_shift | 3206 | 2158 | 40.9% | REJECTED |

### Surviving Candidates

#### strong_continuation_1x

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | -0.0004% | -0.0016% | 49.9% | -0.02 | ❌ | -0.38 | 10.64 |
| +4h | -0.0310% | -0.0253% | 48.8% | -0.81 | ❌ | 0.06 | 5.92 |
| +15h | -0.0448% | 0.0287% | 50.7% | -0.64 | ❌ | -0.45 | 5.05 |
| +24h | -0.0171% | -0.0084% | 49.9% | -0.20 | ❌ | -0.14 | 2.57 |

**Path Behavior:**
- MFE before MAE: 50% of trades
- Avg MAE: -3.922%
- Avg MFE: 3.569%
- Avg time to MAE: 11.1 bars
- Avg time to MFE: 11.0 bars

**Time Split Stability:** ✅ STABLE
- First half mean: -0.0116% (1009 events)
- Second half mean: -0.0225% (1022 events)
- Ratio: 1.94x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 14 | 0.1469% | 57.1% |
| RANGING | 1201 | -0.1081% | 48.1% |
| TRENDING_DOWN | 236 | 0.1371% | 54.7% |
| LOW_VOL | 280 | -0.0773% | 45.4% |
| TRENDING_UP | 207 | 0.0789% | 43.5% |
| VOL_EXPANSION | 95 | 0.3973% | 64.2% |

**Risk Flags:** None (passed all early filters)

#### stop_run_continuation

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | -0.0062% | -0.0006% | 49.9% | -0.41 | ❌ | -1.36 | 22.15 |
| +4h | 0.0048% | 0.0098% | 50.3% | 0.17 | ❌ | -0.53 | 8.61 |
| +15h | 0.0611% | 0.0323% | 50.7% | 1.18 | ❌ | 0.02 | 4.22 |
| +24h | 0.0838% | 0.0358% | 50.4% | 1.24 | ❌ | 0.15 | 3.28 |

**Path Behavior:**
- MFE before MAE: 51% of trades
- Avg MAE: -3.631%
- Avg MFE: 3.466%
- Avg time to MAE: 11.2 bars
- Avg time to MFE: 11.7 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.1264% (1424 events)
- Second half mean: 0.0420% (1448 events)
- Ratio: 0.33x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 11 | -1.7831% | 27.3% |
| RANGING | 1653 | 0.0086% | 48.8% |
| LOW_VOL | 575 | 0.0284% | 53.6% |
| TRENDING_DOWN | 319 | -0.1707% | 50.8% |
| TRENDING_UP | 237 | 0.2206% | 52.3% |
| VOL_EXPANSION | 80 | 0.0638% | 51.2% |

**Risk Flags:** None (passed all early filters)

#### displacement_candle

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0202% | 0.0112% | 51.3% | 0.59 | ❌ | -1.00 | 12.90 |
| +4h | -0.0248% | 0.0101% | 50.3% | -0.41 | ❌ | -0.71 | 5.37 |
| +15h | 0.0436% | 0.1877% | 53.7% | 0.39 | ❌ | -0.20 | 5.29 |
| +24h | 0.1852% | 0.1600% | 52.0% | 1.33 | ❌ | -0.14 | 3.42 |

**Path Behavior:**
- MFE before MAE: 48% of trades
- Avg MAE: -2.857%
- Avg MFE: 3.098%
- Avg time to MAE: 10.6 bars
- Avg time to MFE: 11.7 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.2264% (422 events)
- Second half mean: 0.1464% (449 events)
- Ratio: 0.65x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| RANGING | 529 | -0.0791% | 48.6% |
| LOW_VOL | 103 | -0.3030% | 41.7% |
| VOL_EXPANSION | 44 | 0.7349% | 72.7% |
| TRENDING_DOWN | 95 | -0.0350% | 56.8% |
| TRENDING_UP | 96 | 0.2735% | 53.1% |

**Risk Flags:** None (passed all early filters)

### Rejected Hypotheses

- **breakout_20_high**: CLUSTERING: 57.9% clustered (>50%); UNSTABLE: split means -0.001286 vs 0.001020
- **breakout_50_high**: CLUSTERING: 57.2% clustered (>50%); UNSTABLE: split means -0.000097 vs 0.002216
- **breakout_20_low**: CLUSTERING: 54.6% clustered (>50%); UNSTABLE: split means 0.002180 vs -0.000057
- **range_expansion_2x**: UNSTABLE: split means -0.000078 vs 0.000873
- **range_expansion_3x**: UNSTABLE: split means -0.000042 vs 0.002408
- **momentum_confluence**: CLUSTERING: 84.6% clustered (>50%); UNSTABLE: split means 0.000689 vs -0.000337
- **vol_compression_expansion**: CLUSTERING: 60.7% clustered (>50%); UNSTABLE: split means -0.000109 vs -0.008543
- **atr_spike_1.5**: CLUSTERING: 90.7% clustered (>50%); UNSTABLE: split means -0.000593 vs 0.003206
- **atr_spike_2.0**: CLUSTERING: 88.7% clustered (>50%); UNSTABLE: split means -0.001575 vs 0.007461
- **abnormal_range_2.5x**: UNSTABLE: split means -0.000363 vs 0.002178
- **vol_squeeze**: CLUSTERING: 89.6% clustered (>50%); UNSTABLE: split means -0.002779 vs 0.000180
- **imbalance_gap**: too few events: 1
- **poc_shift**: UNSTABLE: split means -0.000051 vs 0.000620

---

## SOL

### Event Inventory

| Hypothesis | Raw Events | Independent | Cluster % | Status |
|------------|-----------|-------------|-----------|--------|
| breakout_20_high | 3614 | 1828 | 61.8% | REJECTED |
| breakout_50_high | 2105 | 1088 | 60.4% | REJECTED |
| breakout_20_low | 3485 | 1819 | 59.7% | REJECTED |
| range_expansion_2x | 3166 | 2740 | 16.8% | SURVIVED |
| range_expansion_3x | 901 | 872 | 4.0% | REJECTED |
| strong_continuation_1x | 2057 | 1729 | 19.9% | REJECTED |
| momentum_confluence | 14736 | 4750 | 84.7% | REJECTED |
| vol_compression_expansion | 544 | 281 | 60.5% | REJECTED |
| atr_spike_1.5 | 4033 | 1087 | 91.3% | REJECTED |
| atr_spike_2.0 | 2441 | 673 | 90.5% | REJECTED |
| abnormal_range_2.5x | 808 | 682 | 19.4% | REJECTED |
| vol_squeeze | 5518 | 1588 | 89.0% | REJECTED |
| stop_run_continuation | 2739 | 2238 | 22.9% | SURVIVED |
| displacement_candle | 795 | 738 | 8.9% | SURVIVED |
| imbalance_gap | — | — | — | REJECTED |
| poc_shift | 3564 | 2296 | 44.5% | REJECTED |

### Surviving Candidates

#### range_expansion_2x

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | -0.0268% | -0.0184% | 49.0% | -1.19 | ❌ | -1.00 | 30.76 |
| +4h | -0.0076% | 0.0100% | 50.2% | -0.19 | ❌ | 0.14 | 11.30 |
| +15h | 0.0613% | -0.0671% | 48.8% | 0.83 | ❌ | -0.08 | 11.84 |
| +24h | 0.1308% | -0.0888% | 49.3% | 1.42 | ❌ | 0.08 | 7.20 |

**Path Behavior:**
- MFE before MAE: 54% of trades
- Avg MAE: -5.077%
- Avg MFE: 4.659%
- Avg time to MAE: 12.1 bars
- Avg time to MFE: 11.1 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.1013% (1691 events)
- Second half mean: 0.1647% (1473 events)
- Ratio: 1.63x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 14 | -0.5784% | 50.0% |
| RANGING | 1807 | 0.0072% | 50.2% |
| LOW_VOL | 553 | -0.0864% | 50.3% |
| TRENDING_DOWN | 311 | 0.1063% | 56.3% |
| TRENDING_UP | 319 | -0.0572% | 45.1% |
| VOL_EXPANSION | 162 | 0.0242% | 46.9% |

**Risk Flags:** None (passed all early filters)

#### stop_run_continuation

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0048% | 0.0131% | 50.5% | 0.22 | ❌ | -0.30 | 14.51 |
| +4h | 0.0538% | 0.0079% | 50.1% | 1.26 | ❌ | -0.74 | 18.30 |
| +15h | 0.1769% | 0.1233% | 51.5% | 2.30 | ✅ | 0.11 | 7.97 |
| +24h | 0.2103% | 0.0486% | 50.5% | 2.11 | ✅ | 0.35 | 9.95 |

**Path Behavior:**
- MFE before MAE: 56% of trades
- Avg MAE: -4.993%
- Avg MFE: 4.283%
- Avg time to MAE: 12.4 bars
- Avg time to MFE: 11.2 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.2236% (1415 events)
- Second half mean: 0.1961% (1322 events)
- Ratio: 0.88x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 12 | -1.1163% | 25.0% |
| RANGING | 1578 | 0.0902% | 50.0% |
| LOW_VOL | 508 | -0.1382% | 46.1% |
| TRENDING_DOWN | 280 | -0.0549% | 57.1% |
| TRENDING_UP | 263 | 0.4268% | 52.1% |
| VOL_EXPANSION | 98 | -0.0843% | 50.0% |

**Risk Flags:** None (passed all early filters)

#### displacement_candle

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0127% | 0.0487% | 51.8% | 0.30 | ❌ | 0.15 | 9.31 |
| +4h | -0.0421% | -0.0480% | 48.4% | -0.51 | ❌ | 0.51 | 4.18 |
| +15h | -0.0244% | -0.0552% | 48.8% | -0.15 | ❌ | -0.34 | 10.55 |
| +24h | 0.1000% | -0.1705% | 48.2% | 0.51 | ❌ | -0.66 | 13.41 |

**Path Behavior:**
- MFE before MAE: 50% of trades
- Avg MAE: -4.333%
- Avg MFE: 4.360%
- Avg time to MAE: 11.4 bars
- Avg time to MFE: 11.2 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.0763% (363 events)
- Second half mean: 0.1199% (432 events)
- Ratio: 1.57x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| RANGING | 513 | -0.1010% | 46.8% |
| LOW_VOL | 97 | 0.1448% | 51.5% |
| TRENDING_DOWN | 70 | 0.0284% | 55.7% |
| TRENDING_UP | 74 | 0.1763% | 50.0% |
| VOL_EXPANSION | 34 | -0.0757% | 52.9% |

**Risk Flags:** None (passed all early filters)

### Rejected Hypotheses

- **breakout_20_high**: CLUSTERING: 61.8% clustered (>50%)
- **breakout_50_high**: CLUSTERING: 60.4% clustered (>50%)
- **breakout_20_low**: CLUSTERING: 59.7% clustered (>50%); UNSTABLE: split means 0.003018 vs 0.000986
- **range_expansion_3x**: UNSTABLE: split means 0.004458 vs 0.000830
- **strong_continuation_1x**: UNSTABLE: split means 0.003158 vs 0.000713
- **momentum_confluence**: CLUSTERING: 84.7% clustered (>50%); UNSTABLE: split means 0.001955 vs 0.000522
- **vol_compression_expansion**: CLUSTERING: 60.5% clustered (>50%); UNSTABLE: split means 0.001785 vs -0.003034
- **atr_spike_1.5**: CLUSTERING: 91.3% clustered (>50%); UNSTABLE: split means 0.001313 vs 0.004988
- **atr_spike_2.0**: CLUSTERING: 90.5% clustered (>50%); UNSTABLE: split means 0.001362 vs 0.006822
- **abnormal_range_2.5x**: UNSTABLE: split means 0.000742 vs 0.006111
- **vol_squeeze**: CLUSTERING: 89.0% clustered (>50%)
- **imbalance_gap**: too few events: 1
- **poc_shift**: UNSTABLE: split means 0.000619 vs 0.002044

---

## BTC

### Event Inventory

| Hypothesis | Raw Events | Independent | Cluster % | Status |
|------------|-----------|-------------|-----------|--------|
| breakout_20_high | 3295 | 1782 | 57.4% | REJECTED |
| breakout_50_high | 1858 | 1008 | 57.2% | REJECTED |
| breakout_20_low | 3106 | 1684 | 57.2% | REJECTED |
| range_expansion_2x | 3625 | 3045 | 20.0% | SURVIVED |
| range_expansion_3x | 1281 | 1224 | 5.5% | SURVIVED |
| strong_continuation_1x | 2058 | 1698 | 21.9% | SURVIVED |
| momentum_confluence | 14553 | 4651 | 85.1% | REJECTED |
| vol_compression_expansion | 604 | 330 | 56.6% | REJECTED |
| atr_spike_1.5 | 3552 | 961 | 91.2% | REJECTED |
| atr_spike_2.0 | 2106 | 600 | 89.4% | REJECTED |
| abnormal_range_2.5x | 1296 | 1050 | 23.8% | SURVIVED |
| vol_squeeze | 5506 | 1524 | 90.4% | REJECTED |
| stop_run_continuation | 2860 | 2275 | 25.6% | SURVIVED |
| displacement_candle | 935 | 842 | 12.4% | SURVIVED |
| imbalance_gap | — | — | — | REJECTED |
| poc_shift | 2837 | 1907 | 41.0% | SURVIVED |

### Surviving Candidates

#### range_expansion_2x

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0040% | 0.0089% | 50.9% | 0.35 | ❌ | -0.24 | 10.55 |
| +4h | 0.0232% | 0.0101% | 50.4% | 1.15 | ❌ | -0.08 | 7.09 |
| +15h | 0.0702% | 0.0425% | 51.3% | 1.94 | ❌ | 0.11 | 3.57 |
| +24h | 0.1466% | 0.0441% | 50.9% | 3.14 | ✅ | 0.22 | 3.89 |

**Path Behavior:**
- MFE before MAE: 53% of trades
- Avg MAE: -2.989%
- Avg MFE: 2.813%
- Avg time to MAE: 11.4 bars
- Avg time to MFE: 10.8 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.1222% (1965 events)
- Second half mean: 0.1755% (1660 events)
- Ratio: 1.44x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 16 | -0.2101% | 50.0% |
| RANGING | 2062 | 0.0408% | 50.3% |
| LOW_VOL | 697 | -0.0496% | 48.4% |
| TRENDING_DOWN | 376 | -0.0310% | 53.5% |
| TRENDING_UP | 367 | 0.0994% | 50.4% |
| VOL_EXPANSION | 107 | 0.1209% | 55.1% |

**Risk Flags:** None (passed all early filters)

#### range_expansion_3x

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0149% | 0.0175% | 51.8% | 0.70 | ❌ | -0.39 | 13.10 |
| +4h | 0.0370% | 0.0302% | 51.4% | 1.03 | ❌ | -0.39 | 8.18 |
| +15h | 0.0555% | 0.0305% | 50.9% | 0.91 | ❌ | 0.05 | 3.35 |
| +24h | 0.1202% | 0.0296% | 50.6% | 1.51 | ❌ | -0.09 | 4.72 |

**Path Behavior:**
- MFE before MAE: 51% of trades
- Avg MAE: -2.271%
- Avg MFE: 2.305%
- Avg time to MAE: 10.8 bars
- Avg time to MFE: 10.9 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.1087% (744 events)
- Second half mean: 0.1360% (537 events)
- Ratio: 1.25x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| RANGING | 717 | 0.0458% | 50.5% |
| LOW_VOL | 226 | 0.0319% | 51.8% |
| TRENDING_DOWN | 145 | 0.0076% | 57.9% |
| TRENDING_UP | 147 | -0.0127% | 46.9% |
| VOL_EXPANSION | 43 | 0.1486% | 55.8% |

**Risk Flags:** None (passed all early filters)

#### strong_continuation_1x

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0129% | 0.0230% | 52.1% | 0.79 | ❌ | -0.36 | 5.33 |
| +4h | 0.0285% | 0.0392% | 51.9% | 1.00 | ❌ | 0.33 | 5.67 |
| +15h | 0.0654% | 0.0346% | 51.0% | 1.28 | ❌ | -0.23 | 4.06 |
| +24h | 0.1600% | 0.0410% | 50.7% | 2.43 | ✅ | 0.03 | 4.24 |

**Path Behavior:**
- MFE before MAE: 48% of trades
- Avg MAE: -2.842%
- Avg MFE: 2.712%
- Avg time to MAE: 11.2 bars
- Avg time to MFE: 11.4 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.1657% (992 events)
- Second half mean: 0.1546% (1061 events)
- Ratio: 0.93x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 10 | -0.3232% | 50.0% |
| LOW_VOL | 276 | -0.0228% | 53.6% |
| RANGING | 1213 | 0.0383% | 51.4% |
| TRENDING_DOWN | 238 | -0.0767% | 53.8% |
| VOL_EXPANSION | 83 | 0.2678% | 60.2% |
| TRENDING_UP | 238 | 0.0743% | 47.5% |

**Risk Flags:** None (passed all early filters)

#### abnormal_range_2.5x

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0030% | 0.0275% | 52.1% | 0.13 | ❌ | -0.43 | 9.18 |
| +4h | -0.0074% | 0.0194% | 51.2% | -0.19 | ❌ | -0.47 | 6.12 |
| +15h | 0.0478% | 0.0079% | 50.1% | 0.77 | ❌ | -0.00 | 2.98 |
| +24h | 0.1225% | 0.0295% | 50.6% | 1.47 | ❌ | 0.36 | 4.93 |

**Path Behavior:**
- MFE before MAE: 49% of trades
- Avg MAE: -2.396%
- Avg MFE: 2.506%
- Avg time to MAE: 10.5 bars
- Avg time to MFE: 10.8 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.1094% (732 events)
- Second half mean: 0.1396% (563 events)
- Ratio: 1.28x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| RANGING | 744 | 0.0200% | 51.2% |
| VOL_EXPANSION | 68 | 0.1529% | 60.3% |
| LOW_VOL | 134 | -0.2021% | 43.3% |
| TRENDING_DOWN | 167 | -0.1249% | 52.1% |
| TRENDING_UP | 176 | 0.0790% | 52.3% |

**Risk Flags:** None (passed all early filters)

#### stop_run_continuation

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0159% | 0.0116% | 51.5% | 1.35 | ❌ | 0.32 | 10.27 |
| +4h | 0.0505% | 0.0310% | 52.1% | 2.21 | ✅ | 0.32 | 6.72 |
| +15h | 0.1014% | 0.0345% | 51.1% | 2.62 | ✅ | 0.13 | 3.71 |
| +24h | 0.1153% | 0.0565% | 51.6% | 2.30 | ✅ | 0.31 | 3.10 |

**Path Behavior:**
- MFE before MAE: 49% of trades
- Avg MAE: -2.737%
- Avg MFE: 2.542%
- Avg time to MAE: 11.0 bars
- Avg time to MFE: 11.1 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.1000% (1472 events)
- Second half mean: 0.1316% (1384 events)
- Ratio: 1.32x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 12 | -1.1986% | 16.7% |
| RANGING | 1596 | 0.0669% | 53.0% |
| LOW_VOL | 565 | -0.0170% | 48.0% |
| TRENDING_DOWN | 319 | 0.0283% | 53.3% |
| TRENDING_UP | 288 | 0.1116% | 52.8% |
| VOL_EXPANSION | 79 | 0.2586% | 60.8% |

**Risk Flags:** None (passed all early filters)

#### displacement_candle

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0166% | 0.0115% | 50.6% | 0.66 | ❌ | -0.31 | 4.43 |
| +4h | 0.0028% | 0.0132% | 50.4% | 0.07 | ❌ | -0.22 | 2.87 |
| +15h | 0.0941% | 0.0722% | 51.8% | 1.25 | ❌ | -0.08 | 2.76 |
| +24h | 0.1759% | 0.1199% | 52.5% | 1.79 | ❌ | 0.27 | 2.98 |

**Path Behavior:**
- MFE before MAE: 47% of trades
- Avg MAE: -2.249%
- Avg MFE: 2.645%
- Avg time to MAE: 10.3 bars
- Avg time to MFE: 11.3 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.2644% (436 events)
- Second half mean: 0.0985% (499 events)
- Ratio: 0.37x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| LOW_VOL | 95 | -0.0011% | 51.6% |
| RANGING | 591 | -0.0039% | 49.9% |
| TRENDING_DOWN | 97 | -0.3317% | 44.3% |
| TRENDING_UP | 101 | 0.2428% | 52.5% |
| VOL_EXPANSION | 49 | 0.2494% | 61.2% |

**Risk Flags:** None (passed all early filters)

#### poc_shift

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | -0.0106% | -0.0086% | 49.5% | -0.67 | ❌ | -0.07 | 6.71 |
| +4h | -0.0260% | -0.0037% | 49.8% | -0.97 | ❌ | -0.16 | 5.68 |
| +15h | 0.0206% | 0.0234% | 50.5% | 0.45 | ❌ | -0.06 | 3.05 |
| +24h | 0.0795% | 0.0358% | 50.6% | 1.38 | ❌ | 0.05 | 3.78 |

**Path Behavior:**
- MFE before MAE: 53% of trades
- Avg MAE: -3.241%
- Avg MFE: 2.805%
- Avg time to MAE: 10.9 bars
- Avg time to MFE: 10.8 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.0614% (1381 events)
- Second half mean: 0.0967% (1453 events)
- Ratio: 1.57x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 24 | -0.5202% | 37.5% |
| RANGING | 1796 | -0.0009% | 49.3% |
| LOW_VOL | 250 | -0.1021% | 48.4% |
| TRENDING_DOWN | 350 | -0.1358% | 52.3% |
| TRENDING_UP | 293 | 0.0625% | 49.8% |
| VOL_EXPANSION | 124 | -0.0400% | 56.5% |

**Risk Flags:** None (passed all early filters)

### Rejected Hypotheses

- **breakout_20_high**: CLUSTERING: 57.4% clustered (>50%); UNSTABLE: split means 0.001512 vs -0.000273
- **breakout_50_high**: CLUSTERING: 57.2% clustered (>50%)
- **breakout_20_low**: CLUSTERING: 57.2% clustered (>50%); UNSTABLE: split means 0.000172 vs 0.001323
- **momentum_confluence**: CLUSTERING: 85.1% clustered (>50%)
- **vol_compression_expansion**: CLUSTERING: 56.6% clustered (>50%); UNSTABLE: split means 0.002548 vs -0.001410
- **atr_spike_1.5**: CLUSTERING: 91.2% clustered (>50%)
- **atr_spike_2.0**: CLUSTERING: 89.4% clustered (>50%); UNSTABLE: split means 0.000087 vs 0.003742
- **vol_squeeze**: CLUSTERING: 90.4% clustered (>50%)
- **imbalance_gap**: too few events: 0

---

## XRP

### Event Inventory

| Hypothesis | Raw Events | Independent | Cluster % | Status |
|------------|-----------|-------------|-----------|--------|
| breakout_20_high | 3167 | 1689 | 58.3% | REJECTED |
| breakout_50_high | 1694 | 906 | 58.1% | REJECTED |
| breakout_20_low | 3018 | 1696 | 54.7% | REJECTED |
| range_expansion_2x | 3272 | 2833 | 16.8% | SURVIVED |
| range_expansion_3x | 1089 | 1042 | 5.4% | REJECTED |
| strong_continuation_1x | 1907 | 1607 | 19.7% | REJECTED |
| momentum_confluence | 14259 | 4714 | 83.7% | REJECTED |
| vol_compression_expansion | 535 | 271 | 61.7% | REJECTED |
| atr_spike_1.5 | 3948 | 1038 | 92.1% | REJECTED |
| atr_spike_2.0 | 2480 | 676 | 90.9% | REJECTED |
| abnormal_range_2.5x | 1017 | 855 | 20.0% | REJECTED |
| vol_squeeze | 5973 | 1623 | 91.0% | REJECTED |
| stop_run_continuation | 2811 | 2277 | 23.8% | REJECTED |
| displacement_candle | 687 | 640 | 8.6% | REJECTED |
| imbalance_gap | — | — | — | REJECTED |
| poc_shift | 3119 | 2093 | 41.1% | REJECTED |

### Surviving Candidates

#### range_expansion_2x

**Forward Returns:**

| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |
|---------|------|--------|-------|--------|-------------|------|----------|
| +1h | 0.0197% | 0.0308% | 51.7% | 0.95 | ❌ | -0.49 | 32.07 |
| +4h | 0.0646% | 0.0775% | 52.4% | 1.86 | ❌ | 2.00 | 54.21 |
| +15h | 0.1724% | -0.0213% | 49.4% | 2.72 | ✅ | 3.30 | 46.86 |
| +24h | 0.3497% | 0.0000% | 49.8% | 4.32 | ✅ | 3.39 | 39.89 |

**Path Behavior:**
- MFE before MAE: 51% of trades
- Avg MAE: -3.511%
- Avg MFE: 3.340%
- Avg time to MAE: 11.1 bars
- Avg time to MFE: 11.3 bars

**Time Split Stability:** ✅ STABLE
- First half mean: 0.2684% (1721 events)
- Second half mean: 0.4400% (1549 events)
- Ratio: 1.64x

**Regime Breakdown (4h horizon):**

| Regime | Events | Mean Return | +Rate |
|--------|--------|-------------|-------|
| UNKNOWN | 13 | 0.0787% | 61.5% |
| RANGING | 1856 | 0.0137% | 51.3% |
| TRENDING_UP | 306 | 0.1791% | 53.9% |
| LOW_VOL | 593 | -0.0225% | 49.1% |
| TRENDING_DOWN | 359 | 0.1744% | 59.6% |
| VOL_EXPANSION | 145 | 0.5573% | 57.2% |

**Risk Flags:** None (passed all early filters)

### Rejected Hypotheses

- **breakout_20_high**: CLUSTERING: 58.3% clustered (>50%); UNSTABLE: split means -0.000724 vs 0.005304
- **breakout_50_high**: CLUSTERING: 58.1% clustered (>50%); UNSTABLE: split means -0.001454 vs 0.009910
- **breakout_20_low**: CLUSTERING: 54.7% clustered (>50%)
- **range_expansion_3x**: UNSTABLE: split means 0.001122 vs 0.004866
- **strong_continuation_1x**: UNSTABLE: split means 0.000491 vs 0.007858
- **momentum_confluence**: CLUSTERING: 83.7% clustered (>50%); UNSTABLE: split means 0.000611 vs 0.003034
- **vol_compression_expansion**: CLUSTERING: 61.7% clustered (>50%); UNSTABLE: split means -0.003863 vs 0.002578
- **atr_spike_1.5**: CLUSTERING: 92.1% clustered (>50%); UNSTABLE: split means -0.001011 vs 0.006682
- **atr_spike_2.0**: CLUSTERING: 90.9% clustered (>50%); UNSTABLE: split means -0.001124 vs 0.005398
- **abnormal_range_2.5x**: UNSTABLE: split means 0.000280 vs 0.007439
- **vol_squeeze**: CLUSTERING: 91.0% clustered (>50%); UNSTABLE: split means -0.003506 vs -0.001033
- **stop_run_continuation**: UNSTABLE: split means 0.000116 vs 0.004891
- **displacement_candle**: UNSTABLE: split means -0.002429 vs 0.003988
- **imbalance_gap**: too few events: 0
- **poc_shift**: UNSTABLE: split means 0.000546 vs 0.006695

---

## FINAL ASSESSMENT

### Candidates Requiring Adversarial Testing

- **ETH / strong_continuation_1x**: mean=-0.0171%, +rate=49.9%, t=-0.20, ~1713 independent events
- **ETH / stop_run_continuation**: mean=0.0838%, +rate=50.4%, t=1.24, ~2299 independent events
- **ETH / displacement_candle**: mean=0.1852%, +rate=52.0%, t=1.33, ~801 independent events
- **SOL / range_expansion_2x**: mean=0.1308%, +rate=49.3%, t=1.42, ~2740 independent events
- **SOL / stop_run_continuation**: mean=0.2103%, +rate=50.5%, t=2.11, ~2238 independent events
- **SOL / displacement_candle**: mean=0.1000%, +rate=48.2%, t=0.51, ~738 independent events
- **BTC / range_expansion_2x**: mean=0.1466%, +rate=50.9%, t=3.14, ~3045 independent events
- **BTC / range_expansion_3x**: mean=0.1202%, +rate=50.6%, t=1.51, ~1224 independent events
- **BTC / strong_continuation_1x**: mean=0.1600%, +rate=50.7%, t=2.43, ~1698 independent events
- **BTC / abnormal_range_2.5x**: mean=0.1225%, +rate=50.6%, t=1.47, ~1050 independent events
- **BTC / stop_run_continuation**: mean=0.1153%, +rate=51.6%, t=2.30, ~2275 independent events
- **BTC / displacement_candle**: mean=0.1759%, +rate=52.5%, t=1.79, ~842 independent events
- **BTC / poc_shift**: mean=0.0795%, +rate=50.6%, t=1.38, ~1907 independent events
- **XRP / range_expansion_2x**: mean=0.3497%, +rate=49.8%, t=4.32, ~2833 independent events

> These candidates passed early rejection but have NOT been validated.
> Next step: adversarial stress testing (subsample, regime-split, out-of-sample).
