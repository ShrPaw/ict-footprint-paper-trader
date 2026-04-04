# 🔬 EDGE DISCOVERY REPORT — Final Research Output

**Generated:** 2026-04-04 09:31 GMT+8
**Method:** Structural event hypothesis testing → deep conditional analysis → adversarial stability testing
**Data:** Binance 1h candles, 2022-01-01 → 2026-03-31 (~37,224 candles per asset)
**Assets:** ETH, SOL, BTC, XRP (strictly isolated)

---

## RESEARCH METHODOLOGY

### Phase 1: Broad Hypothesis Screen (v2.0)
- 16 event types × 4 assets = 64 hypotheses
- Event families: Momentum/Breakout, Volatility Transition, Structural/Liquidity
- Early rejection filters: clustering >50%, sample <50 independent, t<1.96, time-split instability, zero mean

### Phase 2: Deep Conditional Analysis (v2.1)
- 10 regime-conditional and directional hypotheses × 4 assets = 40 tests
- Regime-specific, directional asymmetry, volume-conditional, structural patterns

### Phase 3: Adversarial Stability (v2.2)
- Year-by-year consistency
- Quarterly direction agreement
- 20-iteration random 50% subsample bootstrap

---

## SUMMARY STATISTICS

| Phase | Hypotheses Tested | Survived Early Filters | Robust Under Adversarial |
|-------|-------------------|----------------------|-------------------------|
| v2.0 (Broad) | 64 | 9 | — |
| v2.1 (Deep) | 40 | 7 | — |
| v2.2 (Stability) | 8 top candidates | — | See below |

---

## 🟢 SURVIVING CANDIDATES (Ranked by Quality)

### 1. SOL / Higher-Low Uptrend Pattern 🟡 CONDITIONAL EDGE

| Metric | Value |
|--------|-------|
| Events | 1,712 |
| 24h Mean Return | +0.585% |
| t-statistic | 5.02 |
| Win Rate | 51.9% |
| Subsample Stability | 100% (all 20 random halves agree) |
| Year Direction | 2022: ↓, 2023: ↑✅, 2024: ↑✅, 2025: ↑, 2026: ↓ |
| Quarter Agreement | 13/17 (76%) |

**What it is:** When SOL forms a higher swing low (local low above previous local low) while price is above the 50 EMA, the next 24 hours tend to be positive.

**Regime breakdown:**
- RANGING: mean=+0.329%, t=5.78 ✅
- LOW_VOL: mean=+0.344%, t=3.41 ✅
- TRENDING_UP: mean=+0.303%, t=2.99 ✅
- VOL_EXPANSION: mean=+0.592%, t=2.03 ✅
- TRENDING_DOWN: mean=+0.568%, t=2.97 ✅

**⚠️ Risk flags:**
- 2022 is slightly negative (crypto winter regime shift)
- 2026 Q1 negative (small sample)
- Clustering 16.4% (acceptable)

**Assessment:** The strongest candidate. Works across ALL regimes, large sample, high t-stat. The 2022 weakness is explained by the known regime shift (the existing system also lost in 2022). 2023-2024 is where the edge concentrates. The edge is structurally grounded: a higher low in an uptrend is a textbook bullish continuation pattern.

---

### 2. BTC / Displacement Bullish 🟡 CONDITIONAL EDGE

| Metric | Value |
|--------|-------|
| Events | 455 |
| 24h Mean Return | +0.565% |
| t-statistic | 4.14 |
| Win Rate | 55.4% |
| Subsample Stability | 100% |
| Year Direction | 2022: ↑, 2023: ↑✅, 2024: ↑✅, 2025: ↑, 2026: ↑ |
| Quarter Agreement | 12/17 (71%) |

**What it is:** When BTC prints a displacement candle (body >70% of range AND >1.5 ATR, bullish) that doesn't immediately revert, the next 24h tends to be positive.

**Regime breakdown:**
- RANGING: mean=+0.269%, t=3.57 ✅
- TRENDING_UP: mean=+0.311%, t=2.19 ✅

**⚠️ Risk flags:**
- Only 2 of 5 years individually significant (sample size per year)
- 5/17 quarters disagree

**Assessment:** The most directionally consistent candidate — positive in ALL 5 years. This is extremely rare. The mean is lower than SOL's HL pattern but the consistency is better. The displacement candle captures genuine institutional commitment.

---

### 3. ETH / Displacement Bullish 🟡 CONDITIONAL EDGE

| Metric | Value |
|--------|-------|
| Events | 431 |
| 24h Mean Return | +0.580% |
| t-statistic | 3.15 |
| Win Rate | 53.1% |
| Subsample Stability | 100% |
| Year Direction | 2022: ↑✅, 2023: ↑, 2024: ↑✅, 2025: ↑, 2026: ↓ |
| Quarter Agreement | 13/17 (76%) |

**Regime-specific edge:** VOL_EXPANSION regime → mean=+1.538%, t=3.16 ✅ (19 events)

**⚠️ Risk flags:**
- 2026 Q1 negative
- The VOL_EXP-specific edge has only 19 events (insufficient alone)

**Assessment:** Similar to BTC displacement but slightly less consistent. The overall 53.1% win rate with positive skew is real. Works in RANGING and TRENDING_UP.

---

### 4. SOL / Stop-Run Continuation in TRENDING_UP 🟡 CONDITIONAL EDGE

| Metric | Value |
|--------|-------|
| Events | 170 |
| 24h Mean Return | +1.294% |
| t-statistic | 2.74 |
| Win Rate | 51.8% |
| Subsample Stability | 100% |
| Year Direction | 2022: ↑, 2023: ↑✅, 2024: ↑, 2025: ↑, 2026: ↓ |
| Quarter Agreement | 10/15 (67%) |

**What it is:** In TRENDING_UP regime, a candle with a large upper wick (stop sweep) followed by a bullish continuation candle. The wick hunts shorts, then price continues up.

**⚠️ Risk flags:**
- Only 170 events (small sample)
- 2026 Q1 negative
- Only 1/5 years individually significant
- 33% of quarters disagree

**Assessment:** Highest mean return of all candidates (+1.29%) but smallest sample. The concept is sound (stop hunt continuation in trends). Needs more data to confirm.

---

### 5. XRP / Post-Bear-Volume-Surge Reversal 🟡 CONDITIONAL EDGE

| Metric | Value |
|--------|-------|
| Events | 1,415 |
| 24h Mean Return | +0.450% |
| t-statistic | 3.40 |
| Win Rate | 52.7% |
| Subsample Stability | 100% |
| Year Direction | 2022: ↓, 2023: ↑✅, 2024: ↑✅, 2025: ↑, 2026: ↑ |
| Quarter Agreement | 14/17 (82%) |

**What it is:** After a bearish candle with >2σ volume, the next 24h tends to be positive. This is a mean-reversion signal: extreme selling volume gets absorbed.

**⚠️ Risk flags:**
- 2022 negative (crypto winter)
- High positive skew (3.23) — mean inflated by outliers
- Median return likely near zero

**Assessment:** Counter-intuitive but structurally sound (selling climax → absorption → bounce). Best quarterly consistency (82%). The high skew is a concern — the mean might be driven by a few large moves rather than consistent edge.

---

## 🔴 REJECTED CANDIDATES (Notable Rejections)

| Candidate | Why Rejected |
|-----------|-------------|
| Breakout events (all assets) | 55-60% clustering, time-split unstable |
| ATR spike events | 88-92% clustering (volatility clusters) |
| Volume squeeze | 89-91% clustering |
| EMA cross + momentum | Not significant (t<1.0), unstable |
| Killzone momentum | Not significant, unstable |
| 3-consecutive in RANGING | 52%+ clustering |
| Vol compression → expansion | Clustering 60%+, unstable |

**Key insight:** Most volatility-based events fail because volatility clusters. A high-ATR candle is almost always followed by another high-ATR candle, creating temporal dependence that inflates sample counts.

---

## STRUCTURAL ASSESSMENT

### What Passed: Structural Price Patterns
The surviving candidates are all based on **price structure** (higher lows, displacement candles, stop runs), not raw volatility or volume metrics. This is consistent with the thesis that:

1. **Price structure captures real supply/demand shifts** — a higher low means buyers are stepping in earlier, displacement means institutional commitment
2. **Volatility metrics are autocorrelated** — they cluster by nature, creating false statistical significance
3. **Volume alone is insufficient** — without price context, volume is regime-dependent noise

### What Failed: Everything Else
Every momentum breakout, volatility transition, and volume-only hypothesis was rejected. The market is not predictable from these features at the 1h timeframe.

---

## ⚠️ CRITICAL CAVEATS

1. **No candidate passes the strictest year-by-year significance test** (only 40% of years individually significant). This is partly a power issue (splitting 4yr data into 5 chunks reduces per-year sample size) but also suggests the edge is NOT uniformly strong across all periods.

2. **2022 is consistently weak or negative** across all candidates. This may indicate the edge doesn't work in aggressive downtrends / crypto winter regimes.

3. **These are raw forward returns, not risk-adjusted trading returns.** Actual trading would face: slippage, fees, timing (you can't enter at the exact close), and execution risk.

4. **Sample size for the highest-mean candidates is small** (170 for SOL stop-run, 455 for BTC displacement).

5. **The 100% subsample stability is encouraging but not proof.** It means the directional signal is consistent within the dataset, but does not guarantee out-of-sample performance.

---

## 🎯 RECOMMENDATION FOR PHASE 2.5

### Candidates Worthy of Adversarial Testing

1. **SOL / Higher-Low Uptrend** — Strongest overall. Large sample, high t-stat, works across regimes. Priority #1.

2. **BTC / Displacement Bullish** — Most directionally consistent (positive all 5 years). Priority #2.

3. **XRP / Post-Bear-Volume Reversal** — Best quarterly consistency (82%). The skew concern needs investigation. Priority #3.

### Candidates Requiring More Data

4. **ETH / Displacement Bullish** — Similar to BTC but less consistent. Wait for more data.

5. **SOL / Stop-Run Trending** — Highest mean but smallest sample. Needs 2+ more years of data.

### What NOT to Do Next

- Do NOT optimize parameters on these edges (curve-fitting risk)
- Do NOT combine edges into a portfolio (cross-contamination)
- Do NOT assume these will work in live trading without walk-forward validation
- Do NOT ignore the 2022 regime weakness

---

## FILES

```
analysis/
  edge-discovery-v2.js          — Phase 1: broad hypothesis screen
  edge-discovery-deep.js        — Phase 2: conditional analysis
  edge-stability-test.js        — Phase 3: adversarial stability
data/
  edge-discovery-report-*.md    — Phase 1 report
  edge-discovery-raw-*.json     — Phase 1 raw data
  edge-discovery-deep-*.md      — Phase 2 report
  edge-discovery-deep-raw-*.json — Phase 2 raw data
  edge-stability-*.json         — Phase 3 raw data
```
