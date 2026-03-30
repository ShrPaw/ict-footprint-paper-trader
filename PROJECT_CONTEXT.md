# PROJECT_CONTEXT.md — ICT Footprint Paper Trader

**Last updated:** 2026-03-31 03:13 GMT+8
**Session:** #2 (2026-03-30 night → 2026-03-31 early morning)

---

## What This Is

A **regime-adaptive paper trading engine** for crypto perpetuals (ETH, SOL, BTC, XRP). Combines **ICT concepts** (Order Blocks, OTE, Liquidity Sweeps) on 1H timeframes with **real-time order flow (footprint) analysis** from Hyperliquid.

**Version:** 1.2.0
**Language:** JavaScript (ESM, Node.js 22)
**Repo:** `https://github.com/ShrPaw/ict-footprint-paper-trader` (private)
**Owner:** Nicolas (Windows user, Spanish)

---

## Validated Results (Jan-May 2025, Binance SPOT — ⚠️ SEE BACKTEST NOTE)

| Asset | PnL | PF | WR | Trades | Max DD | Sharpe | Best Regime |
|-------|-----|-----|-----|--------|--------|--------|-------------|
| ETH | +$684 | 1.52 | 59.3% | 54 | 3.5% | 1.18 | RANGING + VOL_EXP |
| SOL | +$1,426 | 1.72 | 59.7% | 77 | 5.5% | 1.71 | RANGING only |
| BTC | +$317 | 1.53 | 65.4% | 26 | 2.9% | 0.85 | VOL_EXP only |
| XRP | +$1,242 | 2.27 | 65.9% | 44 | 4.1% | 2.57 | VOL_EXP only |
| **Total** | **+$3,669** | **~1.75** | **61.8%** | **201** | | | ~40 trades/month |

---

## Architecture

```
bots/
  BotRunner.js          — Shared paper bot runner (per-asset config)
  LiveBotRunner.js      — Live bot runner (Hyperliquid testnet)
  eth/bot.js            — ETH paper entry point
  sol/bot.js            — SOL paper entry point
  btc/bot.js            — BTC paper entry point
  xrp/bot.js            — XRP paper entry point
  live/eth.js           — ETH live entry point
  live/sol.js           — SOL live entry point
  live/btc.js           — BTC live entry point
  live/xrp.js           — XRP live entry point
strategies/
  DaytradeMode.js       — THE strategy: 1H ICT + footprint confluence
  ModeRouter.js         — Routes weekday→Daytrade, weekend→Weekend
  WeekendMode.js        — Footprint only (disabled for most assets)
engine/
  PaperEngine.js        — Simulated orders, PnL, trailing stops
  HyperliquidEngine.js  — Real orders on Hyperliquid testnet via ccxt
  backtest.js           — Walk-forward backtester
  main.js               — Legacy multi-asset trader (unused)
analysis/
  RegimeDetector.js     — Market regime: TRENDING_UP/DOWN, RANGING, VOL_EXP, LOW_VOL
  ICTAnalyzer.js        — Order Blocks, FVG, OTE, Liquidity Sweeps, BOS
  RealFootprintAnalyzer.js — Order flow delta, absorption, POC, volume shelf
config/
  assetProfiles.js      — Per-asset intelligence + regime blocking (THE EDGE)
  config.js             — Global config: risk, strategy, engine params
data/
  HyperliquidFeed.js    — Real-time candles + trade-level footprint from Hyperliquid
  TradingViewWebhook.js — Accepts TradingView alert webhooks
alerts/
  TelegramAlerter.js    — Telegram notifications (entries, exits, regime changes)
dashboard/
  server.js             — HTTP API server (port 3500)
  index.html            — Web dashboard
```

## Two Operating Modes

1. **Paper bots** (`npm run bot:eth`, etc.) — `PaperEngine` simulates orders locally
2. **Live bots** (`npm run live:eth`, etc.) — `HyperliquidEngine` executes real orders on Hyperliquid **testnet** (fake money)

Both use `HyperliquidFeed` for real-time data (free, no auth needed for market data).

## npm Scripts

```bash
# Paper trading
npm run bot:eth / bot:sol / bot:btc / bot:xrp / bots:all

# Live on Hyperliquid testnet
npm run live:eth / live:sol / live:btc / live:xrp / live:all

# Backtesting (Binance futures perps, since 2020-09)
npm run backtest:eth / backtest:sol / backtest:btc / backtest:xrp / backtest:all

# Dashboard
npm run dashboard   # port 3500

# PM2
npm run pm2:start / pm2:stop / pm2:logs
```

## Per-Asset Regime Blocking (THE EDGE)

| Asset | Allowed Regimes | Blocked Regimes |
|-------|----------------|-----------------|
| ETH | RANGING, VOL_EXP, TRENDING_UP | TRENDING_DOWN, LOW_VOL |
| SOL | RANGING, VOL_EXP | TRENDING_DOWN, LOW_VOL |
| BTC | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL |
| XRP | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL |

Globally blocked: TRENDING_DOWN (41% WR across all), LOW_VOL.

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

## Environment Setup

`.env` file needed with:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
HYPERLIQUID_PRIVATE_KEY=0x...   # for live testnet trading
WEBHOOK_SECRET=paper-trader-local
```

## Deployment

`deploy.sh` — installs Node 22, PM2, clones repo, starts bots. For Ubuntu/Debian VPS.
PM2 config in `ecosystem.config.cjs` — dashboard + 4 bots.

---

## Session History

### Session #1 — 2026-03-30
- Cloned repo, ran npm install, got backtests working
- Analyzed ETH backtest (Jan-May 2025): +$510.56, 59.3% WR
- Built Hyperliquid testnet integration (`HyperliquidEngine.js`, `LiveBotRunner.js`)
- Added `live:*` scripts to package.json
- All 4 paper bots ran briefly — all in LOW_VOL, no trades
- **Security warning:** GitHub PAT was exposed in chat — user should revoke it

### Session #2 — 2026-03-31 (current)
- Read full codebase for deep understanding
- **CRITICAL FINDING:** Backtests were run on Binance **SPOT** (`ETH/USDT`) not **FUTURES** (`ETH/USDT:USDT`)
  - Spot ≠ perp prices, no funding rate consideration
  - Backtested results are unreliable for perp trading
- Changed backtest symbols to futures format + extended date range
- Tested exchanges: Binance has full perp history (SOL from 2020-09), Bybit/OKX don't work via ccxt
- Started 6-year backtest on ETH — decided it was too slow, cancelled
- Created this PROJECT_CONTEXT.md for session continuity

## TODO / Next Session

- [ ] Re-run ALL 4 backtests on Binance **FUTURES** data (2022-01-01 is plenty, ~4 years)
- [ ] Compare futures backtest results vs old spot results — check if edge holds
- [ ] Check if regime blocking still works on futures data
- [ ] Consider if funding rates need to be factored in
- [ ] User needs to set up Hyperliquid testnet wallet for live trading
- [ ] Revoke the exposed GitHub PAT and generate a new one
- [ ] Consider extending backtest to more recent data (beyond May 2025)

---

## How To Use This File

At the start of each session, read this file first. It contains everything needed to continue working without re-explaining the project. Update it at the end of each session with what happened and what's next.
