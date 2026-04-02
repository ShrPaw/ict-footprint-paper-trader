# PROJECT_CONTEXT.md — ICT Footprint Paper Trader

**Last updated:** 2026-04-03 04:47 GMT+8
**Session:** #10 (2026-04-03)
**Version:** 4.0.0 (Scoring fix + per-asset risk fix + XRP killed + wider stops)

---

## What This Is

A **regime-adaptive paper trading engine** for crypto perpetuals (ETH, SOL, BTC, XRP). Combines **ICT concepts** (Order Blocks, OTE, Liquidity Sweeps) on 1H timeframes with **real-time order flow (footprint) analysis**.

**Version:** 2.0.0 (Precomputed O(n) backtest engine)
**Language:** JavaScript (ESM, Node.js 22)
**Repo:** `https://github.com/ShrPaw/ict-footprint-paper-trader` (private)
**Owner:** Nicolas (Windows user, Spanish)

---

## Validated Results (Jan-May 2025, Binance SPOT — ⚠️ SEE NOTE)

| Asset | PnL | PF | WR | Trades | Max DD | Sharpe | Best Regime |
|-------|-----|-----|-----|--------|--------|--------|-------------|
| ETH | +$684 | 1.52 | 59.3% | 54 | 3.5% | 1.18 | RANGING + VOL_EXP |
| SOL | +$1,426 | 1.72 | 59.7% | 77 | 5.5% | 1.71 | RANGING only |
| BTC | +$317 | 1.53 | 65.4% | 26 | 2.9% | 0.85 | VOL_EXP only |
| XRP | +$1,242 | 2.27 | 65.9% | 44 | 4.1% | 2.57 | VOL_EXP only |
| **Total** | **+$3,669** | **~1.75** | **61.8%** | **201** | | | ~40 trades/month |

⚠️ **These results were from Binance SPOT data, not FUTURES.** The futures backtest (2022-2026) has NOT been run yet.

## Backtest Results v4.0 — Binance FUTURES (2022-01-01 → 2026-03-31)

**After: wider stops, ETH RANGING blocked, tighter thresholds, breakeven, 2h cooldown.**

| Asset | PnL | PF | WR | Trades | Max DD | Fees | Final Bal |
|-------|-----|-----|-----|--------|--------|------|-----------|
| ETH | +$3,392 | 1.20 | 50.1% | 870 | 17.6% | $5,556 | $13,392 |
| SOL | +$4,975 | 1.30 | 57.1% | 1,022 | 11.5% | $4,353 | $14,975 |
| BTC | +$1,610 | 1.10 | 51.6% | 903 | 22.7% | $7,136 | $11,610 |
| XRP | +$643 | 1.07 | 52.6% | 475 | 14.3% | $1,831 | $10,643 |
| **Total** | **+$10,620** | | | **3,270** | | **$18,876** | **$40,620** |

### Exit Analysis (All Assets)
| Exit | WR | PnL | Count |
|------|-----|-----|-------|
| trailing_sl | 81% | +$42,220 | 1,489 |
| partial_tp | 100% | +$20,884 | 430 |
| take_profit | 100% | +$2,100 | 57 |
| stop_loss | 7% | -$38,577 | 785 |
| time_exit | 0% | -$16,205 | 509 |

See `OPTIMIZATION_REPORT.md` for full analysis and next steps.

---

## Architecture

```
bots/
  BotRunner.js            — Paper bot runner (Hyperliquid data + PaperEngine)
  LiveBotRunner.js        — Live bot runner (Hyperliquid testnet)
  BinanceLiveBotRunner.js — Live bot runner (Binance futures testnet) ← NEW
  eth/sol/btc/xrp/bot.js  — Paper bot entry points
  live/eth/sol/btc/xrp.js — Hyperliquid live entry points
  live/binance/eth/sol/btc/xrp.js — Binance live entry points ← NEW
strategies/
  DaytradeMode.js         — THE strategy: 1H ICT + footprint confluence
  ModeRouter.js           — Routes weekday→Daytrade, weekend→Weekend
  WeekendMode.js          — Footprint only (disabled for most assets)
engine/
  PaperEngine.js          — Simulated orders, PnL, trailing stops
  HyperliquidEngine.js    — Hyperliquid testnet execution
  BinanceEngine.js        — Binance futures testnet execution ← NEW
  backtest.js             — Walk-forward backtester (UPGRADED)
  main.js                 — Legacy multi-asset trader (unused)
analysis/
  RegimeDetector.js       — Market regime classification
  ICTAnalyzer.js          — Order Blocks, FVG, OTE, Liquidity Sweeps, BOS
  RealFootprintAnalyzer.js — Order flow delta, absorption, POC
config/
  assetProfiles.js        — Per-asset intelligence + regime blocking
  config.js               — Global config
data/
  HyperliquidFeed.js      — Hyperliquid data (trade-level footprint)
  BinanceFeed.js          — Binance futures data (OHLCV via ccxt) ← NEW
  TradingViewWebhook.js   — TradingView alert webhooks
alerts/
  TelegramAlerter.js      — Telegram notifications
dashboard/
  server.js + index.html  — Web dashboard (port 3500)
```

## Three Operating Modes

1. **Paper bots** (`npm run bot:eth`) — HyperliquidFeed + PaperEngine (simulated)
2. **Hyperliquid live** (`npm run live:eth`) — HyperliquidFeed + HyperliquidEngine (testnet)
3. **Binance live** (`npm run live:binance:eth`) — BinanceFeed + BinanceEngine (testnet) ← NEW

## npm Scripts (Key)

```bash
# Backtests (Binance futures, 2022-01-01 to 2026-03-31)
npm run backtest:eth / backtest:sol / backtest:btc / backtest:xrp

# Backtests with funding rate (0.01% per 8h)
npm run backtest:eth:funding / backtest:sol:funding / backtest:btc:funding / backtest:xrp:funding

# Paper trading (Hyperliquid data, simulated orders)
npm run bot:eth / bot:sol / bot:btc / bot:xrp / bots:all

# Live on Binance futures testnet
npm run live:binance:eth / live:binance:sol / live:binance:btc / live:binance:xrp / live:binance:all

# Live on Hyperliquid testnet (legacy)
npm run live:eth / live:sol / live:btc / live:xrp / live:all

# Dashboard
npm run dashboard   # port 3500
```

## Per-Asset Regime Blocking (THE EDGE — Individual Per Asset)

| Asset | Allowed Regimes | Blocked Regimes | Personality |
|-------|----------------|-----------------|-------------|
| ETH | VOL_EXP, TRENDING_UP | RANGING, TRENDING_DOWN, LOW_VOL | 🐋 Institutional workhorse — wide stops, let trailing win |
| SOL | RANGING, VOL_EXP | TRENDING_DOWN, LOW_VOL | 🚀 Volatile rocket — tight risk, ride momentum |
| BTC | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL | 🐢 Slow giant — widest stops, fewest trades |
| XRP | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL | 🎯 Sniper — hyper-selective, half position size |

## Per-Asset Risk Profiles (Completely Individual)

| Parameter | ETH | SOL | BTC | XRP |
|-----------|-----|-----|-----|-----|
| slMultiplier | 1.5x | 1.0x | 1.5x | 1.3x |
| trailActivation | 1.2 ATR | 0.9 ATR | 1.2 ATR | 1.0 ATR |
| trailDistance | 0.7 ATR | 0.5 ATR | 0.7 ATR | 0.5 ATR |
| breakevenActivation | 0.8 ATR | 0.6 ATR | 0.8 ATR | 0.7 ATR |
| riskMultiplier | 0.9x | 0.8x | 1.0x | 0.5x |
| minConfluenceScore | 0.65 | 0.58 | 0.62 | 0.82 |
| minSoloScore | 0.78 | 0.72 | 0.78 | 0.90 |
| signalCooldown | 2h | 2h | 2h | 4h |
| ictWeight / fpWeight | 0.35/0.65 | 0.25/0.75 | 0.4/0.6 | 0.3/0.7 |

## Key Design Decisions

1. **Per-asset regime blocking** — the real edge
2. **ICT on 1H only** — 15m FVG had 24% WR
3. **TRENDING_DOWN blocked globally** — 41% WR
4. **Tight stops (0.5x ATR)** — brought avg loss closer to avg win
5. **No weekends** — overtrading, no edge (for daytrade mode)
6. **Smart time_exit** — only exits if loss > 0.5x ATR after 4h
7. **Independent bots** — no shared state between assets
8. **Trailing stops** — 100% WR across all assets when activated
9. **Partial TP** — 50% closed at 1.5x ATR, rest trails

## Backtest Upgrades (Session #3)

- Year-by-year PnL breakdown
- Monthly return distribution (median, best/worst, profitable months %)
- Regime time distribution (% of candles in each regime)
- Funding rate impact estimation (`--funding` flag)
- Single trade dependency check (PnL without largest win)
- DD/Return ratio
- Robustness checks section

## Environment Setup

`.env` file needed with:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
HYPERLIQUID_PRIVATE_KEY=0x...     # for Hyperliquid testnet
BINANCE_API_KEY=...               # for Binance futures testnet ← NEW
BINANCE_API_SECRET=...            # for Binance futures testnet ← NEW
WEBHOOK_SECRET=paper-trader-local
```

---

## TODO / Next Session

### STEP 1 — Optimize Based on Futures Results (IMMEDIATE)
- [x] **Full precompute refactor** — engine/Precompute.js + rewritten backtest.js v3.0
- [x] **Per-asset signal thresholds** — 1 TH per bot in assetProfiles.js
- [x] **Calibrated precompute confidence** — OB/sweep/OTE confidence recalibrated
- [x] **First full futures backtest** — 2022-2026 Binance futures, all 4 assets
- [ ] **Analyze 2022 vs 2023-2026 divergence** — why did 2022 work but later years didn't?
- [ ] **Reduce overtrading** — raise thresholds, add longer cooldown, or regime-specific cooldown
- [ ] **Fix SL placement** — current 0.5x ATR stops get eaten by noise on futures
- [ ] **Block RANGING for ETH** — -$1,869 in RANGING, should be blocked like BTC/XRP
- [ ] **Fee optimization** — $37K in fees is unsustainable. Consider maker orders or fee-aware sizing

### STEP 2 — Walk-Forward Analysis (after parameter tuning)
Rolling 12-month train / 3-month OOS test:
```
Window 1: Train Jan-Dec 2022 | OOS: Jan-Mar 2023
Window 2: Train Apr 2022 - Mar 2023 | OOS: Apr-Jun 2023
...continues until today
```
Parameters to optimize per window:
- `blockedRegimes` per asset
- `slTightness` / `riskMultiplier` per asset
- `minConfluenceScore` / `minSoloScore` per asset (THE new lever)
- `trailingStop.activationATR` / `trailATR`

### Setup
- [ ] User needs Binance testnet API keys for live trading

---

## Session History

### Session #1 — 2026-03-30
- Cloned repo, ran npm install, got backtests working (Jan-May 2025 SPOT)
- Analyzed ETH results, built Hyperliquid testnet integration
- Created LiveBotRunner, HyperliquidEngine, live/ entry points

### Session #2 — 2026-03-31 (early AM)
- Found backtests were on Binance SPOT not FUTURES
- Changed backtest symbols to futures format
- Created PROJECT_CONTEXT.md

### Session #3 — 2026-03-31
- Created BinanceFeed.js, BinanceEngine.js, BinanceLiveBotRunner.js
- Created live/binance/ entry points for all 4 assets
- Major backtest upgrades (year-by-year, monthly, funding, regime dist, robustness checks)
- Updated package.json, config.js
- Pushed everything to GitHub
- Started ETH backtest — too slow, killed it

### Session #4 — 2026-03-31
- Deep-read entire codebase (32 files)
- Attempted ETH futures backtest — failed: O(n²) filtering bottleneck
- **Fixed backtest.js**: incremental index tracking instead of .filter() (NOT YET TESTED)
- Defined 10 statistical rigor criteria for backtest validation
- Established walk-forward analysis plan (12-month train / 3-month OOS)
- Execution order: baseline backtests → analyze → build WFA → run WFA
- See SESSION_NOTES_2026-03-31.txt for full details

### Session #5 — 2026-03-31
- Applied Round 2 optimization: cached windows on 1h boundaries only
- Still too slow — analyzers recomputed from scratch each iteration
- Pushed changes to GitHub

### Session #6 — 2026-03-31
- **MAJOR: Full precomputed O(n) architecture refactor**
- Created engine/Precompute.js with all indicators precomputed
- Rewrote engine/backtest.js v3.0 — 3-layer architecture
- Updated all 3 analyzers to support dual-mode (precomputed + live)
- Performance target: O(n) total instead of O(n²)

### Session #7 — 2026-04-02
- **Per-asset signal thresholds** — each of 4 bots gets own minConfluenceScore / minSoloScore in assetProfiles.js
- BTC: 0.55/0.70, ETH: 0.60/0.75, SOL: 0.52/0.68, XRP: 0.62/0.78
- Fixed precomputed confidence calibration (OB/sweep/OTE were producing 0.04-0.55 instead of 0.5-1.0)
- Fixed backtest scoring: normalize combinedScore by source weight so precomputed and live use same scale
- **First successful full futures backtest** — 4 years, all 4 assets, 5225 total trades
- Results: -$2,979 total PnL, $37K in fees. System overtrades, SL too tight for futures.
- Key insight: trailing stops (100% WR) are the real edge, regular SL (7-14% WR) are noise traps
- Key insight: RANGING regime is toxic on futures (blocked for BTC/XRP but not ETH)
- Pushed all changes to GitHub
