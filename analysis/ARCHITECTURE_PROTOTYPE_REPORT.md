# 🏗️ ARCHITECTURE PROTOTYPING — PRE-IMPLEMENTATION VALIDATION
**Generated:** 2026-04-04T03:01:52.686Z
**Data:** Binance perpetual futures, 2022-01-01 → 2026-03-31
**Method:** Grid test of simple exit architectures on funding rate signals
**Fee model:** 0.14% round-trip (taker)
**Rules:** NO optimization, NO trailing stops, NO OHLCV signals

---

## BTC

### Architecture Comparison

| Config | n | Expectancy (bps) | t-stat | %Win | PF | Max DD | Max Consec | MAE p99% | Survival |
|--------|---|------------------|--------|------|----|----|------------|----------|----------|
| TIME_48h | 1594 | 31.5 | 3.29 | 51.9% | 1.26 | 195.14 | 18 | 12.7% | 🟢 95 |
| TIME_48h+STOP_15% | 1594 | 28.9 | 2.96 | 51.9% | 1.24 | 206.35 | 18 | 12.7% | 🟢 95 |
| TIME_48h+STOP_20% | 1594 | 31.5 | 3.29 | 51.9% | 1.26 | 195.14 | 18 | 12.7% | 🟢 95 |
| TIME_72h | 1594 | 51.9 | 4.43 | 51.8% | 1.37 | 281.66 | 17 | 15.4% | 🟢 90 |
| TIME_72h+STOP_10% | 1594 | 31.9 | 2.57 | 51.6% | 1.20 | 349.87 | 17 | 12.0% | 🟢 90 |
| TIME_72h+STOP_15% | 1594 | 45.9 | 3.80 | 51.8% | 1.31 | 309.81 | 17 | 15.2% | 🟢 90 |
| TIME_72h+STOP_20% | 1594 | 51.7 | 4.41 | 51.8% | 1.36 | 281.66 | 17 | 15.4% | 🟢 90 |
| STOP_10%_ONLY | 1594 | 31.9 | 2.57 | 51.6% | 1.20 | 349.87 | 17 | 12.0% | 🟢 90 |
| STOP_15%_ONLY | 1594 | 45.9 | 3.80 | 51.8% | 1.31 | 309.81 | 17 | 15.2% | 🟢 90 |
| STOP_20%_ONLY | 1594 | 51.7 | 4.41 | 51.8% | 1.36 | 281.66 | 17 | 15.4% | 🟢 90 |
| TIME_48h+STOP_10% | 1594 | 15.5 | 1.51 | 51.8% | 1.11 | 257.58 | 18 | 11.7% | 🟢 80 |
| TIME_24h | 1594 | 10.4 | 1.49 | 47.1% | 1.11 | 136.09 | 14 | 11.1% | 🟢 75 |

### Edge Integrity Check

**Baseline (TIME_48h):**
- Expectancy: 31.5 bps (0.3149%)
- t-stat: 3.29
- Edge survives: ✅ YES
- Economically viable: ✅ YES (PF=1.26)

### Risk Viability

**TIME_24h:**
- Worst MAE p99%: 11.1%
- Position size (1% risk): 8.97% of capital
- Total return (sized): 14.92%
- Max DD (sized): 10.39%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h:**
- Worst MAE p99%: 12.7%
- Position size (1% risk): 7.87% of capital
- Total return (sized): 39.52%
- Max DD (sized): 11.18%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h:**
- Worst MAE p99%: 15.4%
- Position size (1% risk): 6.50% of capital
- Total return (sized): 53.72%
- Max DD (sized): 12.24%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_10%:**
- Worst MAE p99%: 11.7%
- Position size (1% risk): 8.53% of capital
- Total return (sized): 21.03%
- Max DD (sized): 17.52%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_15%:**
- Worst MAE p99%: 12.7%
- Position size (1% risk): 7.87% of capital
- Total return (sized): 36.30%
- Max DD (sized): 12.03%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_20%:**
- Worst MAE p99%: 12.7%
- Position size (1% risk): 7.87% of capital
- Total return (sized): 39.52%
- Max DD (sized): 11.18%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_10%:**
- Worst MAE p99%: 12.0%
- Position size (1% risk): 8.35% of capital
- Total return (sized): 42.46%
- Max DD (sized): 20.27%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_15%:**
- Worst MAE p99%: 15.2%
- Position size (1% risk): 6.59% of capital
- Total return (sized): 48.21%
- Max DD (sized): 14.00%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_20%:**
- Worst MAE p99%: 15.4%
- Position size (1% risk): 6.50% of capital
- Total return (sized): 53.53%
- Max DD (sized): 12.25%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_10%_ONLY:**
- Worst MAE p99%: 12.0%
- Position size (1% risk): 8.35% of capital
- Total return (sized): 42.46%
- Max DD (sized): 20.27%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_15%_ONLY:**
- Worst MAE p99%: 15.2%
- Position size (1% risk): 6.59% of capital
- Total return (sized): 48.21%
- Max DD (sized): 14.00%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_20%_ONLY:**
- Worst MAE p99%: 15.4%
- Position size (1% risk): 6.50% of capital
- Total return (sized): 53.53%
- Max DD (sized): 12.25%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

### Failure Mode Analysis (TIME_48h)

- Loss clusters (≥3 consecutive): 106
- Largest cluster: 18 consecutive losses
- Catastrophic losses (>3%): 232
- Catastrophic reasons: {"time_exit":232}
- MAE distribution: p50=2.3% p90=6.9% p95=9.5% p99=12.7% max=16.6%

| Signal | n | Mean | Worst | % Negative |
|--------|---|------|-------|------------|
| btc_extremeLow_p10 | 464 | 0.4378% | -16.35% | 46.3% |
| btc_extremeHigh_p95 | 233 | 0.5102% | -9.46% | 48.5% |
| btc_highCumDrain | 897 | 0.2006% | -11.11% | 48.8% |

### Year Stability (TIME_48h)

| Year | Mean (bps) | t-stat | n | %Win |
|------|------------|--------|---|------|
| 2022 | -43.3 | -1.40 | 219 | 44.3% |
| 2023 | 34.7 | 2.18 | 429 | 52.7% |
| 2024 | 57.8 | 3.93 | 744 | 54.4% |
| 2025 | -13.9 | -0.58 | 132 | 44.7% |
| 2026 | 51.9 | 1.20 | 70 | 58.6% |

Years positive: 3/5

---

## ETH

### Architecture Comparison

| Config | n | Expectancy (bps) | t-stat | %Win | PF | Max DD | Max Consec | MAE p99% | Survival |
|--------|---|------------------|--------|------|----|----|------------|----------|----------|
| TIME_48h | 932 | 44.0 | 2.45 | 52.7% | 1.25 | 228.45 | 22 | 20.6% | 🟢 90 |
| TIME_72h | 932 | 57.6 | 2.72 | 55.3% | 1.27 | 310.85 | 25 | 26.2% | 🟢 90 |
| TIME_48h+STOP_20% | 932 | 42.8 | 2.37 | 52.7% | 1.24 | 227.53 | 22 | 20.5% | 🟢 90 |
| TIME_72h+STOP_20% | 932 | 51.8 | 2.42 | 55.3% | 1.24 | 322.77 | 25 | 20.9% | 🟢 90 |
| STOP_20%_ONLY | 932 | 51.8 | 2.42 | 55.3% | 1.24 | 322.77 | 25 | 20.9% | 🟢 90 |
| TIME_48h+STOP_10% | 932 | 18.9 | 1.05 | 51.6% | 1.10 | 242.44 | 23 | 13.6% | 🟢 80 |
| TIME_72h+STOP_10% | 932 | 23.6 | 1.13 | 53.4% | 1.10 | 350.84 | 25 | 13.6% | 🟢 80 |
| STOP_10%_ONLY | 932 | 23.6 | 1.13 | 53.4% | 1.10 | 350.84 | 25 | 13.6% | 🟢 80 |
| TIME_24h | 932 | 16.5 | 1.25 | 51.1% | 1.12 | 145.32 | 12 | 16.5% | 🟢 75 |
| TIME_48h+STOP_15% | 932 | 33.7 | 1.84 | 52.6% | 1.18 | 261.38 | 22 | 16.7% | 🟢 75 |
| TIME_72h+STOP_15% | 932 | 42.4 | 1.99 | 54.7% | 1.19 | 326.74 | 25 | 17.1% | 🟢 75 |
| STOP_15%_ONLY | 932 | 42.4 | 1.99 | 54.7% | 1.19 | 326.74 | 25 | 17.1% | 🟢 75 |

### Edge Integrity Check

**Baseline (TIME_48h):**
- Expectancy: 44.0 bps (0.4402%)
- t-stat: 2.45
- Edge survives: ✅ YES
- Economically viable: ✅ YES (PF=1.25)

### Risk Viability

**TIME_24h:**
- Worst MAE p99%: 16.5%
- Position size (1% risk): 6.06% of capital
- Total return (sized): 9.33%
- Max DD (sized): 8.34%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h:**
- Worst MAE p99%: 20.6%
- Position size (1% risk): 4.85% of capital
- Total return (sized): 19.89%
- Max DD (sized): 9.82%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h:**
- Worst MAE p99%: 26.2%
- Position size (1% risk): 3.82% of capital
- Total return (sized): 20.49%
- Max DD (sized): 10.20%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_10%:**
- Worst MAE p99%: 13.6%
- Position size (1% risk): 7.36% of capital
- Total return (sized): 12.98%
- Max DD (sized): 16.50%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_15%:**
- Worst MAE p99%: 16.7%
- Position size (1% risk): 6.00% of capital
- Total return (sized): 18.84%
- Max DD (sized): 13.84%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_20%:**
- Worst MAE p99%: 20.5%
- Position size (1% risk): 4.89% of capital
- Total return (sized): 19.49%
- Max DD (sized): 9.94%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_10%:**
- Worst MAE p99%: 13.6%
- Position size (1% risk): 7.36% of capital
- Total return (sized): 16.22%
- Max DD (sized): 22.58%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_15%:**
- Worst MAE p99%: 17.1%
- Position size (1% risk): 5.85% of capital
- Total return (sized): 23.12%
- Max DD (sized): 15.96%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_20%:**
- Worst MAE p99%: 20.9%
- Position size (1% risk): 4.79% of capital
- Total return (sized): 23.16%
- Max DD (sized): 13.43%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_10%_ONLY:**
- Worst MAE p99%: 13.6%
- Position size (1% risk): 7.36% of capital
- Total return (sized): 16.22%
- Max DD (sized): 22.58%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_15%_ONLY:**
- Worst MAE p99%: 17.1%
- Position size (1% risk): 5.85% of capital
- Total return (sized): 23.12%
- Max DD (sized): 15.96%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_20%_ONLY:**
- Worst MAE p99%: 20.9%
- Position size (1% risk): 4.79% of capital
- Total return (sized): 23.16%
- Max DD (sized): 13.43%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

### Failure Mode Analysis (TIME_48h)

- Loss clusters (≥3 consecutive): 58
- Largest cluster: 22 consecutive losses
- Catastrophic losses (>3%): 192
- Catastrophic reasons: {"time_exit":192}
- MAE distribution: p50=3.2% p90=10.0% p95=12.9% p99=20.6% max=31.4%

| Signal | n | Mean | Worst | % Negative |
|--------|---|------|-------|------------|
| eth_highCumDrain | 466 | 0.4071% | -16.01% | 47.2% |
| eth_extremeLow_p10 | 466 | 0.4734% | -27.33% | 47.4% |

### Year Stability (TIME_48h)

| Year | Mean (bps) | t-stat | n | %Win |
|------|------------|--------|---|------|
| 2022 | 15.3 | 0.35 | 281 | 50.5% |
| 2023 | 56.1 | 1.98 | 159 | 50.3% |
| 2024 | 46.7 | 1.97 | 359 | 55.2% |
| 2025 | 97.1 | 1.35 | 55 | 52.7% |
| 2026 | 73.2 | 1.22 | 78 | 53.8% |

Years positive: 5/5

---

## XRP

### Architecture Comparison

| Config | n | Expectancy (bps) | t-stat | %Win | PF | Max DD | Max Consec | MAE p99% | Survival |
|--------|---|------------------|--------|------|----|----|------------|----------|----------|
| TIME_48h | 931 | 128.6 | 4.91 | 50.8% | 1.73 | 253.41 | 16 | 24.0% | 🟢 95 |
| TIME_72h | 931 | 168.3 | 5.23 | 53.2% | 1.80 | 365.28 | 19 | 25.8% | 🟢 95 |
| TIME_48h+STOP_20% | 931 | 102.4 | 3.70 | 50.8% | 1.50 | 395.92 | 16 | 23.0% | 🟢 95 |
| TIME_72h+STOP_20% | 931 | 136.5 | 4.05 | 53.1% | 1.56 | 527.84 | 19 | 23.0% | 🟢 95 |
| STOP_20%_ONLY | 931 | 136.5 | 4.05 | 53.1% | 1.56 | 527.84 | 19 | 23.0% | 🟢 95 |
| TIME_24h | 931 | 64.2 | 3.39 | 53.9% | 1.46 | 154.78 | 12 | 20.1% | 🟢 90 |
| TIME_48h+STOP_15% | 931 | 91.6 | 3.32 | 50.5% | 1.43 | 377.69 | 16 | 22.2% | 🟢 90 |
| TIME_72h+STOP_15% | 931 | 119.5 | 3.54 | 52.4% | 1.46 | 539.36 | 19 | 22.6% | 🟢 90 |
| STOP_15%_ONLY | 931 | 119.5 | 3.54 | 52.4% | 1.46 | 539.36 | 19 | 22.6% | 🟢 90 |
| TIME_48h+STOP_10% | 931 | 82.4 | 3.04 | 49.5% | 1.38 | 444.82 | 21 | 20.8% | 🟢 85 |
| TIME_72h+STOP_10% | 931 | 103.1 | 3.11 | 50.8% | 1.38 | 605.43 | 19 | 21.9% | 🟢 85 |
| STOP_10%_ONLY | 931 | 103.1 | 3.11 | 50.8% | 1.38 | 605.43 | 19 | 21.9% | 🟢 85 |

### Edge Integrity Check

**Baseline (TIME_48h):**
- Expectancy: 128.6 bps (1.2864%)
- t-stat: 4.91
- Edge survives: ✅ YES
- Economically viable: ✅ YES (PF=1.73)

### Risk Viability

**TIME_24h:**
- Worst MAE p99%: 20.1%
- Position size (1% risk): 4.97% of capital
- Total return (sized): 29.67%
- Max DD (sized): 7.54%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h:**
- Worst MAE p99%: 24.0%
- Position size (1% risk): 4.17% of capital
- Total return (sized): 49.97%
- Max DD (sized): 10.19%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h:**
- Worst MAE p99%: 25.8%
- Position size (1% risk): 3.87% of capital
- Total return (sized): 60.65%
- Max DD (sized): 13.45%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_10%:**
- Worst MAE p99%: 20.8%
- Position size (1% risk): 4.82% of capital
- Total return (sized): 36.93%
- Max DD (sized): 20.54%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_15%:**
- Worst MAE p99%: 22.2%
- Position size (1% risk): 4.51% of capital
- Total return (sized): 38.46%
- Max DD (sized): 16.38%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_48h+STOP_20%:**
- Worst MAE p99%: 23.0%
- Position size (1% risk): 4.36% of capital
- Total return (sized): 41.55%
- Max DD (sized): 16.61%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_10%:**
- Worst MAE p99%: 21.9%
- Position size (1% risk): 4.56% of capital
- Total return (sized): 43.73%
- Max DD (sized): 26.23%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_15%:**
- Worst MAE p99%: 22.6%
- Position size (1% risk): 4.43% of capital
- Total return (sized): 49.27%
- Max DD (sized): 22.75%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**TIME_72h+STOP_20%:**
- Worst MAE p99%: 23.0%
- Position size (1% risk): 4.34% of capital
- Total return (sized): 55.20%
- Max DD (sized): 21.85%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_10%_ONLY:**
- Worst MAE p99%: 21.9%
- Position size (1% risk): 4.56% of capital
- Total return (sized): 43.73%
- Max DD (sized): 26.23%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_15%_ONLY:**
- Worst MAE p99%: 22.6%
- Position size (1% risk): 4.43% of capital
- Total return (sized): 49.27%
- Max DD (sized): 22.75%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

**STOP_20%_ONLY:**
- Worst MAE p99%: 23.0%
- Position size (1% risk): 4.34% of capital
- Total return (sized): 55.20%
- Max DD (sized): 21.85%
- Blown up: ✅ NO
- Concurrent 3-pos worst case: 1.0% of capital
- Survives concurrent: ✅ YES

### Failure Mode Analysis (TIME_48h)

- Loss clusters (≥3 consecutive): 61
- Largest cluster: 16 consecutive losses
- Catastrophic losses (>3%): 196
- Catastrophic reasons: {"time_exit":196}
- MAE distribution: p50=3.5% p90=12.1% p95=15.4% p99=24.0% max=35.0%

| Signal | n | Mean | Worst | % Negative |
|--------|---|------|-------|------------|
| xrp_highCumDrain | 466 | 1.6720% | -22.29% | 50.0% |
| xrp_extremeLow_p10 | 465 | 0.9000% | -17.93% | 48.4% |

### Year Stability (TIME_48h)

| Year | Mean (bps) | t-stat | n | %Win |
|------|------------|--------|---|------|
| 2022 | 97.2 | 2.19 | 219 | 49.3% |
| 2023 | 56.5 | 1.52 | 194 | 53.6% |
| 2024 | 231.3 | 3.90 | 329 | 49.8% |
| 2025 | 75.7 | 1.38 | 120 | 54.2% |
| 2026 | 34.2 | 0.57 | 69 | 46.4% |

Years positive: 5/5

---

## CROSS-ASSET SUMMARY

| Asset | Best Config | Expectancy (bps) | PF | Survival | Viable? |
|-------|------------|------------------|-----|----------|--------|
| BTC | TIME_48h | 31.5 | 1.26 | 95 | ✅ |
| ETH | TIME_48h | 44.0 | 1.25 | 90 | ✅ |
| XRP | TIME_48h | 128.6 | 1.73 | 95 | ✅ |

---

## FINAL CLASSIFICATION

### 🟢 CASE A — VIABLE ARCHITECTURE EXISTS

The following assets have a survivable architecture:

- **BTC**: TIME_48h (survival=95, edge=31.5 bps)
- **ETH**: TIME_48h (survival=90, edge=44.0 bps)
- **XRP**: TIME_48h (survival=95, edge=128.6 bps)

**Simplest viable structure:**
- Entry: Funding rate percentile triggers (p10/p95/p90 cumulative)
- Exit: Time-based (48h) with optional wide catastrophic stop
- Risk: Conservative sizing based on worst MAE
- No trailing stops, no OHLCV signals, no optimization
