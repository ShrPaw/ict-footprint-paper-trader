# ICT + Footprint Paper Trader

Regime-adaptive paper trading engine for crypto perpetuals. ICT concepts on higher timeframes (1H) where they actually work.

**v1.1.0** — Validated: PF 1.67, +$2,115 over 5 months (ETH + SOL).

## Validated Results (Jan-May 2025)

| Asset | PnL | Profit Factor | Win Rate | Max DD |
|-------|-----|---------------|----------|--------|
| **ETH** | **+$790** | **1.65** | **59.3%** | **3.2%** |
| **SOL** | **+$1,325** | **1.68** | **56.4%** | **6.6%** |

**~26 trades/month. $16 expectancy per trade after fees.**

## How It Works

The system trades **only in favorable regimes**:
- ✅ **RANGING** — Primary edge (61% WR, +$1,762 combined)
- ✅ **VOL_EXPANSION** — Secondary edge (55% WR, +$353)
- ❌ TRENDING_DOWN — Blocked (41% WR, always negative)
- ❌ LOW_VOL — Blocked (no momentum)

**Strategy:** ICT concepts (Order Blocks, OTE, Liquidity Sweeps) on 1H candles with EMA alignment filter. Entry requires confluence of ICT + Footprint signals.

**Assets:** ETH + SOL only. BTC and XRP have no validated edge.

## Quick Start

```bash
npm install
cp .env.example .env

# Backtest (5-month validation)
node engine/backtest.js --exchange binance --from 2025-01-01 --to 2025-05-01 --verbose

# Single asset
node engine/backtest.js --exchange binance --symbol ETH/USDT --from 2025-01-01 --to 2025-05-01 --verbose

# Live paper trading (needs Telegram creds in .env)
npm start
```

## Configuration

### `config.js`
- `symbols` — ETH/USDT, SOL/USDT (validated edge)
- `risk.*` — Per-regime SL/TP multipliers (tight 0.5x SL)
- `strategy.*` — Confluence scoring, entry confirmation

### `config/assetProfiles.js`
- Per-asset volatility, trend behavior, session weights
- ADX thresholds, ICT/Footprint weight balancing
- Weekend enabled/disabled per asset

## Architecture

```
strategies/
  DaytradeMode.js      — 1H ICT + trend (THE strategy)
  ModeRouter.js        — Routes to daytrade (weekends disabled)
engine/
  main.js              — Live paper trader
  PaperEngine.js       — Orders, PnL, trailing stops
  backtest.js          — Historical backtester with regime breakdowns
analysis/
  RegimeDetector.js    — RANGING/VOL_EXPANSION/TRENDING classification
  ICTAnalyzer.js       — Order Blocks, OTE, Liquidity Sweeps
  RealFootprintAnalyzer.js — Order flow delta, absorption, POC
data/
  HyperliquidFeed.js   — Real-time candles + trade-level footprint
```

## Key Design Decisions

1. **ICT on 1H only** — 15m FVG had 24% WR, OB had 18%. Higher TF = clean signals.
2. **TRENDING_DOWN blocked** — 41-42% WR across both assets. Always negative.
3. **Tight stops (0.5x ATR)** — Brought avg loss closer to avg win.
4. **No weekends** — Overtrading (504 trades/quarter). No edge.
5. **No scalping** — 15m had 44% WR. No edge at low timeframes.
6. **BTC/XRP excluded** — PF 0.61 and 0.85. No edge in any regime.

## Known Limitations

- Jul-Nov 2024 bull run period loses (system sits out strong trends)
- 132 trades over 5 months — moderate sample size
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
