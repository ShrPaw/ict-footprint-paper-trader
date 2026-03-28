# ICT + Footprint Paper Trader

3-mode regime-adaptive paper trading engine for crypto perpetuals. Each mode is optimized for a specific market condition with asset-specific intelligence for the Big Four: **BTC, ETH, SOL, XRP**.

**v1.0** — 3-Mode System. Big Four Assets. ICT on higher timeframes only.

## Architecture: 3 Independent Modes

### Mode 1: "Daytrade" (Trend-Focused, Weekdays Only)
- **Active:** Monday–Friday, key trading sessions
- **Timeframe:** 1H (ICT concepts work on higher TFs where price is cleaner)
- **Strategy:** Trend-following with ICT + structured filters
- **Conditions:** ADX > asset-specific threshold, EMA alignment (9 > 21 > 50)
- **Risk:** Wider stop loss, higher R:R through cleaner setups

### Mode 2: "Weekend Mode" (Range + Footprint/Cluster)
- **Active:** Saturday–Sunday only
- **Timeframe:** 5m, 15m (adaptive)
- **Strategy:** NO ICT — pure footprint/cluster analysis
- **Reads:** Absorption, imbalances, liquidity traps, delta shifts, POC reactions
- **Risk:** More permissive, half risk, wider SL (thin books, violent candles)

### Mode 3: "Scalping Pro" (Weekday Intraday + Hybrid)
- **Active:** Monday–Friday
- **Timeframe:** 15m primary + 5m micro-confirmations
- **Strategy:** NO ICT on low TF — professional scalping + footprint
- **Reads:** Order flow confirmation, cluster behavior, volume triggers
- **Risk:** Tighter stops, precise entries via microstructure confluence

## Asset-Specific Intelligence (The Big Four)

Each asset has a dedicated profile with custom:
- Volatility profiles & ATR multipliers
- ADX thresholds for trend detection
- ICT vs Footprint weight balance
- Session sensitivity (Asia/London/NY)
- Weekend behavior & risk multipliers
- Psychological support/resistance levels
- Volume/flow characteristics

| Asset | Volatility | Trend | ICT Weight | Weekend | Risk |
|-------|-----------|-------|------------|---------|------|
| BTC | Medium | Strong | 40% | ✅ (conservative) | 1.0x |
| ETH | High | Moderate | 35% | ✅ (standard) | 0.9x |
| SOL | Extreme | Moderate | 25% | ✅ (aggressive) | 0.8x |
| XRP | High | Weak | 30% | ❌ (disabled) | 0.7x |

## Key Design Decisions (Data-Driven)

- **ICT on 1H only** — 15m ICT had 24% WR (FVG) and 18% WR (OB). Higher TF = cleaner signals
- **Weekends: no ICT** — institutional algorithms don't run on weekends. Footprint/cluster reads real flow
- **FVG killed** — 24% WR, -$378 across all tests. Even on 1H, too unreliable
- **ORDER_BLOCK demoted** — 18% WR, needs confluence or 2x threshold
- **DELTA_DIVERGENCE boosted** — only consistently profitable signal (38-41% WR)
- **Trailing stops: 100% WR** on winners. Partial TP locks in 50% at 1.5x ATR
- **Breakeven disabled** — killed $218 in potential profit. Trailing handles everything
- **Direction filter: EMA50** — never long below EMA50, never short above. Biggest single edge
- **XRP weekends disabled** — no edge found, dead volume

## Quick Start

```bash
# Install
npm install

# Copy env template
cp .env.example .env

# Configure Telegram (edit .env)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Run live paper trader
npm start

# Run backtest (all 4 assets)
node engine/backtest.js --exchange binance --from 2025-01-01 --to 2025-03-01 --verbose

# Backtest single asset
node engine/backtest.js --exchange binance --symbol ETH/USDT --from 2025-01-01 --to 2025-03-01 --verbose

# Custom balance
node engine/backtest.js --balance 50000 --verbose
```

## Configuration

### `config.js` — Core settings
- `symbols` — The Big Four trading pairs
- `timeframes` — 15m primary, 5m secondary, 1h context
- `killzones` — London, NY, overlap, Asia sessions
- `risk.*` — Per-regime risk%, SL/TP multipliers
- `strategy.*` — Confluence scoring, entry confirmation
- `engine.*` — Trailing stops, partial TP, fees, slippage

### `config/assetProfiles.js` — Per-asset intelligence
- Volatility, trend tendency, session weights
- Psychological levels, volume profiles
- Mode-specific overrides (ADX thresholds, ICT weights, etc.)

## File Structure

```
engine/
  main.js              — Live paper trader (3-mode orchestrator)
  PaperEngine.js       — Order management, PnL, trailing stops
  backtest.js          — Historical backtester with mode/asset breakdowns
strategies/
  ModeRouter.js        — Routes weekday/weekend to correct mode
  DaytradeMode.js      — 1H ICT + trend (weekdays)
  WeekendMode.js       — Footprint/cluster (weekends)
  ScalpingProMode.js   — 15m hybrid scalping (weekdays)
data/
  HyperliquidFeed.js   — Real-time data + trade footprint
  DataFeed.js          — CCXT fallback data
  TradingViewWebhook.js — External signal receiver
analysis/
  RegimeDetector.js    — Market regime classification
  ICTAnalyzer.js       — ICT concepts (FVG, OB, sweeps, OTE)
  RealFootprintAnalyzer.js — Order flow analysis
  FootprintAnalyzer.js — Estimated footprint fallback
config/
  assetProfiles.js     — Big Four asset intelligence
config.js              — Master configuration
alerts/
  TelegramAlerter.js   — Real-time Telegram notifications
```

## Backtest Output

Results in `backtest-results/`:
- `trades-*.csv` — Individual trades with mode, asset, pattern columns
- `equity-*.csv` — Equity curve
- `stats-*.json` — Full breakdown: by mode, asset, regime, signal, exit, pattern

## Telegram Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → get token
2. Message your bot → `/start`
3. Get chat ID: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Set in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=987654321
   ```

## License

MIT
