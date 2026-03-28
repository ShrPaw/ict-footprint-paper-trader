# ICT + Footprint Paper Trader

Regime-adaptive paper trading engine combining ICT (Inner Circle Trader) concepts with order flow footprint analysis for crypto perpetuals.

## Features

### 🔍 Analysis Engines
- **ICT Analyzer** — FVGs, Order Blocks, Liquidity Sweeps, BOS, OTE zones
- **Footprint Analyzer** — Delta estimation, Volume Profile, POC reactions, Absorption detection
- **Regime Detector** — Trending, Ranging, Vol Expansion, Low Vol, Absorption (ADX + ATR + Bollinger)

### 📊 Paper Engine
- Realistic simulation: slippage, maker/taker fees, 10x leverage margin
- **Trailing stops** — activate after configurable ATR in profit, trail by ATR
- **Breakeven stops** — move SL to entry after configurable ATR in profit
- Regime-adaptive risk sizing (different risk% per regime)
- Max open positions & daily loss limits

### 📱 Telegram Alerts
Real-time notifications for:
- 🎯 **Entries** — symbol, side, entry, SL, TP, regime, signal
- ✅ **Exits** — PnL, exit reason (TP/SL/trailing/BE/time), duration
- 📊 **Regime changes** — when market regime shifts
- 📈 **Daily summary** — balance, PnL, win rate, trades
- 🚀 **Startup/Shutdown** — bot lifecycle

### 📈 Backtest Engine
- Walk-forward backtesting with historical candles
- Equity curve tracking, max drawdown calculation
- **Performance metrics**: Sharpe, Sortino, Profit Factor, Expectancy
- **Breakdowns**: by regime, signal type, exit reason
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

# Run backtest
npm run backtest

# Backtest with options
node engine/backtest.js --symbol SOL/USDC:USDC --from 2024-01-01 --to 2024-06-01 --verbose

# Backtest custom balance
node engine/backtest.js --balance 50000 --verbose
```

## Configuration (`config.js`)

| Setting | Default | Description |
|---------|---------|-------------|
| `symbols` | SOL/USDC, XRP/USDC | Trading pairs |
| `data.exchange` | `mexc` | CCXT exchange |
| `engine.startingBalance` | 10000 | Paper balance |
| `engine.trailingStop.enabled` | true | Enable trailing stops |
| `engine.breakeven.enabled` | true | Enable breakeven stops |
| `risk.*.riskPercent` | 0.25-1.0 | Risk per regime |
| `killzones` | London/NY/Asia | Active trading sessions |

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
  main.js           — Live paper trader (orchestrator)
  PaperEngine.js    — Order management, PnL, trailing/BE stops
  backtest.js       — Historical backtester with metrics
data/
  DataFeed.js       — CCXT exchange data (polling)
  TradingViewWebhook.js — TradingView alert receiver
analysis/
  RegimeDetector.js — Market regime classification
  ICTAnalyzer.js    — ICT concept detection
  FootprintAnalyzer.js — Order flow analysis
strategies/
  StrategyEngine.js — Signal combination & regime filtering
alerts/
  TelegramAlerter.js — Telegram bot notifications
config.js           — All parameters
```

## Backtest Output

Results are exported to `backtest-results/`:
- `trades-*.csv` — Individual trade log
- `equity-*.csv` — Equity curve data
- `stats-*.json` — Full statistics

## License

MIT
