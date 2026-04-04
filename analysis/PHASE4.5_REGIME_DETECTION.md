# 🔍 PHASE 4.5 — REGIME DETECTION VALIDATION
**Generated:** 2026-04-04T02:14:57.955Z
**Objective:** Can TRENDING_UP be detected in real-time?
**Ground truth:** Forward 24h return >= 1%
**Rule:** NO threshold optimization, NO indicator combining

---

## DETECTION QUALITY SUMMARY

| Asset | Detector | Precision | Recall | F1 | Lift | ON% | Stable? |
|-------|----------|-----------|--------|----|------|-----|--------|
| BTC | adx | 29.0% | 23.0% | 0.257 | 1.00 | 23.1% | ❌ |
| BTC | emaStructure | 28.7% | 39.3% | 0.332 | 0.99 | 39.9% | ❌ |
| BTC | priceSlope | 28.2% | 44.2% | 0.344 | 0.97 | 45.6% | ❌ |
| BTC | volDrift | 33.7% | 12.0% | 0.177 | 1.16 | 10.4% | ❌ |
| BTC | multiCondition | 29.0% | 22.1% | 0.251 | 1.00 | 22.1% | ❌ |
| ETH | adx | 32.7% | 21.7% | 0.261 | 0.98 | 22.2% | ❌ |
| ETH | emaStructure | 32.4% | 37.6% | 0.348 | 0.96 | 38.9% | ❌ |
| ETH | priceSlope | 32.8% | 45.7% | 0.382 | 0.98 | 46.8% | ❌ |
| ETH | volDrift | 35.9% | 11.7% | 0.176 | 1.07 | 10.9% | ❌ |
| ETH | multiCondition | 32.7% | 21.4% | 0.259 | 0.98 | 22.0% | ❌ |
| SOL | adx | 38.5% | 22.1% | 0.281 | 1.01 | 21.9% | ✅ |
| SOL | emaStructure | 37.8% | 36.8% | 0.373 | 0.99 | 37.1% | ✅ |
| SOL | priceSlope | 37.3% | 46.5% | 0.414 | 0.98 | 47.4% | ✅ |
| SOL | volDrift | 40.0% | 12.8% | 0.194 | 1.05 | 12.2% | ❌ |
| SOL | multiCondition | 37.5% | 21.4% | 0.273 | 0.98 | 21.8% | ✅ |
| XRP | adx | 31.2% | 18.2% | 0.230 | 0.93 | 19.5% | ❌ |
| XRP | emaStructure | 31.3% | 34.0% | 0.326 | 0.94 | 36.2% | ❌ |
| XRP | priceSlope | 32.5% | 45.1% | 0.378 | 0.97 | 46.3% | ✅ |
| XRP | volDrift | 34.8% | 11.2% | 0.169 | 1.04 | 10.7% | ❌ |
| XRP | multiCondition | 31.5% | 18.7% | 0.234 | 0.94 | 19.8% | ❌ |

---

## BTC

**Ground truth prevalence:** 29.1% of candles are TRENDING_UP (24h fwd >= 1%)

### Detector: adx

**Quality:**
- Precision: 29.0% (when detecting trend, how often correct)
- Recall: 23.0% (how much of real trends captured)
- F1: 0.257
- Lift: 1.00 (>1 = useful)
- Detection rate: 23.1% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 26.6% | 19.9% | 0.227 | 21.7% |
| 2023 | 29.5% | 26.9% | 0.281 | 24.3% |
| 2024 | 31.8% | 25.1% | 0.281 | 26.1% |
| 2025 | 27.3% | 21.3% | 0.239 | 21.6% |
| 2026 | 29.3% | 18.4% | 0.226 | 18.3% |

Consistent: NO (precision range: 5.2%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0334% t=1.97 +rate=48.3% (n=8608)
- Detector OFF: mean=0.0158% t=1.74 +rate=51.5% (n=28608)
- Edge multiplier: 2.1×
- Isolated: NO
- Separated: YES

### Detector: emaStructure

**Quality:**
- Precision: 28.7% (when detecting trend, how often correct)
- Recall: 39.3% (how much of real trends captured)
- F1: 0.332
- Lift: 0.99 (>1 = useful)
- Detection rate: 39.9% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 26.7% | 31.6% | 0.290 | 34.3% |
| 2023 | 28.1% | 43.9% | 0.343 | 41.5% |
| 2024 | 32.5% | 43.9% | 0.374 | 44.7% |
| 2025 | 25.9% | 38.2% | 0.309 | 40.7% |
| 2026 | 32.5% | 36.6% | 0.344 | 32.7% |

Consistent: NO (precision range: 6.6%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0362% t=2.91 +rate=48.3% (n=14828)
- Detector OFF: mean=0.0090% t=0.86 +rate=52.5% (n=22388)
- Edge multiplier: 4.0×
- Isolated: YES
- Separated: YES

### Detector: priceSlope

**Quality:**
- Precision: 28.2% (when detecting trend, how often correct)
- Recall: 44.2% (how much of real trends captured)
- F1: 0.344
- Lift: 0.97 (>1 = useful)
- Detection rate: 45.6% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 28.6% | 42.4% | 0.342 | 42.8% |
| 2023 | 26.2% | 43.4% | 0.326 | 44.1% |
| 2024 | 30.7% | 45.9% | 0.368 | 49.4% |
| 2025 | 26.7% | 44.8% | 0.335 | 46.4% |
| 2026 | 29.7% | 44.7% | 0.357 | 43.8% |

Consistent: NO (precision range: 4.5%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0461% t=3.86 +rate=48.9% (n=16958)
- Detector OFF: mean=-0.0021% t=-0.20 +rate=52.4% (n=20258)
- Edge multiplier: -21.5×
- Isolated: YES
- Separated: YES

### Detector: volDrift

**Quality:**
- Precision: 33.7% (when detecting trend, how often correct)
- Recall: 12.0% (how much of real trends captured)
- F1: 0.177
- Lift: 1.16 (>1 = useful)
- Detection rate: 10.4% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 34.0% | 11.0% | 0.166 | 9.4% |
| 2023 | 31.0% | 11.1% | 0.163 | 9.5% |
| 2024 | 37.9% | 13.3% | 0.197 | 11.6% |
| 2025 | 32.8% | 12.2% | 0.177 | 10.2% |
| 2026 | 28.2% | 13.4% | 0.181 | 13.8% |

Consistent: NO (precision range: 9.8%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.1431% t=4.92 +rate=50.4% (n=3857)
- Detector OFF: mean=0.0056% t=0.68 +rate=50.8% (n=33359)
- Edge multiplier: 25.6×
- Isolated: YES
- Separated: YES

### Detector: multiCondition

**Quality:**
- Precision: 29.0% (when detecting trend, how often correct)
- Recall: 22.1% (how much of real trends captured)
- F1: 0.251
- Lift: 1.00 (>1 = useful)
- Detection rate: 22.1% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 28.4% | 20.0% | 0.235 | 20.3% |
| 2023 | 28.1% | 23.8% | 0.258 | 22.5% |
| 2024 | 30.8% | 23.4% | 0.266 | 25.1% |
| 2025 | 28.0% | 22.1% | 0.247 | 21.8% |
| 2026 | 31.0% | 18.6% | 0.232 | 17.5% |

Consistent: NO (precision range: 3.0%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0523% t=3.03 +rate=47.3% (n=8239)
- Detector OFF: mean=0.0106% t=1.18 +rate=51.8% (n=28977)
- Edge multiplier: 4.9×
- Isolated: YES
- Separated: YES

## ETH

**Ground truth prevalence:** 33.6% of candles are TRENDING_UP (24h fwd >= 1%)

### Detector: adx

**Quality:**
- Precision: 32.7% (when detecting trend, how often correct)
- Recall: 21.7% (how much of real trends captured)
- F1: 0.261
- Lift: 0.98 (>1 = useful)
- Detection rate: 22.2% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 34.5% | 21.9% | 0.268 | 22.5% |
| 2023 | 26.7% | 22.3% | 0.243 | 23.3% |
| 2024 | 37.8% | 24.4% | 0.297 | 23.1% |
| 2025 | 32.6% | 18.7% | 0.238 | 20.4% |
| 2026 | 30.1% | 19.7% | 0.238 | 20.9% |

Consistent: NO (precision range: 11.1%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0443% t=2.08 +rate=48.1% (n=8270)
- Detector OFF: mean=-0.0007% t=-0.06 +rate=51.0% (n=28946)
- Edge multiplier: -61.5×
- Isolated: YES
- Separated: YES

### Detector: emaStructure

**Quality:**
- Precision: 32.4% (when detecting trend, how often correct)
- Recall: 37.6% (how much of real trends captured)
- F1: 0.348
- Lift: 0.96 (>1 = useful)
- Detection rate: 38.9% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 32.3% | 33.2% | 0.327 | 36.3% |
| 2023 | 27.9% | 39.3% | 0.326 | 39.3% |
| 2024 | 36.1% | 42.4% | 0.390 | 42.0% |
| 2025 | 33.2% | 36.1% | 0.346 | 38.7% |
| 2026 | 31.4% | 36.0% | 0.335 | 36.8% |

Consistent: NO (precision range: 8.2%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0463% t=2.87 +rate=47.8% (n=14489)
- Detector OFF: mean=-0.0143% t=-1.00 +rate=52.0% (n=22727)
- Edge multiplier: -3.2×
- Isolated: YES
- Separated: YES

### Detector: priceSlope

**Quality:**
- Precision: 32.8% (when detecting trend, how often correct)
- Recall: 45.7% (how much of real trends captured)
- F1: 0.382
- Lift: 0.98 (>1 = useful)
- Detection rate: 46.8% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 34.8% | 44.8% | 0.392 | 45.5% |
| 2023 | 28.5% | 45.0% | 0.349 | 44.0% |
| 2024 | 34.5% | 47.2% | 0.399 | 48.9% |
| 2025 | 33.9% | 46.8% | 0.393 | 49.0% |
| 2026 | 29.5% | 41.3% | 0.344 | 45.0% |

Consistent: NO (precision range: 6.3%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0555% t=3.59 +rate=48.6% (n=17396)
- Detector OFF: mean=-0.0313% t=-2.09 +rate=51.9% (n=19820)
- Edge multiplier: -1.8×
- Isolated: YES
- Separated: YES

### Detector: volDrift

**Quality:**
- Precision: 35.9% (when detecting trend, how often correct)
- Recall: 11.7% (how much of real trends captured)
- F1: 0.176
- Lift: 1.07 (>1 = useful)
- Detection rate: 10.9% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 38.4% | 10.8% | 0.168 | 9.9% |
| 2023 | 29.0% | 10.5% | 0.154 | 10.1% |
| 2024 | 36.9% | 12.2% | 0.183 | 11.8% |
| 2025 | 41.4% | 13.3% | 0.201 | 11.4% |
| 2026 | 26.6% | 10.4% | 0.150 | 12.5% |

Consistent: NO (precision range: 14.9%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.1818% t=4.98 +rate=50.3% (n=4051)
- Detector OFF: mean=-0.0118% t=-1.05 +rate=50.4% (n=33165)
- Edge multiplier: -15.4×
- Isolated: YES
- Separated: YES

### Detector: multiCondition

**Quality:**
- Precision: 32.7% (when detecting trend, how often correct)
- Recall: 21.4% (how much of real trends captured)
- F1: 0.259
- Lift: 0.98 (>1 = useful)
- Detection rate: 22.0% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 35.4% | 21.7% | 0.269 | 21.7% |
| 2023 | 26.0% | 20.0% | 0.226 | 21.5% |
| 2024 | 35.2% | 22.7% | 0.276 | 23.0% |
| 2025 | 33.8% | 20.6% | 0.256 | 21.6% |
| 2026 | 33.6% | 22.7% | 0.271 | 21.6% |

Consistent: NO (precision range: 9.4%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0651% t=2.98 +rate=47.5% (n=8167)
- Detector OFF: mean=-0.0064% t=-0.52 +rate=51.2% (n=29049)
- Edge multiplier: -10.2×
- Isolated: YES
- Separated: YES

## SOL

**Ground truth prevalence:** 38.1% of candles are TRENDING_UP (24h fwd >= 1%)

### Detector: adx

**Quality:**
- Precision: 38.5% (when detecting trend, how often correct)
- Recall: 22.1% (how much of real trends captured)
- F1: 0.281
- Lift: 1.01 (>1 = useful)
- Detection rate: 21.9% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 32.8% | 17.8% | 0.231 | 19.5% |
| 2023 | 41.7% | 26.1% | 0.321 | 24.9% |
| 2024 | 39.4% | 22.6% | 0.287 | 22.7% |
| 2025 | 40.2% | 22.6% | 0.289 | 21.4% |
| 2026 | 32.0% | 16.8% | 0.220 | 17.9% |

Consistent: YES (precision range: 9.6%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.1658% t=5.04 +rate=49.3% (n=8142)
- Detector OFF: mean=-0.0098% t=-0.56 +rate=49.8% (n=29074)
- Edge multiplier: -16.9×
- Isolated: YES
- Separated: YES

### Detector: emaStructure

**Quality:**
- Precision: 37.8% (when detecting trend, how often correct)
- Recall: 36.8% (how much of real trends captured)
- F1: 0.373
- Lift: 0.99 (>1 = useful)
- Detection rate: 37.1% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 33.4% | 28.3% | 0.307 | 30.5% |
| 2023 | 40.0% | 40.9% | 0.404 | 40.6% |
| 2024 | 39.5% | 41.4% | 0.404 | 41.5% |
| 2025 | 38.5% | 36.9% | 0.377 | 36.5% |
| 2026 | 31.1% | 31.3% | 0.312 | 34.4% |

Consistent: YES (precision range: 8.8%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.1313% t=5.30 +rate=48.1% (n=13809)
- Detector OFF: mean=-0.0320% t=-1.62 +rate=50.6% (n=23407)
- Edge multiplier: -4.1×
- Isolated: YES
- Separated: YES

### Detector: priceSlope

**Quality:**
- Precision: 37.3% (when detecting trend, how often correct)
- Recall: 46.5% (how much of real trends captured)
- F1: 0.414
- Lift: 0.98 (>1 = useful)
- Detection rate: 47.4% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 33.9% | 42.5% | 0.377 | 45.1% |
| 2023 | 39.3% | 48.4% | 0.434 | 48.8% |
| 2024 | 38.5% | 47.3% | 0.424 | 48.7% |
| 2025 | 38.3% | 48.3% | 0.427 | 48.1% |
| 2026 | 33.6% | 43.0% | 0.377 | 43.8% |

Consistent: YES (precision range: 5.7%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0497% t=2.24 +rate=48.6% (n=17656)
- Detector OFF: mean=0.0095% t=0.44 +rate=50.6% (n=19560)
- Edge multiplier: 5.2×
- Isolated: YES
- Separated: YES

### Detector: volDrift

**Quality:**
- Precision: 40.0% (when detecting trend, how often correct)
- Recall: 12.8% (how much of real trends captured)
- F1: 0.194
- Lift: 1.05 (>1 = useful)
- Detection rate: 12.2% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 38.3% | 11.4% | 0.176 | 10.7% |
| 2023 | 41.3% | 14.4% | 0.214 | 13.9% |
| 2024 | 43.9% | 13.6% | 0.207 | 12.2% |
| 2025 | 39.6% | 11.8% | 0.182 | 11.3% |
| 2026 | 28.8% | 12.3% | 0.173 | 14.6% |

Consistent: NO (precision range: 15.1%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.2085% t=4.07 +rate=51.3% (n=4526)
- Detector OFF: mean=0.0037% t=0.23 +rate=49.5% (n=32690)
- Edge multiplier: 56.7×
- Isolated: YES
- Separated: YES

### Detector: multiCondition

**Quality:**
- Precision: 37.5% (when detecting trend, how often correct)
- Recall: 21.4% (how much of real trends captured)
- F1: 0.273
- Lift: 0.98 (>1 = useful)
- Detection rate: 21.8% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 34.0% | 17.8% | 0.234 | 18.9% |
| 2023 | 40.6% | 24.6% | 0.306 | 24.0% |
| 2024 | 36.3% | 20.5% | 0.262 | 22.4% |
| 2025 | 38.8% | 22.5% | 0.285 | 22.1% |
| 2026 | 35.2% | 21.0% | 0.263 | 20.4% |

Consistent: YES (precision range: 6.7%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0972% t=3.01 +rate=48.2% (n=8100)
- Detector OFF: mean=0.0095% t=0.54 +rate=50.1% (n=29116)
- Edge multiplier: 10.2×
- Isolated: YES
- Separated: YES

## XRP

**Ground truth prevalence:** 33.3% of candles are TRENDING_UP (24h fwd >= 1%)

### Detector: adx

**Quality:**
- Precision: 31.2% (when detecting trend, how often correct)
- Recall: 18.2% (how much of real trends captured)
- F1: 0.230
- Lift: 0.93 (>1 = useful)
- Detection rate: 19.5% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 28.3% | 15.6% | 0.201 | 18.3% |
| 2023 | 29.8% | 16.7% | 0.214 | 18.2% |
| 2024 | 33.1% | 21.3% | 0.259 | 21.9% |
| 2025 | 32.2% | 18.4% | 0.235 | 19.9% |
| 2026 | 34.3% | 21.5% | 0.265 | 18.1% |

Consistent: NO (precision range: 6.0%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.1611% t=4.37 +rate=47.4% (n=7255)
- Detector OFF: mean=0.0124% t=0.89 +rate=49.7% (n=29961)
- Edge multiplier: 13.0×
- Isolated: YES
- Separated: YES

### Detector: emaStructure

**Quality:**
- Precision: 31.3% (when detecting trend, how often correct)
- Recall: 34.0% (how much of real trends captured)
- F1: 0.326
- Lift: 0.94 (>1 = useful)
- Detection rate: 36.2% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 27.9% | 28.9% | 0.284 | 34.3% |
| 2023 | 29.5% | 34.4% | 0.318 | 37.9% |
| 2024 | 33.7% | 38.1% | 0.358 | 38.4% |
| 2025 | 34.1% | 35.5% | 0.348 | 36.4% |
| 2026 | 30.0% | 28.8% | 0.294 | 27.6% |

Consistent: NO (precision range: 6.2%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0771% t=3.45 +rate=46.5% (n=13480)
- Detector OFF: mean=0.0211% t=1.27 +rate=50.9% (n=23736)
- Edge multiplier: 3.7×
- Isolated: YES
- Separated: YES

### Detector: priceSlope

**Quality:**
- Precision: 32.5% (when detecting trend, how often correct)
- Recall: 45.1% (how much of real trends captured)
- F1: 0.378
- Lift: 0.97 (>1 = useful)
- Detection rate: 46.3% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 31.1% | 43.0% | 0.361 | 45.8% |
| 2023 | 31.4% | 44.9% | 0.370 | 46.4% |
| 2024 | 32.8% | 45.5% | 0.381 | 47.3% |
| 2025 | 35.1% | 46.9% | 0.402 | 46.6% |
| 2026 | 30.3% | 43.7% | 0.358 | 41.6% |

Consistent: YES (precision range: 4.8%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.0895% t=4.13 +rate=47.1% (n=17211)
- Detector OFF: mean=-0.0001% t=-0.00 +rate=51.1% (n=20005)
- Edge multiplier: -1521.0×
- Isolated: YES
- Separated: YES

### Detector: volDrift

**Quality:**
- Precision: 34.8% (when detecting trend, how often correct)
- Recall: 11.2% (how much of real trends captured)
- F1: 0.169
- Lift: 1.04 (>1 = useful)
- Detection rate: 10.7% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 33.4% | 10.4% | 0.158 | 10.3% |
| 2023 | 28.8% | 8.3% | 0.129 | 9.4% |
| 2024 | 41.4% | 14.0% | 0.209 | 11.5% |
| 2025 | 36.5% | 11.7% | 0.177 | 11.1% |
| 2026 | 27.1% | 12.2% | 0.169 | 13.0% |

Consistent: NO (precision range: 14.2%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.1246% t=2.45 +rate=46.8% (n=3983)
- Detector OFF: mean=0.0314% t=2.31 +rate=49.6% (n=33233)
- Edge multiplier: 4.0×
- Isolated: YES
- Separated: YES

### Detector: multiCondition

**Quality:**
- Precision: 31.5% (when detecting trend, how often correct)
- Recall: 18.7% (how much of real trends captured)
- F1: 0.234
- Lift: 0.94 (>1 = useful)
- Detection rate: 19.8% of time

**Stability across years:**
| Year | Precision | Recall | F1 | Detection% |
|------|-----------|--------|----|-----------|
| 2022 | 26.9% | 15.3% | 0.195 | 18.9% |
| 2023 | 28.5% | 17.2% | 0.215 | 19.6% |
| 2024 | 32.3% | 20.4% | 0.250 | 21.4% |
| 2025 | 36.9% | 20.9% | 0.267 | 19.7% |
| 2026 | 35.7% | 21.5% | 0.269 | 17.4% |

Consistent: NO (precision range: 10.1%)

**Edge isolation (8h hold):**
- Detector ON: mean=0.1831% t=4.69 +rate=46.4% (n=7350)
- Detector OFF: mean=0.0065% t=0.48 +rate=49.9% (n=29866)
- Edge multiplier: 28.2×
- Isolated: YES
- Separated: YES

## FINAL DECISION

### 🔴 CASE B — NO ROBUST DETECTOR


### 🟡 FRAGILE DETECTORS

- **BTC / volDrift** — precision=33.7%, lift=1.16
- **ETH / volDrift** — precision=35.9%, lift=1.07
- **SOL / adx** — precision=38.5%, lift=1.01
- **SOL / volDrift** — precision=40.0%, lift=1.05
- **XRP / volDrift** — precision=34.8%, lift=1.04

### 🔴 FAILED DETECTORS

- **BTC / adx** — precision=29.0%, lift=1.00
- **BTC / emaStructure** — precision=28.7%, lift=0.99
- **BTC / priceSlope** — precision=28.2%, lift=0.97
- **BTC / multiCondition** — precision=29.0%, lift=1.00
- **ETH / adx** — precision=32.7%, lift=0.98
- **ETH / emaStructure** — precision=32.4%, lift=0.96
- **ETH / priceSlope** — precision=32.8%, lift=0.98
- **ETH / multiCondition** — precision=32.7%, lift=0.98
- **SOL / emaStructure** — precision=37.8%, lift=0.99
- **SOL / priceSlope** — precision=37.3%, lift=0.98
- **SOL / multiCondition** — precision=37.5%, lift=0.98
- **XRP / adx** — precision=31.2%, lift=0.93
- **XRP / emaStructure** — precision=31.3%, lift=0.94
- **XRP / priceSlope** — precision=32.5%, lift=0.97
- **XRP / multiCondition** — precision=31.5%, lift=0.94
