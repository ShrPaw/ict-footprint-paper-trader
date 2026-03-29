# ICT + Footprint Paper Trader

Regime-adaptive paper trading engine for crypto perpetuals. ICT concepts on higher timeframes (1H) where they actually work.

**v1.2.0** — 4 independent bots, per-asset regime filtering.

## Validated Results (Jan-May 2025, Binance)

| Asset | PnL | PF | WR | Trades | Max DD | Sharpe | Regime Edge |
|-------|-----|-----|-----|--------|--------|--------|-------------|
| **ETH** | **+$684** | **1.52** | **59.3%** | 54 | 3.5% | 1.18 | RANGING + VOL_EXP |
| **SOL** | **+$1,426** | **1.72** | **59.7%** | 77 | 5.5% | 1.71 | RANGING only |
| **BTC** | **+$317** | **1.53** | **65.4%** | 26 | 2.9% | 0.85 | VOL_EXPANSION only |
| **XRP** | **+$1,242** | **2.27** | **65.9%** | 44 | 4.1% | 2.57 | VOL_EXPANSION only |
| **Total** | **+$3,669** | **~1.75** | **61.8%** | 201 | — | — | |

**~40 trades/month combined. $18 expectancy per trade after fees.**

## Per-Bot Architecture

Each asset runs as an independent bot with its own engine, analyzers, and config. No shared state.

```bash
npm run bot:eth     # ETH bot (port 3451)
npm run bot:sol     # SOL bot (port 3452)
npm run bot:btc     # BTC bot (port 3453)
npm run bot:xrp     # XRP bot (port 3454)
npm run bots:all    # All 4 bots
```

### Per-Asset Regime Filtering

| Asset | RANGING | VOL_EXPANSION | TRENDING_DOWN | LOW_VOL |
|-------|---------|---------------|---------------|---------|
| ETH | ✅ +$334 | ✅ +$350 | ❌ blocked | ❌ blocked |
| SOL | ✅ +$1,397 | ✅ +$29 | ❌ blocked | ❌ blocked |
| BTC | ❌ **blocked** (-$728) | ✅ +$317 | ❌ blocked | ❌ blocked |
| XRP | ❌ **blocked** (-$282) | ✅ +$1,242 | ❌ blocked | ❌ blocked |

**Key insight:** BTC and XRP are the inverse of SOL. They thrive in volatility, die in ranging.

## How It Works

The system trades **only in favorable regimes** (per asset):
- Each asset's `blockedRegimes` in `config/assetProfiles.js` filters out losing regimes
- Entry requires ICT + Footprint signal confluence on 1H candles
- Trailing stops (100% WR across all assets) + partial TP lock in profits

**Strategy:** ICT concepts (Order Blocks, OTE, Liquidity Sweeps) on 1H candles with EMA alignment filter.

## Quick Start

```bash
npm install
cp .env.example .env

# Backtest per asset
npm run backtest:eth
npm run backtest:sol
npm run backtest:btc
npm run backtest:xrp

# Live paper trading (needs Telegram creds in .env)
npm run bot:eth    # single bot
npm run bots:all   # all 4
```

## Configuration

### `config/assetProfiles.js`
- `blockedRegimes` — per-asset regime blacklist (the edge)
- `riskMultiplier` — per-asset risk scaling
- `slTightness` — per-asset stop loss width
- `daytrade.ictWeight / footprintWeight` — signal balance

### `config.js`
- `symbols` — all 4 assets
- `risk.*` — per-regime SL/TP multipliers
- `strategy.*` — confluence scoring, entry confirmation

## Architecture

```
bots/
  BotRunner.js          — Shared bot runner (per-asset config)
  eth/bot.js            — ETH entry point
  sol/bot.js            — SOL entry point
  btc/bot.js            — BTC entry point (research mode)
  xrp/bot.js            — XRP entry point (research mode)
strategies/
  DaytradeMode.js       — 1H ICT + trend (THE strategy)
  ModeRouter.js         — Routes to daytrade
  WeekendMode.js        — Footprint (disabled)
  ScalpingProMode.js    — 15m hybrid (disabled)
engine/
  main.js               — Legacy multi-asset trader
  PaperEngine.js        — Orders, PnL, trailing stops
  backtest.js           — Historical backtester
analysis/
  RegimeDetector.js     — Market regime classification
  ICTAnalyzer.js        — Order Blocks, OTE, Liquidity Sweeps
  RealFootprintAnalyzer.js — Order flow delta, absorption, POC
config/
  assetProfiles.js      — Per-asset intelligence + regime filters
data/
  HyperliquidFeed.js    — Real-time candles + trade-level footprint
```

## Key Design Decisions

1. **Per-asset regime blocking** — The real edge. BTC/XRP block RANGING, SOL works best in RANGING.
2. **ICT on 1H only** — 15m FVG had 24% WR. Higher TF = clean signals.
3. **TRENDING_DOWN blocked globally** — 41% WR across all assets. Always negative.
4. **Tight stops (0.5x ATR)** — Brought avg loss closer to avg win.
5. **No weekends** — Overtrading. No edge.
6. **Smart time_exit** — Only exits if loss > 0.5x ATR after 4h. Eliminated 0% WR premature exits.
7. **Independent bots** — No shared state. Each bot runs its own engine + analyzers.

## Known Limitations

- Jul-Nov 2024 bull run period loses (system sits out strong trends)
- 201 trades over 5 months — moderate sample size
- BTC/XRP only validated in VOL_EXPANSION — fragile if market shifts to ranging
- No live execution validation yet

## Telegram Setup

1. [@BotFather](https://t.me/BotFather) → `/newbot` → get token
2. Get chat ID: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Set in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=987654321
   ```

## License

MIT
