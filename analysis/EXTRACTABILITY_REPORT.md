# 🔬 PHASE 2.7 — EDGE EXTRACTABILITY REPORT
**Generated:** 2026-04-04T01:56:40.334Z
**Method:** 6-test extractability analysis under realistic conditions
**Data:** Binance 1h candles, 2022-01-01 → 2026-03-31

---

## CLASSIFICATION SUMMARY

| Candidate | Events | Baseline 24h | Net (Med Friction) | Timing | Regimes+ | Years+ | Classification |
|-----------|--------|--------------|-------------------|--------|----------|--------|----------------|
| SOL / Higher-Low Uptrend | 1712 | 0.585% | 0.425% | ✅ | 100% | 60% | 🟢 ROBUST & EXTRACTABLE |
| BTC / Bullish Displacement | 455 | 0.565% | 0.405% | ✅ | 100% | 100% | 🟢 ROBUST & EXTRACTABLE |
| ETH / Bullish Displacement | 431 | 0.580% | 0.420% | ✅ | 75% | 80% | 🟢 ROBUST & EXTRACTABLE |
| SOL / Stop-Run Continuation | 170 | 1.294% | 1.134% | ✅ | 100% | 80% | 🟢 ROBUST & EXTRACTABLE |
| XRP / Post-Bear Volume Surge | 1415 | 0.450% | 0.290% | ✅ | 67% | 80% | 🟢 ROBUST & EXTRACTABLE |

---

## SOL — Higher-Low Uptrend

**Classification:** ROBUST & EXTRACTABLE (score: 7/7)
**Events:** 1712

**⚠️ Flags:**
- Edge degrades >50% with 1-candle delay
- Unbounded tail risk (>10% worst MAE)

### T1 — Friction Sensitivity

| Scenario | Round-trip Cost | Net Mean | Net t-stat | Breakeven Fee/side |
|----------|----------------|----------|------------|--------------------|
| Low friction | 0.0900% | 0.4952% | 4.25 | 0.2926% |
| Medium friction | 0.1600% | 0.4252% | 3.65 | 0.2926% |
| High friction | 0.2300% | 0.3552% | 3.05 | 0.2926% |

### T2 — Position Timing Flexibility

| Delay | Mean Return | t-stat | Win Rate |
|-------|-------------|--------|----------|
| +0candle | 0.5852% | 5.02 | 51.9% |
| +1candle | 0.2163% | 1.84 | 47.8% |
| +2candle | 0.2217% | 1.84 | 48.1% |

Degradation: +1 candle = 37% of on-time | +2 candles = 38% | Graceful: YES

### T3 — Holding Period

| Horizon | Mean | t-stat | Win Rate |
|---------|------|--------|----------|
| 1h | 0.3649% | 19.07 | 70.9% |
| 4h | 0.3470% | 7.93 | 58.7% |
| 8h | 0.4173% | 6.37 | 53.2% |
| 12h | 0.5255% | 6.40 | 54.0% |
| 24h | 0.5852% | 5.02 | 51.9% |

Optimal: 24h (0.5852%)

Time-to-MFE: mean=22.2h, median=20.0h, p75=38.0h, p90=46.0h
MFE within 4h: 20.5% | 12h: 37.8% | 24h: 56.3%

### T4 — Regime & Year Dependency

**By Year:**
| Year | Mean | t-stat | n | Win Rate |
|------|------|--------|---|----------|
| 2022 | -0.141% | -0.56 | 361 | 44.3% |
| 2023 | 1.576% | 5.64 | 461 | 56.0% |
| 2024 | 0.691% | 3.61 | 416 | 55.8% |
| 2025 | 0.188% | 0.85 | 376 | 52.1% |
| 2026 | -0.346% | -1.06 | 96 | 43.8% |

Year consistency: 60% of years positive

**By Regime:**
| Regime | Mean | t-stat | n | Win Rate |
|--------|------|--------|---|----------|
| RANGING | 0.360% | 2.35 | 959 | 49.5% |
| LOW_VOL | 0.428% | 1.53 | 246 | 51.2% |
| TRENDING_UP | 0.820% | 3.21 | 341 | 56.6% |
| VOL_EXPANSION | 2.594% | 4.32 | 79 | 63.3% |
| TRENDING_DOWN | 0.864% | 1.26 | 83 | 53.0% |

Regime independence: 100% of regimes positive

### T5 — Capital Efficiency

- Events/month: 33.6
- Net expectancy/trade (med friction): 0.4252%
- Annualized return estimate: 171.45%
- Avg lock-up (75th pct MFE): 38.0h
- Sharpe estimate: 1.77

### T6 — Risk Structure

- Avg MAE: -4.79% | Avg MFE: 6.22%
- Worst 1% MAE: 19.87% | Worst 5% MAE: 12.93%
- Risk/Reward ratio: 1.31
- Recovery after >3% DD: 28.8% (1009 events)
- Recovery after >1.5% DD: 40.2% (1352 events)
- Bounded risk: NO

---

## BTC — Bullish Displacement

**Classification:** ROBUST & EXTRACTABLE (score: 8/7)
**Events:** 455

**⚠️ Flags:**
- Unbounded tail risk (>10% worst MAE)

### T1 — Friction Sensitivity

| Scenario | Round-trip Cost | Net Mean | Net t-stat | Breakeven Fee/side |
|----------|----------------|----------|------------|--------------------|
| Low friction | 0.0900% | 0.4753% | 3.48 | 0.2827% |
| Medium friction | 0.1600% | 0.4053% | 2.97 | 0.2827% |
| High friction | 0.2300% | 0.3353% | 2.46 | 0.2827% |

### T2 — Position Timing Flexibility

| Delay | Mean Return | t-stat | Win Rate |
|-------|-------------|--------|----------|
| +0candle | 0.5653% | 4.14 | 55.4% |
| +1candle | 0.3151% | 2.36 | 53.0% |
| +2candle | 0.2733% | 2.04 | 51.2% |

Degradation: +1 candle = 56% of on-time | +2 candles = 48% | Graceful: YES

### T3 — Holding Period

| Horizon | Mean | t-stat | Win Rate |
|---------|------|--------|----------|
| 1h | 0.2129% | 6.43 | 51.4% |
| 4h | 0.2826% | 4.68 | 55.4% |
| 8h | 0.3757% | 4.33 | 53.0% |
| 12h | 0.4221% | 4.32 | 54.1% |
| 24h | 0.5653% | 4.14 | 55.4% |

Optimal: 24h (0.5653%)

Time-to-MFE: mean=22.8h, median=22.0h, p75=39.0h, p90=47.0h
MFE within 4h: 22.6% | 12h: 36.7% | 24h: 54.7%

### T4 — Regime & Year Dependency

**By Year:**
| Year | Mean | t-stat | n | Win Rate |
|------|------|--------|---|----------|
| 2022 | 0.478% | 1.41 | 94 | 60.6% |
| 2023 | 1.125% | 3.31 | 108 | 56.5% |
| 2024 | 0.538% | 2.27 | 132 | 56.8% |
| 2025 | 0.160% | 0.83 | 104 | 50.0% |
| 2026 | 0.184% | 0.41 | 17 | 41.2% |

Year consistency: 100% of years positive

**By Regime:**
| Regime | Mean | t-stat | n | Win Rate |
|--------|------|--------|---|----------|
| LOW_VOL | 0.063% | 0.19 | 47 | 46.8% |
| RANGING | 0.549% | 3.24 | 291 | 57.0% |
| TRENDING_UP | 0.757% | 2.39 | 93 | 54.8% |
| VOL_EXPANSION | 1.073% | 1.38 | 22 | 54.5% |

Regime independence: 100% of regimes positive

### T5 — Capital Efficiency

- Events/month: 8.9
- Net expectancy/trade (med friction): 0.4053%
- Annualized return estimate: 43.44%
- Avg lock-up (75th pct MFE): 39.0h
- Sharpe estimate: 1.44

### T6 — Risk Structure

- Avg MAE: -2.97% | Avg MFE: 3.62%
- Worst 1% MAE: 11.17% | Worst 5% MAE: 7.40%
- Risk/Reward ratio: 1.41
- Recovery after >3% DD: 22.1% (145 events)
- Recovery after >1.5% DD: 45.4% (337 events)
- Bounded risk: NO

---

## ETH — Bullish Displacement

**Classification:** ROBUST & EXTRACTABLE (score: 8/7)
**Events:** 431

**⚠️ Flags:**
- Unbounded tail risk (>10% worst MAE)

### T1 — Friction Sensitivity

| Scenario | Round-trip Cost | Net Mean | Net t-stat | Breakeven Fee/side |
|----------|----------------|----------|------------|--------------------|
| Low friction | 0.0900% | 0.4903% | 2.66 | 0.2901% |
| Medium friction | 0.1600% | 0.4203% | 2.28 | 0.2901% |
| High friction | 0.2300% | 0.3503% | 1.90 | 0.2901% |

### T2 — Position Timing Flexibility

| Delay | Mean Return | t-stat | Win Rate |
|-------|-------------|--------|----------|
| +0candle | 0.5803% | 3.15 | 53.1% |
| +1candle | 0.3268% | 1.79 | 48.3% |
| +2candle | 0.3143% | 1.70 | 48.7% |

Degradation: +1 candle = 56% of on-time | +2 candles = 54% | Graceful: YES

### T3 — Holding Period

| Horizon | Mean | t-stat | Win Rate |
|---------|------|--------|----------|
| 1h | 0.2314% | 5.48 | 51.3% |
| 4h | 0.2397% | 3.00 | 50.1% |
| 8h | 0.2482% | 2.16 | 54.5% |
| 12h | 0.3017% | 2.23 | 55.9% |
| 24h | 0.5803% | 3.15 | 53.1% |

Optimal: 24h (0.5803%)

Time-to-MFE: mean=22.7h, median=22.0h, p75=39.0h, p90=46.0h
MFE within 4h: 21.6% | 12h: 35.7% | 24h: 55.0%

### T4 — Regime & Year Dependency

**By Year:**
| Year | Mean | t-stat | n | Win Rate |
|------|------|--------|---|----------|
| 2022 | 1.191% | 2.37 | 96 | 64.6% |
| 2023 | 0.154% | 0.55 | 98 | 45.9% |
| 2024 | 0.818% | 2.62 | 115 | 56.5% |
| 2025 | 0.305% | 0.78 | 106 | 48.1% |
| 2026 | -0.357% | -0.43 | 16 | 37.5% |

Year consistency: 80% of years positive

**By Regime:**
| Regime | Mean | t-stat | n | Win Rate |
|--------|------|--------|---|----------|
| RANGING | 0.476% | 2.02 | 273 | 52.7% |
| LOW_VOL | -0.037% | -0.09 | 41 | 46.3% |
| TRENDING_UP | 0.520% | 1.49 | 92 | 53.3% |
| VOL_EXPANSION | 3.520% | 2.66 | 19 | 73.7% |

Regime independence: 75% of regimes positive

### T5 — Capital Efficiency

- Events/month: 8.5
- Net expectancy/trade (med friction): 0.4203%
- Annualized return estimate: 42.66%
- Avg lock-up (75th pct MFE): 39.0h
- Sharpe estimate: 1.11

### T6 — Risk Structure

- Avg MAE: -4.12% | Avg MFE: 4.49%
- Worst 1% MAE: 18.91% | Worst 5% MAE: 10.94%
- Risk/Reward ratio: 1.35
- Recovery after >3% DD: 32.4% (216 events)
- Recovery after >1.5% DD: 50.1% (387 events)
- Bounded risk: NO

---

## SOL — Stop-Run Continuation

**Classification:** ROBUST & EXTRACTABLE (score: 7/7)
**Events:** 170

**⚠️ Flags:**
- Unbounded tail risk (>10% worst MAE)

### T1 — Friction Sensitivity

| Scenario | Round-trip Cost | Net Mean | Net t-stat | Breakeven Fee/side |
|----------|----------------|----------|------------|--------------------|
| Low friction | 0.0900% | 1.2037% | 2.55 | 0.6469% |
| Medium friction | 0.1600% | 1.1337% | 2.40 | 0.6469% |
| High friction | 0.2300% | 1.0637% | 2.25 | 0.6469% |

### T2 — Position Timing Flexibility

| Delay | Mean Return | t-stat | Win Rate |
|-------|-------------|--------|----------|
| +0candle | 1.2937% | 2.74 | 51.8% |
| +1candle | 1.2286% | 2.52 | 54.7% |
| +2candle | 1.0673% | 2.28 | 52.4% |

Degradation: +1 candle = 95% of on-time | +2 candles = 83% | Graceful: YES

### T3 — Holding Period

| Horizon | Mean | t-stat | Win Rate |
|---------|------|--------|----------|
| 1h | 0.0423% | 0.40 | 46.5% |
| 4h | 0.5436% | 2.88 | 52.4% |
| 8h | 0.6787% | 2.37 | 54.7% |
| 12h | 0.6934% | 2.26 | 54.7% |
| 24h | 1.2937% | 2.74 | 51.8% |

Optimal: 24h (1.2937%)

Time-to-MFE: mean=22.4h, median=20.0h, p75=40.0h, p90=46.0h
MFE within 4h: 21.2% | 12h: 37.6% | 24h: 54.1%

### T4 — Regime & Year Dependency

**By Year:**
| Year | Mean | t-stat | n | Win Rate |
|------|------|--------|---|----------|
| 2022 | 0.414% | 0.45 | 33 | 45.5% |
| 2023 | 2.111% | 2.02 | 53 | 50.9% |
| 2024 | 1.233% | 1.89 | 37 | 59.5% |
| 2025 | 1.739% | 1.60 | 37 | 56.8% |
| 2026 | -1.561% | -1.55 | 10 | 30.0% |

Year consistency: 80% of years positive

**By Regime:**
| Regime | Mean | t-stat | n | Win Rate |
|--------|------|--------|---|----------|
| TRENDING_UP | 1.294% | 2.74 | 170 | 51.8% |

Regime independence: 100% of regimes positive ⚠️ SINGLE REGIME DEPENDENT

### T5 — Capital Efficiency

- Events/month: 3.3
- Net expectancy/trade (med friction): 1.1337%
- Annualized return estimate: 45.39%
- Avg lock-up (75th pct MFE): 40.0h
- Sharpe estimate: 1.16

### T6 — Risk Structure

- Avg MAE: -5.07% | Avg MFE: 7.47%
- Worst 1% MAE: 18.19% | Worst 5% MAE: 14.04%
- Risk/Reward ratio: 1.66
- Recovery after >3% DD: 29.8% (104 events)
- Recovery after >1.5% DD: 43.4% (143 events)
- Bounded risk: NO

---

## XRP — Post-Bear Volume Surge

**Classification:** ROBUST & EXTRACTABLE (score: 8/7)
**Events:** 1415

**⚠️ Flags:**
- Unbounded tail risk (>10% worst MAE)

### T1 — Friction Sensitivity

| Scenario | Round-trip Cost | Net Mean | Net t-stat | Breakeven Fee/side |
|----------|----------------|----------|------------|--------------------|
| Low friction | 0.0900% | 0.3597% | 2.72 | 0.2249% |
| Medium friction | 0.1600% | 0.2897% | 2.19 | 0.2249% |
| High friction | 0.2300% | 0.2197% | 1.66 | 0.2249% |

### T2 — Position Timing Flexibility

| Delay | Mean Return | t-stat | Win Rate |
|-------|-------------|--------|----------|
| +0candle | 0.4497% | 3.40 | 52.7% |
| +1candle | 0.4096% | 3.01 | 52.5% |
| +2candle | 0.3245% | 2.40 | 51.8% |

Degradation: +1 candle = 91% of on-time | +2 candles = 72% | Graceful: YES

### T3 — Holding Period

| Horizon | Mean | t-stat | Win Rate |
|---------|------|--------|----------|
| 1h | 0.0308% | 0.87 | 55.5% |
| 4h | 0.0603% | 1.13 | 53.8% |
| 8h | 0.1003% | 1.27 | 54.3% |
| 12h | 0.1412% | 1.57 | 51.6% |
| 24h | 0.4497% | 3.40 | 52.7% |

Optimal: 24h (0.4497%)

Time-to-MFE: mean=18.9h, median=16.0h, p75=35.0h, p90=45.0h
MFE within 4h: 33.2% | 12h: 44.5% | 24h: 61.7%

### T4 — Regime & Year Dependency

**By Year:**
| Year | Mean | t-stat | n | Win Rate |
|------|------|--------|---|----------|
| 2022 | -0.060% | -0.22 | 308 | 46.4% |
| 2023 | 0.671% | 2.21 | 321 | 55.5% |
| 2024 | 0.968% | 3.65 | 344 | 59.3% |
| 2025 | 0.292% | 1.18 | 353 | 50.4% |
| 2026 | 0.030% | 0.05 | 88 | 47.7% |

Year consistency: 80% of years positive

**By Regime:**
| Regime | Mean | t-stat | n | Win Rate |
|--------|------|--------|---|----------|
| UNKNOWN | 0.949% | 1.51 | 11 | 72.7% |
| RANGING | 0.474% | 2.80 | 821 | 54.2% |
| LOW_VOL | -0.297% | -1.13 | 248 | 44.8% |
| TRENDING_DOWN | 1.487% | 3.49 | 209 | 60.3% |
| TRENDING_UP | 0.697% | 0.90 | 54 | 40.7% |
| VOL_EXPANSION | -0.543% | -1.08 | 71 | 46.5% |

Regime independence: 67% of regimes positive

### T5 — Capital Efficiency

- Events/month: 27.8
- Net expectancy/trade (med friction): 0.2897%
- Annualized return estimate: 96.56%
- Avg lock-up (75th pct MFE): 35.0h
- Sharpe estimate: 1.06

### T6 — Risk Structure

- Avg MAE: -5.34% | Avg MFE: 5.04%
- Worst 1% MAE: 30.71% | Worst 5% MAE: 16.68%
- Risk/Reward ratio: 1.20
- Recovery after >3% DD: 29.7% (815 events)
- Recovery after >1.5% DD: 41.1% (1113 events)
- Bounded risk: NO

---

## FINAL VERDICT

### 🟢 ROBUST & EXTRACTABLE (5)
- **SOL / Higher-Low Uptrend** — deployable under realistic conditions
- **BTC / Bullish Displacement** — deployable under realistic conditions
- **ETH / Bullish Displacement** — deployable under realistic conditions
- **SOL / Stop-Run Continuation** — deployable under realistic conditions
- **XRP / Post-Bear Volume Surge** — deployable under realistic conditions

### 🟡 REAL BUT FRAGILE (0)
- None

### 🟠 STATISTICAL BUT NOT TRADEABLE (0)
- None

### 🔴 REJECTED (0)
- None
