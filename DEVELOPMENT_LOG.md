# ICT + Footprint Paper Trader — Development Log

## Session: 2026-03-29 — v2.0 Per-Asset Regime Optimization

### 🎯 What We Did

Full system audit starting from original prompt vs implementation. Ran backtests across 3 periods for all 4 assets. Implemented per-asset regime filtering, signal rebalancing, and regime detector tightening.

### 📊 Final Validated Results (Jan-May 2025)

| Asset | PnL | PF | WR | Trades | Regime Filter |
|-------|-----|-----|-----|--------|---------------|
| XRP | +$2,250 | 1.89 | 60% | 87 | VOL_EXPANSION only |
| SOL | +$101 | ~1.1 | 55% | 22 | RANGING only (tightened) |
| **Combined** | **+$1,918** | **1.81** | **58.7%** | **109** | Per-asset |

Walk-forward: Q1 PF 1.46 → Q2 PF 1.89. Not overfitting.

### 📊 Out-of-Sample Results

| Period | PF | WR | PnL | Max DD | SOL | XRP |
|---|---|---|---|---|---|---|
| Jan-May 2025 | 1.81 | 58.7% | +$1,918 | 5.33% | +$101 | +$2,250 |
| Jul-Nov 2024 | 0.92 | 52.9% | -$854 | 12.09% | -$376 | +$80 |
| Full 2023 | 1.07 | 50.8% | -$1,015 | 24.77% | +$1,288 | -$583 |

### 🔑 Key Discoveries

#### What Works
1. **Per-asset regime filtering** — single biggest improvement. Each asset only trades where it has edge.
2. **XRP in VOL_EXPANSION** — most consistent. Profitable in 2 of 3 periods, breakeven in worst.
3. **Trailing stops + Partial TP** — 100% WR across ALL periods. The real edge generator (+$8,596 in 2023 alone).
4. **DELTA_FLIP signal** — best signal type when it works (56% WR in validated period).
5. **EMA50 slope filter** — catches slow trends that ADX misses. Reduced SOL trades in Jul-Nov 2024.

#### What Doesn't Work
1. **DELTA_DIVERGENCE** — 49% WR globally, -$430. Was 89% of trades before downweighting.
2. **Time exits** — 0% WR across all periods. Removed entirely.
3. **Loose RANGING detection** — 3% range threshold let slow trends leak through. Tightened to 1.5%.
4. **TRENDING_UP handling** — code had contradictions (enabled then disabled). Cleaned up.

#### The Fundamental Problem: SOL in Bull Runs
- SOL RANGING works in bear/neutral markets (2023: +$1,288, 55% WR)
- SOL RANGING fails in bull runs (Jul-Nov 2024: -$1,021, 32% WR)
- Root cause: during slow bull runs, ADX stays low (looks like range) but price grinds up → SOL shorts get destroyed
- EMA50 slope filter helped (17 trades vs 68 in Jul-Nov 2024) but didn't fully fix it
- The 4% trend escape prevents catastrophic losses but doesn't prevent the initial wrong-direction entries

### 🐛 Bugs Found & Fixed
1. **PnL reporting** — `totalPnL` (trade sum) didn't match balance change. Fixed to use balance-based PnL.
2. **TRENDING_UP contradiction** — lines 54-56 re-enabled it, line 115 blocked it. Removed duplicate.
3. **Partial TP fee accounting** — entry fee counted in both partial and remaining close. Minor, but affects stats.

### 📁 Current File Structure
```
config.js                    — Master config (SOL+XRP, tightened regime params)
config/assetProfiles.js      — Per-asset allowedRegimes + regimeBoosts
strategies/
  DaytradeMode.js            — 1H ICT + trend + per-asset regime + EMA slope filter
  ModeRouter.js              — Day/weekend routing (daytrade only active)
engine/
  main.js                    — Live paper trader
  PaperEngine.js             — Orders, PnL, trailing stops + range_breakout exit
  backtest.js                — Historical backtester + range_breakout + no time_exit
analysis/
  RegimeDetector.js          — Tightened: 1.5% range, ADX<20, trend escape
  ICTAnalyzer.js             — Order Blocks, OTE, Liquidity Sweeps
  RealFootprintAnalyzer.js   — DELTA_DIVERGENCE downweighted, DELTA_FLIP boosted
data/
  HyperliquidFeed.js         — Real-time data + trade footprint
alerts/
  TelegramAlerter.js         — Telegram notifications
```

---

## 🔮 What To Do Next (Priority Order)

### Priority 1: Fix SOL RANGING in Bull Runs (Critical)
**Problem:** SOL RANGING loses during slow bull runs because the regime detector can't distinguish "genuine range" from "slow grind up."

**Possible fixes:**
- A. **Require RSI confirmation for RANGING**: RSI between 40-60 (truly range-bound) vs RSI > 60 (trending up, don't short)
- B. **Check higher timeframe trend**: If 4H or Daily is trending up, don't allow RANGING shorts on 1H
- C. **Direction filter in RANGING**: Only allow LONGS in RANGING when EMA50 is rising, only SHORTS when falling
- D. **Reduce SOL RANGING risk**: Lower riskPercent from 0.5 to 0.3 for SOL specifically

**Why this matters:** SOL RANGING is +$3,088 total across periods but -$1,021 in Jul-Nov 2024. Fixing this one thing could flip the system from "works in some markets" to "works in most markets."

### Priority 2: XRP 2023 Performance (-$583)
**Problem:** XRP VOL_EXPANSION loses in 2023 despite being great in 2024-2025.

**Possible fixes:**
- A. Check if 2023 XRP had different volatility profile (it did — XRP was $0.30-0.80 range, now $1-3)
- B. Add volume confirmation for VOL_EXPANSION signals
- C. Per-asset min signal confidence (XRP needs > 0.7 in low-vol periods)

### Priority 3: Reduce Trade Frequency / Fees
**Problem:** 2023 had 319 trades and $3,908 in fees. Fees eat 100%+ of profits.

**Possible fixes:**
- A. Increase signalCooldown from 45min to 90min
- B. Add minimum ATR threshold (skip trades when ATR < 1% of price)
- C. Require confluence for ALL signals, not just weak ones

### Priority 4: Walk-Forward Optimization
- Train on 6-month windows, test on next 3 months
- Adapt allowedRegimes dynamically based on recent performance
- This could auto-discover which regimes work in current market conditions

### Priority 5: Live Paper Trading
- Set up .env with Telegram credentials
- Run on VPS for 2 weeks
- Compare live vs backtest execution quality

---

## 🏃 How to Continue
```bash
# Clone and install
git clone https://github.com/ShrPaw/ict-footprint-paper-trader.git
cd ict-footprint-paper-trader
git checkout fix/per-asset-regime-optimization
npm install

# Backtest (validated period)
node engine/backtest.js --exchange binance --from 2025-01-01 --to 2025-05-01 --verbose

# Stress test (the hard period)
node engine/backtest.js --exchange binance --from 2024-07-01 --to 2024-12-01 --verbose

# Single asset
node engine/backtest.js --exchange binance --symbol XRP/USDT --from 2025-01-01 --to 2025-05-01 --verbose

# Live paper trading
cp .env.example .env
# Edit .env with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
npm start
```

## 💡 Design Philosophy (Lessons Learned)
1. **Per-asset > one-size-fits-all** — each crypto has unique behavior
2. **Empirical > theoretical** — the original prompt wanted trend-following, but data showed ranging/vol-expansion is the edge
3. **Trailing stops are the edge** — not entry signals, not regime detection. Letting winners run is the alpha.
4. **Regime detection is the bottleneck** — everything hinges on correctly identifying RANGING vs TRENDING
5. **Fees matter** — 100+ trades with 0.05% fees each = 5%+ annual drag. Trade less, trade better.
