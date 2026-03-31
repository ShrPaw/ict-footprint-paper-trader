# PROJECT_CONTEXT.md — ICT Footprint Paper Trader

**Last updated:** 2026-03-31 10:37 GMT+8
**Session:** #6 (2026-03-31)

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

## Per-Asset Regime Blocking (THE EDGE)

| Asset | Allowed Regimes | Blocked Regimes |
|-------|----------------|-----------------|
| ETH | RANGING, VOL_EXP, TRENDING_UP | TRENDING_DOWN, LOW_VOL |
| SOL | RANGING, VOL_EXP | TRENDING_DOWN, LOW_VOL |
| BTC | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL |
| XRP | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL |

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

### STEP 1 — Run Baseline Backtests (IMMEDIATE — NOW POSSIBLE)
- [x] **Full precompute refactor** — engine/Precompute.js + rewritten backtest.js v3.0
  - All indicators computed once in O(n), loop is pure O(1) lookups
  - Should complete in seconds instead of hours
- [ ] Run `npm run backtest:eth` — verify refactor works and results match v2
- [ ] Run all 4 backtests on Binance FUTURES (2022-01-01 → 2026-03-31):
  - `npm run backtest:eth`
  - `npm run backtest:sol`
  - `npm run backtest:btc`
  - `npm run backtest:xrp`
- [ ] Run funding rate variants for all 4:
  - `npm run backtest:eth:funding` (etc.)
- [ ] Compare results against old Jan-May 2025 SPOT results to validate correctness

### STEP 2 — Analyze Against Statistical Rigor Criteria
10 criteria defined by Nicolas (see SESSION_NOTES_2026-03-31.txt for full detail):
- [ ] Year-by-year PnL (2022 bear, 2023 grind, 2024 bull, 2025-26 chop)
- [ ] Regime distribution (% time each regime active per asset)
- [ ] Monthly return distribution (median, best/worst, profitable %)
- [ ] Consecutive loss streaks
- [ ] With/without funding rates comparison
- [ ] Single trade dependency (pnlWithoutLargest — already coded)
- [ ] DD/Return ratio (max DD < 50% of total return)
- [ ] Stability across assets (any single asset carrying the system?)
- [ ] Consistent WR across time periods
- [ ] Expectancy > $0 after all realistic costs

### STEP 3 — Walk-Forward Analysis (after baseline results)
Rolling 12-month train / 3-month OOS test:
```
Window 1: Train Jan-Dec 2022 | OOS: Jan-Mar 2023
Window 2: Train Apr 2022 - Mar 2023 | OOS: Apr-Jun 2023
...continues until today
```
Parameters to optimize per window:
- `blockedRegimes` per asset (THE edge)
- `slTightness` / `riskMultiplier` per asset
- `minConfluenceScore` / `ictWeight` / `footprintWeight`
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
