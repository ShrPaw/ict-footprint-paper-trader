# 💰 PHASE 5 — INFORMATION EDGE DISCOVERY (FUNDING RATES)
**Generated:** 2026-04-04T02:23:51.131Z
**Data:** Binance perpetual futures funding rates (8h intervals)
**Period:** 2022-01-01 → 2026-03-31
**Method:** Event-based forward return analysis — NO trade simulation

---

## BTC

### Funding Rate Distribution
- Mean: 0.0063% per 8h (≈6.9% annualized)
- Median: 0.0064%
- % Positive: 85.2%
- Extreme high (p95): 0.0134%
- Extreme low (p5): -0.0039%
- Total rates: 4653

### H1 — Extreme Funding → Mean Reversion

| Threshold | Events | Mean Rate | 8h Return | 24h Return | 48h Return | Direction |
|-----------|--------|-----------|-----------|------------|------------|----------|
| p95 (HIGH) | 233 | 0.0305% | -0.0060% (t=-0.05) | 0.2957% (t=1.49) | 0.6502% (t=2.32) | HIGH |
| p90 (HIGH) | 1696 | 0.0129% | -0.0373% (t=-0.99) | -0.0564% (t=-0.88) | -0.0157% (t=-0.17) | HIGH |
| p5 (LOW) | 234 | -0.0087% | 0.2123% (t=1.56) | 0.4708% (t=2.05) | 0.7205% (t=2.70) | LOW |
| p10 (LOW) | 466 | -0.0057% | 0.2394% (t=2.78) | 0.4027% (t=2.80) | 0.5778% (t=3.07) | LOW |

Baseline (all funding events): 8h=0.0195% 24h=0.0593% 48h=0.1236%

### H2 — Funding Regime Transitions

**negToPos** (368 events):
- 8h: mean=-0.0231% t=-0.30 +rate=46.7% (n=368)
- 24h: mean=0.1474% t=1.09 +rate=53.3% (n=368)
- 48h: mean=0.2260% t=1.16 +rate=51.1% (n=368)

**posToNeg** (369 events):
- 8h: mean=0.0542% t=0.69 +rate=49.1% (n=369)
- 24h: mean=0.2224% t=1.48 +rate=49.5% (n=368)
- 48h: mean=0.3743% t=1.79 +rate=52.4% (n=368)

### H3 — Cumulative Funding Drain (10 periods)

| Hold | High Cum (p90) Mean | t-stat | Low Cum (p10) Mean | t-stat | Baseline |
|------|-------------------|--------|-------------------|--------|----------|
| 8h | 0.0471% | 0.96 | 0.0810% | 1.00 | 0.0195% |
| 24h | 0.1491% | 1.76 | 0.2542% | 1.96 | 0.0593% |
| 48h | 0.3406% | 2.87 | 0.4863% | 2.75 | 0.1236% |

### H4 — Funding vs Price Divergence

**posFundNegPrice** (1 events):
- 8h: mean=0.0000% t=0.00 +rate=0.0% (n=1)
- 24h: mean=0.0000% t=0.00 +rate=0.0% (n=1)
- 48h: mean=0.0000% t=0.00 +rate=0.0% (n=1)

**negFundPosPrice** (0 events):
- No events found

### H5 — Funding Streaks

| Streak | Events | 8h Return | t-stat | 24h Return | t-stat | 48h Return | t-stat |
|--------|--------|-----------|--------|------------|--------|------------|--------|
| neg3 | 104 | 0.2899% | 1.37 | 0.5742% | 1.80 | 0.9195% | 2.57 |
| neg5 | 79 | 0.3080% | 1.59 | 0.5473% | 1.84 | 0.4864% | 1.56 |
| pos3 | 393 | 0.0461% | 0.60 | 0.0148% | 0.12 | 0.1301% | 0.73 |
| pos5 | 2933 | -0.0161% | -0.59 | -0.0338% | -0.70 | 0.0001% | 0.00 |

---

## ETH

### Funding Rate Distribution
- Mean: 0.0058% per 8h (≈6.3% annualized)
- Median: 0.0064%
- % Positive: 82.5%
- Extreme high (p95): 0.0163%
- Extreme low (p5): -0.0068%
- Total rates: 4653

### H1 — Extreme Funding → Mean Reversion

| Threshold | Events | Mean Rate | 8h Return | 24h Return | 48h Return | Direction |
|-----------|--------|-----------|-----------|------------|------------|----------|
| p95 (HIGH) | 233 | 0.0330% | -0.0069% (t=-0.06) | -0.0297% (t=-0.14) | 0.1354% (t=0.48) | HIGH |
| p90 (HIGH) | 1663 | 0.0134% | 0.0170% (t=0.37) | -0.0238% (t=-0.29) | -0.0145% (t=-0.12) | HIGH |
| p5 (LOW) | 233 | -0.0181% | 0.1659% (t=0.87) | 0.4016% (t=1.20) | 0.5702% (t=1.29) | LOW |
| p10 (LOW) | 466 | -0.0112% | 0.1295% (t=1.02) | 0.3399% (t=1.54) | 0.6134% (t=2.05) | LOW |

Baseline (all funding events): 8h=0.0091% 24h=0.0233% 48h=0.0638%

### H2 — Funding Regime Transitions

**negToPos** (406 events):
- 8h: mean=0.0343% t=0.31 +rate=52.5% (n=406)
- 24h: mean=0.0960% t=0.49 +rate=49.5% (n=406)
- 48h: mean=0.0861% t=0.32 +rate=50.9% (n=405)

**posToNeg** (407 events):
- 8h: mean=-0.0783% t=-0.80 +rate=49.5% (n=406)
- 24h: mean=0.0341% t=0.18 +rate=53.7% (n=406)
- 48h: mean=0.1867% t=0.68 +rate=52.2% (n=406)

### H3 — Cumulative Funding Drain (10 periods)

| Hold | High Cum (p90) Mean | t-stat | Low Cum (p10) Mean | t-stat | Baseline |
|------|-------------------|--------|-------------------|--------|----------|
| 8h | 0.0955% | 1.12 | 0.1314% | 0.98 | 0.0091% |
| 24h | 0.2705% | 1.85 | 0.1234% | 0.58 | 0.0233% |
| 48h | 0.5471% | 2.76 | 0.3171% | 1.12 | 0.0638% |

### H4 — Funding vs Price Divergence

**posFundNegPrice** (2 events):
- 8h: mean=0.0000% t=0.00 +rate=0.0% (n=2)
- 24h: mean=0.0000% t=0.00 +rate=0.0% (n=2)
- 48h: mean=0.0000% t=0.00 +rate=0.0% (n=2)

**negFundPosPrice** (1 events):
- 8h: mean=0.0000% t=0.00 +rate=0.0% (n=1)
- 24h: mean=0.0000% t=0.00 +rate=0.0% (n=1)
- 48h: mean=0.0000% t=0.00 +rate=0.0% (n=1)

### H5 — Funding Streaks

| Streak | Events | 8h Return | t-stat | 24h Return | t-stat | 48h Return | t-stat |
|--------|--------|-----------|--------|------------|--------|------------|--------|
| neg3 | 140 | 0.5255% | 2.20 | 0.9883% | 2.61 | 1.2721% | 2.46 |
| neg5 | 103 | 0.0038% | 0.01 | -0.0294% | -0.06 | 0.2131% | 0.29 |
| pos3 | 385 | -0.0454% | -0.47 | -0.1726% | -1.01 | -0.1720% | -0.65 |
| pos5 | 2767 | -0.0195% | -0.55 | -0.0552% | -0.87 | -0.0512% | -0.57 |

---

## SOL

### Funding Rate Distribution
- Mean: -0.0051% per 8h (≈-5.6% annualized)
- Median: 0.0052%
- % Positive: 67.2%
- Extreme high (p95): 0.0200%
- Extreme low (p5): -0.0273%
- Total rates: 4728

### H1 — Extreme Funding → Mean Reversion

| Threshold | Events | Mean Rate | 8h Return | 24h Return | 48h Return | Direction |
|-----------|--------|-----------|-----------|------------|------------|----------|
| p95 (HIGH) | 237 | 0.0405% | 0.1024% (t=0.52) | 0.3043% (t=0.89) | 0.9702% (t=1.88) | HIGH |
| p90 (HIGH) | 1800 | 0.0143% | 0.0294% (t=0.44) | 0.1006% (t=0.88) | 0.1614% (t=0.95) | HIGH |
| p5 (LOW) | 237 | -0.1941% | 0.5298% (t=1.13) | 0.1978% (t=0.25) | 0.1567% (t=0.18) | LOW |
| p10 (LOW) | 473 | -0.1067% | 0.2134% (t=0.82) | -0.0212% (t=-0.05) | 0.2019% (t=0.40) | LOW |

Baseline (all funding events): 8h=0.0470% 24h=0.0859% 48h=0.1236%

### H2 — Funding Regime Transitions

**negToPos** (507 events):
- 8h: mean=0.1154% t=0.82 +rate=49.1% (n=507)
- 24h: mean=0.0229% t=0.10 +rate=49.4% (n=506)
- 48h: mean=0.1273% t=0.43 +rate=49.6% (n=506)

**posToNeg** (508 events):
- 8h: mean=0.2201% t=1.62 +rate=52.1% (n=507)
- 24h: mean=0.2508% t=1.07 +rate=51.3% (n=507)
- 48h: mean=0.2802% t=0.81 +rate=49.5% (n=507)

### H3 — Cumulative Funding Drain (10 periods)

| Hold | High Cum (p90) Mean | t-stat | Low Cum (p10) Mean | t-stat | Baseline |
|------|-------------------|--------|-------------------|--------|----------|
| 8h | 0.2099% | 1.43 | 0.1981% | 0.76 | 0.0470% |
| 24h | 0.4841% | 1.90 | 0.4476% | 1.05 | 0.0859% |
| 48h | 0.9291% | 2.53 | 0.6476% | 1.42 | 0.1236% |

### H4 — Funding vs Price Divergence

**posFundNegPrice** (7 events):
- 8h: mean=0.4559% t=0.35 +rate=57.1% (n=7)
- 24h: mean=0.5951% t=0.34 +rate=71.4% (n=7)
- 48h: mean=0.5735% t=0.51 +rate=42.9% (n=7)

**negFundPosPrice** (40 events):
- 8h: mean=-0.4673% t=-0.63 +rate=40.0% (n=40)
- 24h: mean=-1.3350% t=-1.14 +rate=32.5% (n=40)
- 48h: mean=-3.4419% t=-2.05 +rate=37.5% (n=40)

### H5 — Funding Streaks

| Streak | Events | 8h Return | t-stat | 24h Return | t-stat | 48h Return | t-stat |
|--------|--------|-----------|--------|------------|--------|------------|--------|
| neg3 | 271 | -0.1885% | -0.85 | -0.6975% | -1.76 | -0.7263% | -1.63 |
| neg5 | 507 | 0.0708% | 0.33 | 0.3568% | 0.99 | 0.5206% | 1.26 |
| pos3 | 390 | 0.0928% | 0.72 | 0.4265% | 2.04 | 0.5621% | 1.76 |
| pos5 | 1943 | 0.0340% | 0.56 | 0.0890% | 0.82 | 0.0969% | 0.60 |

---

## XRP

### Funding Rate Distribution
- Mean: 0.0054% per 8h (≈5.9% annualized)
- Median: 0.0083%
- % Positive: 74.7%
- Extreme high (p95): 0.0191%
- Extreme low (p5): -0.0134%
- Total rates: 4653

### H1 — Extreme Funding → Mean Reversion

| Threshold | Events | Mean Rate | 8h Return | 24h Return | 48h Return | Direction |
|-----------|--------|-----------|-----------|------------|------------|----------|
| p95 (HIGH) | 233 | 0.0400% | 0.1330% (t=0.72) | 0.4537% (t=1.40) | 0.9211% (t=1.93) | HIGH |
| p90 (HIGH) | 2102 | 0.0135% | -0.0016% (t=-0.03) | 0.0860% (t=0.93) | 0.2942% (t=2.09) | HIGH |
| p5 (LOW) | 233 | -0.0231% | 0.1073% (t=0.59) | 0.5788% (t=1.86) | 1.0719% (t=2.88) | LOW |
| p10 (LOW) | 466 | -0.0166% | 0.1255% (t=1.02) | 0.7613% (t=3.01) | 1.0403% (t=3.56) | LOW |

Baseline (all funding events): 8h=0.0414% 24h=0.1180% 48h=0.2397%

### H2 — Funding Regime Transitions

**negToPos** (528 events):
- 8h: mean=0.1079% t=0.93 +rate=52.1% (n=528)
- 24h: mean=-0.0165% t=-0.07 +rate=47.2% (n=528)
- 48h: mean=-0.0229% t=-0.09 +rate=43.8% (n=527)

**posToNeg** (529 events):
- 8h: mean=0.0008% t=0.01 +rate=47.1% (n=529)
- 24h: mean=0.2328% t=1.04 +rate=50.8% (n=528)
- 48h: mean=0.2343% t=0.93 +rate=49.6% (n=528)

### H3 — Cumulative Funding Drain (10 periods)

| Hold | High Cum (p90) Mean | t-stat | Low Cum (p10) Mean | t-stat | Baseline |
|------|-------------------|--------|-------------------|--------|----------|
| 8h | 0.2412% | 1.59 | 0.1434% | 1.09 | 0.0414% |
| 24h | 0.8013% | 2.84 | 0.3502% | 1.78 | 0.1180% |
| 48h | 1.8120% | 4.17 | 0.7011% | 2.79 | 0.2397% |

### H4 — Funding vs Price Divergence

**posFundNegPrice** (5 events):
- 8h: mean=-0.1116% t=-0.07 +rate=40.0% (n=5)
- 24h: mean=-1.5957% t=-0.55 +rate=40.0% (n=5)
- 48h: mean=0.6517% t=0.32 +rate=40.0% (n=5)

**negFundPosPrice** (2 events):
- 8h: mean=0.0000% t=0.00 +rate=0.0% (n=2)
- 24h: mean=0.0000% t=0.00 +rate=0.0% (n=2)
- 48h: mean=0.0000% t=0.00 +rate=0.0% (n=2)

### H5 — Funding Streaks

| Streak | Events | 8h Return | t-stat | 24h Return | t-stat | 48h Return | t-stat |
|--------|--------|-----------|--------|------------|--------|------------|--------|
| neg3 | 189 | 0.1130% | 0.62 | 0.8873% | 2.98 | 1.0465% | 2.38 |
| neg5 | 231 | 0.2958% | 1.47 | 0.5000% | 1.53 | 0.4767% | 1.14 |
| pos3 | 431 | -0.1087% | -1.15 | -0.2175% | -1.30 | 0.1537% | 0.47 |
| pos5 | 2140 | 0.0529% | 1.04 | 0.1541% | 1.66 | 0.3062% | 2.24 |

---

## SIGNIFICANT FINDINGS SUMMARY

- **BTC H1 p95 extreme_high 48h**: mean=0.6502% t=2.32 n=233
- **BTC H1 p95 extreme_high 72h**: mean=1.0043% t=2.97 n=233
- **BTC H1 p5 extreme_low 24h**: mean=0.4708% t=2.05 n=234
- **BTC H1 p5 extreme_low 48h**: mean=0.7205% t=2.70 n=234
- **BTC H1 p10 extreme_low 8h**: mean=0.2394% t=2.78 n=465
- **BTC H1 p10 extreme_low 24h**: mean=0.4027% t=2.80 n=464
- **BTC H1 p10 extreme_low 48h**: mean=0.5778% t=3.07 n=464
- **BTC H1 p10 extreme_low 72h**: mean=0.6760% t=2.95 n=463
- **BTC H3 highCum 48h**: mean=0.3406% t=2.87
- **BTC H3 lowCum 48h**: mean=0.4863% t=2.75
- **BTC H5 neg3 48h**: mean=0.9195% t=2.57 n=104
- **ETH H1 p10 extreme_low 48h**: mean=0.6134% t=2.05 n=466
- **ETH H3 highCum 48h**: mean=0.5471% t=2.76
- **ETH H5 neg3 8h**: mean=0.5255% t=2.20 n=140
- **ETH H5 neg3 24h**: mean=0.9883% t=2.61 n=140
- **ETH H5 neg3 48h**: mean=1.2721% t=2.46 n=139
- **SOL H1 p95 extreme_high 72h**: mean=1.2876% t=2.09 n=237
- **SOL H3 highCum 48h**: mean=0.9291% t=2.53
- **SOL H5 pos3 24h**: mean=0.4265% t=2.04 n=390
- **XRP H1 p95 extreme_high 72h**: mean=1.5180% t=2.15 n=233
- **XRP H1 p90 extreme_high 48h**: mean=0.2942% t=2.09 n=2102
- **XRP H1 p90 extreme_high 72h**: mean=0.5138% t=2.82 n=2102
- **XRP H1 p5 extreme_low 48h**: mean=1.0719% t=2.88 n=232
- **XRP H1 p5 extreme_low 72h**: mean=1.1850% t=2.91 n=232
- **XRP H1 p10 extreme_low 24h**: mean=0.7613% t=3.01 n=464
- **XRP H1 p10 extreme_low 48h**: mean=1.0403% t=3.56 n=463
- **XRP H1 p10 extreme_low 72h**: mean=1.0382% t=3.37 n=462
- **XRP H3 highCum 24h**: mean=0.8013% t=2.84
- **XRP H3 highCum 48h**: mean=1.8120% t=4.17
- **XRP H3 lowCum 48h**: mean=0.7011% t=2.79
- **XRP H5 neg3 24h**: mean=0.8873% t=2.98 n=188
- **XRP H5 neg3 48h**: mean=1.0465% t=2.38 n=188
- **XRP H5 pos5 48h**: mean=0.3062% t=2.24 n=2140

Total significant findings: 33
