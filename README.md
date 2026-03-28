# ICT + Footprint Paper Trader

Regime-adaptive paper trading engine combining ICT (Inner Circle Trader) concepts with order flow footprint analysis for crypto perpetuals.

## Features

### 🔍 Analysis Engines
- **ICT Analyzer** — FVGs, Order Blocks, Liquidity Sweeps, BOS, OTE zones (auto-pruned, deduped)
- **Footprint Analyzer** — Delta estimation, Volume Profile, POC reactions, Absorption detection (rolling window)
- **Regime Detector** — Trending, Ranging, Vol Expansion, Low Vol, Absorption (ADX + ATR + Bollinger)

### 🎯 Strategy: Confluence Sniper
- **Entry Confirmation** — ICT zones tell WHERE; candle patterns confirm WHEN:
  - Pin bars (long wick rejection)
  - Engulfing (full body reversal)
  - Inside bar breakouts (consolidation → expansion)
- **Confluence Gate** — ICT + Footprint must agree on direction (or exceptional solo score)
- **Signal Demotions** — ORDER_BLOCK and FVG penalized (data-driven: 18% and 24% WR respectively)
- **DELTA_DIVERGENCE boost** — only consistently profitable footprint signal (38% WR)

### 📅 Weekend Mode
- Killzones excluded (no institutional sessions on weekends)
- Higher confluence threshold (more confirmation needed)
- Half position risk (thinner books = more slippage)
- Wider stop losses (weekend candles are more violent)

### 📊 Paper Engine
- Realistic simulation: slippage, maker/taker fees, 10x leverage margin
- **Trailing stops** — activate after 2x ATR in profit, trail by 0.5x ATR (100% WR on winners)
- **Breakeven disabled** — data showed it killed $218 in potential profit (trailing handles everything)
- Regime-adaptive risk sizing (different risk% per regime)
- Max open positions & daily loss limits

### 📱 Telegram Alerts
Real-time notifications for:
- 🎯 **Entries** — symbol, side, entry, SL, TP, regime, signal, entry pattern
- ✅ **Exits** — PnL, exit reason (TP/SL/trailing/BE/time), duration
- 📊 **Regime changes** — when market regime shifts
- 📈 **Daily summary** — balance, PnL, win rate, trades
- 🚀 **Startup/Shutdown** — bot lifecycle

### 📈 Backtest Engine
- Walk-forward backtesting with historical candles
- Equity curve tracking, max drawdown calculation
- **Performance metrics**: Sharpe, Sortino, Profit Factor, Expectancy
- **Breakdowns**: by regime, signal type, exit reason, **entry pattern**, **weekend vs weekday**
- CSV export: trades, equity curve, stats JSON

## Quick Start

```bash
# Install dependencies
npm install

# Copy env template
cp .env.example .env

# Configure Telegram (edit .env)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Run live paper trader
npm start

# Run backtest (Binance for historical data)
node engine/backtest.js --exchange binance --symbol SOL/USDT --timeframe 15m --from 2025-01-01 --to 2025-03-01 --verbose

# Backtest with custom balance
node engine/backtest.js --balance 50000 --verbose
```

## Configuration (`config.js`)

| Setting | Default | Description |
|---------|---------|-------------|
| `symbols` | SOL/USDT, XRP/USDT | Trading pairs |
| `data.exchange` | `mexc` | CCXT exchange |
| `engine.startingBalance` | 10000 | Paper balance |
| `engine.trailingStop.enabled` | true | Enable trailing stops |
| `engine.breakeven.enabled` | false | BE disabled — trailing handles winners |
| `strategy.minConfluenceScore` | 0.55 | Min score for confluence entry |
| `strategy.entryConfirmation.enabled` | true | Require candle pattern at ICT zone |
| `strategy.orderBlockPenalty` | 0.5 | OB signal score multiplier |
| `weekend.enabled` | true | Weekend mode (killzone exclusion, reduced risk) |
| `risk.*.riskPercent` | 0.25-1.0 | Risk per regime |

## Telegram Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → get token
2. Message your bot → `/start`
3. Get your chat ID: visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Set in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=987654321
   ```

## Architecture

```
engine/
  main.js           — Live paper trader (orchestrator) v0.4
  PaperEngine.js    — Order management, PnL, trailing stops
  backtest.js       — Historical backtester with metrics, weekend/pattern breakdowns
data/
  DataFeed.js       — CCXT exchange data (polling)
  TradingViewWebhook.js — TradingView alert receiver
analysis/
  RegimeDetector.js — Market regime classification
  ICTAnalyzer.js    — ICT concept detection (pruned, deduped, incremental)
  FootprintAnalyzer.js — Order flow analysis (rolling window)
strategies/
  StrategyEngine.js — Confluence scoring, entry confirmation, weekend mode, signal demotions
alerts/
  TelegramAlerter.js — Telegram bot notifications
config.js           — All parameters, R:R per regime, strategy, weekend settings
```

## Backtest Output

Results are exported to `backtest-results/`:
- `trades-*.csv` — Individual trade log (includes isWeekend, entryPattern columns)
- `equity-*.csv` — Equity curve data
- `stats-*.json` — Full statistics (includes byPattern, weekend/weekday breakdowns)

## License

MIT
