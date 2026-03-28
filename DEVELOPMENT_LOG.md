# ICT + Footprint Paper Trader — Development Log

## Session: 2026-03-28 (Fourth Session) — v0.6 Enhancement Testing

### 🎯 What We Did

**Trailing stop comparison** — tested activationATR at 1.15x, 1.5x, and 2.0x on SOL Jan-Feb '25.
1.15x confirmed as best (45.5% WR, PF 0.89). Higher activation = fewer trailing triggers = more trades dying at raw SL.

**Three enhancement candidates** implemented and tested pragmatically (one at a time):

1. **Multi-timeframe trend filter (1h EMA50)** — signal direction must agree with 1h trend
2. **Volume confirmation** — entry candle must be ≥1.0x average volume
3. **Regime-adaptive trailing** — different activation/trail per regime (TRENDING: 1.0x, VOL_EXPANSION: 1.5x)

### 📊 Baseline (no enhancements)

| Period | SOL Final | SOL PF | ETH Final | ETH PF |
|--------|-----------|--------|-----------|--------|
| Jan-Feb '25 | $9,250 (-7.5%) | 0.89 | $9,345 (-6.6%) | 0.97 |
| Mar-Jun '25 | $8,144 (-18.6%) | 0.76 | $7,706 (-22.9%) | 0.76 |

### 📊 MTF Filter Only (1h EMA50 direction agreement)

| Period | PF | Max DD | vs Baseline |
|--------|-----|--------|-------------|
| SOL Jan-Feb | **1.06** | **11.2%** | ✅ +0.17 PF, -4pp DD |
| ETH Jan-Feb | 0.92 | 9.6% | ≈ -0.05 PF (flat) |
| SOL Mar-Jun | **0.82** | **16.4%** | ✅ +0.06 PF, -5.2pp DD |
| ETH Mar-Jun | **0.88** | **14.0%** | ✅ +0.12 PF, -9.3pp DD |

**Verdict: KEEP.** Improves 3/4, never hurts badly. Consistent across symbols and periods.

### 📊 MTF + Volume Filter (1.0x avg volume required)

| Period | PF | Max DD | vs Baseline |
|--------|-----|--------|-------------|
| SOL Jan-Feb | **1.26** | **4.93%** | ✅ big improvement |
| ETH Jan-Feb | **0.50** | 11.4% | ❌ destroyed |
| SOL Mar-Jun | 0.70 | **10.1%** | 🟡 mixed |
| ETH Mar-Jun | **1.27** | **4.87%** | ✅ big improvement |

**Verdict: NOT CONSISTENT.** Helps some periods, destroys others. Volume filter alone also inconsistent. Needs softer threshold or per-symbol tuning.

### 📊 Regime-Adaptive Trailing (TRENDING 1.0x, VOL 1.5x)

Made SOL Jan-Feb worse (PF 0.78 vs 0.89). Tighter trailing in TRENDING cuts winners short.
**Verdict: DISCARD.** Uniform 1.15x activation is better.

### 🔧 Code Changes

- `config.js` — added multiTimeframe, volumeFilter, trailingStopRegime config sections (all disabled except MTF)
- `strategies/StrategyEngine.js` — added `_checkMultiTimeframe()` and `_checkVolumeFilter()` methods
- `engine/backtest.js` — fetches 1h context candles, passes to strategy, regime-adaptive trailing in exits
- `engine/PaperEngine.js` — regime-adaptive trailing support (falls back to default)
- `engine/main.js` — passes 1h context candles from feed to strategy

### Current Config State

- MTF filter: **ENABLED** (1h EMA50 direction agreement)
- Volume filter: **DISABLED** (inconsistent results)
- Regime-adaptive trailing: **DISABLED** (empty overrides = uses default 1.15x)

### Next Steps

1. Test softer volume threshold (0.7x or 0.8x avg) — may be less aggressive
2. Test MTF with different EMA periods (30, 100) on 1h
3. Push to GitHub for continuity
4. Extended period testing (Jul-Dec '25) if available on Binance
5. Consider per-symbol config overrides (different settings for SOL vs ETH)

---

## Session: 2026-03-28 (Third Session) — v0.5 Multi-Symbol Validation

### 🎯 What We Did

**Multi-symbol validation** — ran backtests on ETH, BTC, and SOL (extended period) to test if the v0.4 edge was real or curve-fitted.

### 📊 Validation Results (v0.4 — before fixes)

| Symbol | Period | Final | PnL | WR | PF | Max DD |
|--------|--------|-------|-----|-----|-----|--------|
| SOL | Jan-Feb '25 | $9,318 | -6.8% | 41.2% | 0.93 | 11.9% |
| ETH | Jan-Feb '25 | $6,539 | -34.6% | 27.8% | 0.65 | 36.4% |
| BTC | Jan-Feb '25 | $6,459 | -35.4% | 32.2% | 0.68 | 38.4% |
| SOL | Mar-Jun '25 | $9,134 | -8.7% | 39.5% | 1.05 | 18.1% |

**Verdict: Edge didn't transfer.** ETH and BTC destroyed. SOL barely profitable.

### 🔧 v0.5 Fixes Applied

1. **Hard direction filter (EMA50)** — never long below EMA50, never short above EMA50. Applied in ALL regimes, not just TRENDING.
2. **Kill FVG entirely** — 24% WR even with demotion. Removed from signal pool.
3. **Skip RANGING regime** — 9-30% WR, always negative across all symbols.
4. **Boost DELTA_DIVERGENCE** — 1.2x → 1.5x. Only consistently profitable signal.
5. **Raise minConfluenceScore** — 0.55 → 0.60. Fewer trades, higher quality.

### 📊 v0.5 Results (after fixes)

| Symbol | Period | Final | PnL | WR | PF | Max DD | Change |
|--------|--------|-------|-----|-----|-----|--------|--------|
| ETH | Jan-Feb '25 | $10,008 | +0.08% | 40.4% | 1.16 | 7.3% | PF +0.51 🔥 |
| BTC | Jan-Feb '25 | $7,762 | -22.4% | 32.5% | 0.71 | 26.5% | PF +0.03 🟡 |
| SOL | Mar-Jun '25 | $9,716 | -2.8% | 38.9% | 1.07 | 3.0% | PF +0.02 ✅ |

### Key Findings

**Direction filter was the breakthrough.** ETH went from 0.65 PF to 1.16 — a complete turnaround. The system was fighting the trend constantly.

**BTC is the outlier.** Loses in ALL regimes (TRENDING_UP -$306, TRENDING_DOWN -$476, VOL_EXPANSION -$557). The edge doesn't exist for BTC on 15m in this period. BTC excluded from live trading.

**Trailing stops remain the backbone:**
- trailing_sl: 100% WR, +$4,233 (ETH), +$3,416 (BTC), +$6,158 (SOL)
- stop_loss: 0% WR, -$3,568 (ETH), -$4,766 (BTC), -$6,056 (SOL)

**Fee drag is real.** Gross PnL is positive but fees eat the edge. Need ~2-3% more WR or slightly better R:R to be net profitable.

### Symbols

- **SOL/USDT** ✅ — validated across 2 periods (Jan-Feb, Mar-Jun). PF 1.07.
- **ETH/USDT** ✅ — breakeven after direction filter. PF 1.16.
- **XRP/USDT** ❌ — PF 0.64, 27% WR. No edge. Excluded.
- **BTC/USDT** ❌ — PF 0.71, no edge in any regime. Excluded.

### Next Steps

1. Test XRP validation
2. Consider 1h timeframe for wider edge
3. Tighten trailing activation (2.0x → 1.5x ATR) to get more winners
4. Add time-based regime filter (avoid weekends entirely — always negative)
5. Extended period test on ETH (Mar-Jun)
6. Live paper trading on ETH + SOL + XRP

---

## Session: 2026-03-28 (Second Session)

### 🎯 What We Built

**Entry Confirmation System** — ICT zones tell WHERE, candle patterns confirm WHEN
- Pin bars (long wick rejection at zone)
- Engulfing (full body reversal at zone)  
- Inside bar breakouts (consolidation → expansion at zone)
- Pattern must be within 1.5x ATR of the signal price

**Weekend Mode**
- `config.weekend.enabled: true`
- Killzones entirely excluded (no institutional sessions on weekends)
- Higher confluence threshold (+0.10 to min score)
- Half risk percentage (thinner books, more slippage)
- Wider SL (+0.2 multiplier)

**Signal Demotions (data-driven)**
- ORDER_BLOCK: score × 0.5, requires confluence (was 18% WR, -$1,514)
- FVG: score × 0.7 (was 24% WR, -$636)
- DELTA_DIVERGENCE: score × 1.2 boost (only profitable signal, 38% WR)

**Breakeven Stops Disabled**
- DEV LOG showed BE killed $218 in potential profit
- Trailing SL has 100% WR — it handles everything
- Trailing activation widened: 1.5x → 2.0x ATR (let winners breathe)

### 📊 Backtest Results — SOL/USDT, 15m, Jan-Feb 2025 (Binance)

| Metric | v0.3 (before) | v0.4 (after) | Change |
|--------|---------------|--------------|--------|
| Starting Balance | $10,000 | $10,000 | — |
| Final Balance | $6,004 | $9,318 | +$3,314 |
| Total Trades | 207 | 102 | -51% (sniper) |
| **Win Rate** | **21.7%** | **41.2%** | **+19.5pp** |
| PnL | -$3,996 (-39.96%) | -$276 (-6.82%) | +93% |
| **Profit Factor** | **0.48** | **0.93** | **+0.45** |
| Max Drawdown | 41.09% | 11.87% | -71% |
| Avg Win/Loss | 1.72:1 | 1.33:1 | |
| Sharpe | -12.46 | -1.98 | |
| Total Fees | $1,433 | $810 | -43% |

### By Exit Reason

| Exit Type | v0.3 Trades | v0.3 WR | v0.3 PnL | v0.4 Trades | v0.4 WR | v0.4 PnL |
|-----------|------------|---------|----------|------------|---------|----------|
| trailing_sl | 45 | 100% | +$2,993 | 42 | 100% | +$3,827 |
| stop_loss | 106 | 0% | -$5,994 | 57 | 0% | -$3,976 |
| breakeven_sl | 54 | 0% | -$218 | 0 | — | $0 (disabled) |
| time_exit | 2 | 0% | -$59 | 3 | 0% | -$128 |

### By Signal Type

| Signal | v0.3 Trades | v0.3 WR | v0.3 PnL | v0.4 Trades | v0.4 WR | v0.4 PnL |
|--------|------------|---------|----------|------------|---------|----------|
| DELTA_DIVERGENCE | 13 | 38% | +$186 | 42 | 40% | -$326 |
| OTE | 28 | 25% | -$117 | 20 | 60% | +$581 |
| FVG | 36 | 22% | -$636 | 17 | 24% | -$379 |
| IMBALANCE | 30 | 23% | -$724 | 18 | 33% | -$238 |
| LIQUIDITY_SWEEP | 23 | 17% | -$474 | 4 | 50% | +$22 |
| ORDER_BLOCK | 77 | 18% | -$1,514 | 1 | 100% | +$63 |

### By Entry Pattern (NEW)

| Pattern | Trades | WR | PnL | Notes |
|---------|--------|-----|-----|-------|
| pin_bar_bearish | 35 | 46% | +$303 | ✅ Best performer |
| bearish_engulfing | 11 | 55% | +$227 | ✅ Strong |
| inside_bar_breakout_bearish | 2 | 100% | +$197 | ✅ Small sample, strong |
| inside_bar_breakout_bullish | 3 | 67% | +$134 | ✅ Small sample, strong |
| pin_bar_bullish | 38 | 34% | -$720 | ❌ Longs weaker in this period |
| bullish_engulfing | 13 | 23% | -$418 | ❌ Longs weaker |

### Weekend vs Weekday (NEW)

| Period | Trades | WR | PnL |
|--------|--------|-----|-----|
| Weekday | 102 | 41.2% | -$276 |
| Weekend | 0 | — | $0 |

Weekend trades are entirely filtered out by the higher confluence threshold + entry confirmation. The market is too thin and vertical on weekends.

### Key Insights

**What Works Now:**
- Entry confirmation was the game-changer — WR from 22% → 41%
- Trailing stops remain the backbone (100% WR on winners, +$3,827)
- OTE is now the best signal (60% WR, +$581) — entry confirmation cleaned it up
- ORDER_BLOCK demotion killed noise (77 trades → 1 trade)
- Bearish setups outperform bullish significantly in this period (SOL crash)
- Weekend mode works — 0 qualifying trades on weekends (correct behavior)

**What Still Needs Work:**
- PF 0.93 is still below 1.0 — need ~2-3% more WR or slightly better R:R
- Bullish patterns underperform — may be period-specific (SOL was crashing Jan-Feb)
- 56% of trades still hit raw stop loss — entry confirmation helps but doesn't eliminate all bad entries
- FVG still weak at 24% WR even with demotion

### Next Steps

1. **Multi-symbol validation** — test on ETH, BTC, XRP to confirm edge isn't SOL-specific
2. **Multi-timeframe** — test 5m and 1h to see if timeframe affects pattern quality
3. **Bullish bias correction** — investigate why bullish pin bars underperform (may need stricter trend filter for longs)
4. **Consider R:R tuning** — slightly tighter SL in TRENDING (0.6x instead of 0.8x) to improve PF
5. **Extended period** — test Mar-Jun 2025 to validate across different market conditions

---

## Session: 2026-03-28 (First Session)

### 📊 Backtest Results — SOL/USDT, 15m, Jan-Feb 2025 (Binance)

**Config:** Confluence mode, deadzone-based killzone, 45min cooldown, strict trend alignment

| Metric | Value | Verdict |
|--------|-------|---------|
| Starting Balance | $10,000 | — |
| Final Balance | $6,004 | ❌ -39.96% |
| Total Trades | 207 | ✅ Good volume |
| Win Rate | 21.7% (45W / 162L) | ❌ Too low |
| Avg Win / Avg Loss | $66.51 / $38.72 (1.72:1) | ✅ Good R:R |
| Profit Factor | 0.48 | ❌ Need >1.0 |
| Max Drawdown | 41.09% | ❌ Too high |
| Sharpe Ratio | -12.46 | ❌ |

### Bug Fixes Applied (First Session)

1. **Killzone used real-world clock instead of candle timestamp** — backtest only generated signals in whatever session the real clock was in
2. **Position sizing hardcoded to starting balance** — didn't adapt to PnL
3. **Backtest daily loss limit was inverted** — `Math.abs` missing
4. **BE/trailing stops used TP distance as ATR proxy** — inconsistent
5. **Backtest trailing logic differed from live engine** — unified both
6. **Footprint analyzer state never reset** — OOM on long backtests
7. **ICT analyzer FVGs/OrderBlocks never pruned** — arrays grew unbounded

### Performance Fixes (First Session)

- FVG detection: scans only new candles since last analysis
- ATR/EMA: cached between calls in StrategyEngine
- Volume profile: limited to last 200 candles, max 100 levels per candle
- FVG/OB: auto-prune tested/mitigated + deduplication
- Added `--exchange` CLI flag for backtest

### The Fundamental Problem Identified

ICT zones (FVG, OB, OTE) tell us WHERE price might reverse, but not WHEN. We're entering at the zone without confirmation that the reversal is actually happening.

→ **Solution: Entry Confirmation (implemented in second session)**

---

## How to Run

```bash
# Install
npm install

# Backtest (use Binance for historical data)
node engine/backtest.js --exchange binance --symbol SOL/USDT --timeframe 15m --from 2025-01-01 --to 2025-03-01 --verbose

# Live paper trading (requires .env with Telegram credentials)
npm start

# Results go to backtest-results/
```

## Files Modified (second session)
- `config.js` — weekend mode, entry confirmation settings, order block demotion, breakeven disabled, trailing widened
- `strategies/StrategyEngine.js` — weekend detection, entry confirmation (pin/engulfing/inside bar), OB/FVG demotion, DELTA_DIVERGENCE boost, weekend scoring
- `engine/backtest.js` — weekend risk, isWeekend/entryPattern tracking, new report breakdowns
- `engine/main.js` — weekend risk in live engine, entry pattern logging
- `README.md` — full rewrite with v0.4 features

## Files Modified (first session)
- `config.js` — R:R ratios, killzone, strategy settings, pruning limits
- `strategies/StrategyEngine.js` — killzone fix, confluence scoring, trend filter, signal penalties
- `analysis/ICTAnalyzer.js` — state pruning, dedup, incremental scanning
- `analysis/FootprintAnalyzer.js` — rolling window, volume profile cap
- `engine/PaperEngine.js` — actual ATR-based BE/trailing
- `engine/backtest.js` — daily loss fix, unified trailing, --exchange flag
- `engine/main.js` — ATR passthrough, v0.3 dashboard
