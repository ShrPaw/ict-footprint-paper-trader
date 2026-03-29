# PROJECT CONTEXT — ICT + Footprint Paper Trader
# Last updated: 2026-03-29
# Session summary: full code review, bug fixes, 4-asset validation, bot architecture, dashboard

## WHAT THIS IS

A regime-adaptive paper trading engine for crypto perpetuals (ETH, SOL, BTC, XRP).
Uses ICT (Inner Circle Trader) concepts on 1H candles combined with order flow footprint analysis.
Built in Node.js with CCXT. Trades on Hyperliquid (live) and backtests on Binance (historical data).

Paper trading only — no real money at risk. Generates signals, tracks virtual PnL.

## CURRENT VERSION: v1.2.2

## VALIDATED RESULTS (Jan-May 2025, Binance backtest)

| Asset | PnL    | PF   | WR    | Trades | Max DD | Sharpe | Regime Edge           |
|-------|--------|------|-------|--------|--------|--------|-----------------------|
| ETH   | +$684  | 1.52 | 59.3% | 54     | 3.5%   | 1.18   | RANGING + VOL_EXP     |
| SOL   | +$1,426| 1.72 | 59.7% | 77     | 5.5%   | 1.71   | RANGING only          |
| BTC   | +$317  | 1.53 | 65.4% | 26     | 2.9%   | 0.85   | VOL_EXPANSION only    |
| XRP   | +$1,242| 2.27 | 65.9% | 44     | 4.1%   | 2.57   | VOL_EXPANSION only    |
| Total | +$3,669| ~1.75| 61.8% | 201    | —      | —      |                       |

Key insight: BTC and XRP are the INVERSE of SOL. They thrive in VOL_EXPANSION, die in RANGING.
SOL thrives in RANGING, breakeven in VOL_EXPANSION. ETH works in both.

## WHAT WE DID IN THIS SESSION (2026-03-29)

### 1. Full Code Review
- Read every file in the repo (15+ source files)
- Identified architecture: ModeRouter → DaytradeMode → ICTAnalyzer + RealFootprintAnalyzer
- Found bugs: shared ICTAnalyzer state, premature time_exit, no per-asset regime filtering

### 2. Bug Fixes
- **Shared ICTAnalyzer state**: Backtester shared one ICTAnalyzer across all symbols, contaminating signals.
  Fix: reset analyzers per symbol in backtest.js loop.
- **Smart time_exit**: Old time_exit at 4h if ANY loss → 0% WR, pure losses.
  Fix: only exit if loss > 0.5x ATR after 4h. Eliminated premature exits.
- **HyperliquidFeed symbol override**: Added `symbolsOverride` so per-bot instances only poll their symbol.

### 3. Per-Asset Regime Discovery (THE BIG FIND)
- Ran BTC and XRP backtests, discovered regime-specific edges:
  - BTC: VOL_EXPANSION 65% WR (+$292), RANGING 37% WR (-$727)
  - XRP: VOL_EXPANSION 66% WR (+$1,218), RANGING 54% WR (-$281)
- Added `blockedRegimes` per asset in config/assetProfiles.js:
  - BTC: blockedRegimes: ['RANGING']
  - XRP: blockedRegimes: ['RANGING']
  - SOL: no blocked regimes (thrives in RANGING)
  - ETH: no blocked regimes (works everywhere)
- DaytradeMode.js checks `profile.blockedRegimes?.includes(regime)` before generating signals

### 4. Per-Bot Architecture
- Created bots/BotRunner.js — shared runner class, each bot gets own engine/analyzers/feed
- Created 4 entry points: bots/{eth,sol,btc,xrp}/bot.js
- Each bot: independent config, own port for webhook, own starting balance (BTC/XRP: $5k research)
- npm scripts: npm run bot:eth, bot:sol, bot:btc, bot:xrp, bots:all

### 5. Web Dashboard
- dashboard/server.js — lightweight HTTP API, no dependencies
- dashboard/index.html — dark-themed SPA, auto-refresh every 3s
- Shows: balance, PnL, win rate, regime, open positions, trade log per bot
- Totals bar across all 4 bots
- BotRunner POSTs status every 3s, reports trades on close
- Accessible from any browser/phone at SERVER-IP:3500

### 6. Deployment
- ecosystem.config.cjs — PM2 config, one command starts dashboard + 4 bots
- deploy.sh — fresh VPS setup script (Node 22, PM2, clone, start)
- User needs a VPS. Oracle Cloud free tier not available in Bolivia (user's country).
- User considering registering with different country or using Railway ($5/mo).

## ARCHITECTURE

```
bots/
  BotRunner.js          — Shared bot runner (per-asset config, dashboard reporting)
  eth/bot.js            — ETH entry point (port 3451)
  sol/bot.js            — SOL entry point (port 3452)
  btc/bot.js            — BTC entry point (port 3453, $5k balance, research mode)
  xrp/bot.js            — XRP entry point (port 3454, $5k balance, research mode)
dashboard/
  server.js             — Dashboard API server (port 3500)
  index.html            — Web UI
engine/
  main.js               — Legacy multi-asset trader (not used with bots)
  PaperEngine.js        — Orders, PnL, trailing stops, partial TP, time_exit
  backtest.js           — Historical backtester with regime/signal/exit breakdowns
strategies/
  DaytradeMode.js       — THE strategy: 1H ICT + trend + footprint confluence
  ModeRouter.js         — Routes to daytrade (weekend/scalping disabled)
  WeekendMode.js        — Disabled (overtrading)
  ScalpingProMode.js    — Disabled (no edge on 15m)
analysis/
  RegimeDetector.js     — TRENDING_UP/DOWN, RANGING, VOL_EXPANSION, LOW_VOL, ABSORPTION
  ICTAnalyzer.js        — FVG, Order Blocks, OTE, Liquidity Sweeps, BOS
  RealFootprintAnalyzer.js — Delta divergence, absorption, POC, stacked imbalance
  FootprintAnalyzer.js  — Estimated footprint (legacy, not used by daytrade)
config/
  assetProfiles.js      — Per-asset intelligence: blockedRegimes, risk, SL tightness, weights
config.js               — Master config: symbols, risk params, ICT params, engine settings
data/
  HyperliquidFeed.js    — Real-time candles + trade-level footprint from Hyperliquid API
  DataFeed.js           — CCXT fallback (not used)
  TradingViewWebhook.js — External signal receiver
alerts/
  TelegramAlerter.js    — Telegram notifications (entries, exits, regime changes, daily summary)
```

## HOW TO RUN

```bash
# Install
npm install
cp .env.example .env
# Edit .env with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID

# Backtest per asset
npm run backtest:eth
npm run backtest:sol
npm run backtest:btc
npm run backtest:xrp

# Run single bot
npm run bot:eth

# Run all bots + dashboard (development)
npm run dashboard & npm run bots:all

# Run with PM2 (production)
npm run pm2:start
pm2 logs
pm2 monit
```

## NEXT STEPS

### Priority 1: Deploy to VPS
- User needs to set up a server (Oracle Cloud with different country, or Railway)
- Once server is up: bash deploy.sh, edit .env, done
- Dashboard at SERVER-IP:3500

### Priority 2: Validate Edge Robustness
- Test on Q3-Q4 2024 (different market conditions — known to lose for ETH/SOL)
- Test on 2023 data if available
- Walk-forward optimization (train on 3mo, test on next 1mo)
- Monte Carlo simulation on trade sequence (shuffle 201 trades 10k times)

### Priority 3: Enhance BTC and XRP
- BTC: only 26 trades in VOL_EXP — small sample. Test different ADX thresholds.
- XRP: PF 2.27 is great but only 44 trades. Need more data periods.
- Try different ICT/Footprint weight ratios for BTC/XRP
- BTC might benefit from trend-following in TRENDING_UP (was disabled)
- Consider pure VOL_EXP strategies (skip ICT, just footprint)

### Priority 4: Fix Remaining Bugs
- RegimeDetector uses simplified ADX (not Wilder's smoothing) — values are off
- FootprintAnalyzer estimated delta is crude (close position = buy/sell ratio)
- RealFootprintAnalyzer's estimated fallback is same crude method
- These matter because footprint is weighted at 0.6-0.75 of signal score

### Priority 5: Dashboard Enhancements
- Add equity curve chart (SVG, no dependencies)
- Add start/stop/restart buttons per bot (needs PM2 API integration)
- Add regime change notifications
- Add trade history with filtering

### Priority 6: Live Paper Trading Validation
- Run on VPS for 2 weeks
- Compare live results vs backtest
- Track slippage and execution quality
- Monitor Hyperliquid API reliability

### Code Quality
- Add unit tests for RegimeDetector
- Add signal consistency tests (same input → same output)
- Clean up unused WeekendMode/ScalpingProMode code
- Add logging levels (debug/info/warn)

## KNOWN LIMITATIONS

- Jul-Nov 2024 bull run period loses (PF 0.69 ETH, 0.96 SOL)
- 201 trades over 5 months — moderate sample size
- BTC/XRP only validated in VOL_EXPANSION — fragile if market shifts to ranging
- No live execution validation yet
- Hyperliquid uses polling (3s interval) not WebSocket — trade-level data has gaps
- Entry confirmation (pin bars, engulfing) disabled on 1H — too rare

## GIT HISTORY (recent)

- c77f69c v1.2.2: PM2 config + one-click deploy script
- 101cd62 v1.2.1: Web dashboard for live bot monitoring
- 99ef521 v1.2.0: Per-asset bot architecture + regime filtering
- 7ad20d7 v1.1.0: README + DevLog updated with validated results (previous session)
