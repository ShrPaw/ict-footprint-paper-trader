# ICT + Footprint — TradingView Paper Trader

Automatic paper trading using TradingView's chart + a local webhook server.

## How It Works

```
TradingView Chart
  │
  │  Pine Script strategy runs on chart
  │  Detects regime, ICT signals, confluence
  │  Executes paper trades on TradingView
  │
  ▼
TradingView Alert (webhook)
  │
  │  Fires on every entry signal
  │  POST → http://your-server:3450/webhook
  │
  ▼
Webhook Server (this project)
  │
  │  Tracks positions, PnL, fees
  │  Serves dashboard at http://localhost:3450
  │
  ▼
Dashboard — shows live stats, positions, trade history
```

## Setup (3 steps)

### 1. Start the server

```bash
cd tradingview-paper-trade
npm install
npm run server
```

Dashboard opens at **http://localhost:3450**

### 2. Add the strategy to TradingView

1. Open **TradingView** → pick a chart (e.g. ETHUSDT, 1H)
2. Open **Pine Editor** (bottom panel)
3. Copy the contents of `strategy/ICT_Footprint_Strategy.pine`
4. Paste into Pine Editor → click **"Add to chart"**
5. In the strategy settings, select your **Asset Profile** (BTC/ETH/SOL/XRP)

### 3. Set up the alert

1. On the chart, click the **Alert** icon (clock) or press `Alt+A`
2. Condition: select **"ICT + Footprint Paper Trader"**
3. Message: leave the default `{{strategy.order.alert_message}}`
4. **Webhook URL**: `http://YOUR_SERVER_IP:3450/webhook`
   - If running locally: `http://localhost:3450/webhook`
   - If on a server: use the server's public IP
5. Check **"Send plain text"** in the alert options
6. Click **Create**

The strategy will now automatically send signals to your server whenever it enters a trade.

## Asset Profiles

Each asset has different regime blocking based on backtested results:

| Asset | Blocks | Works In | Backtest PF | Backtest WR |
|-------|--------|----------|-------------|-------------|
| **BTC** | RANGING | VOL_EXPANSION | 1.53 | 65.4% |
| **ETH** | — | RANGING + VOL_EXP | 1.52 | 59.3% |
| **SOL** | — | RANGING | 1.72 | 59.7% |
| **XRP** | RANGING | VOL_EXPANSION | 2.27 | 65.9% |

TRENDING_DOWN and LOW_VOL are blocked globally (41% WR across all assets).

## Strategy Settings

In the TradingView strategy panel you can adjust:

- **Asset Profile** — changes regime blocking automatically
- **Risk % per trade** — default 0.5% of equity
- **SL/TP multipliers** — based on ATR (default 0.5x SL, 2.0x TP)
- **Killzones** — London, NY, Asia sessions
- **Min Confluence Score** — default 0.60

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard |
| `/webhook` | POST | TradingView alert receiver |
| `/api/stats` | GET | Current stats (JSON) |
| `/api/positions` | GET | Open positions |
| `/api/trades` | GET | Trade history (last 50) |
| `/api/reset` | POST | Reset account to $10,000 |

## Sending Signals Manually (for testing)

```bash
# Open a LONG
curl -X POST http://localhost:3450/webhook \
  -H "Content-Type: application/json" \
  -d '{"action":"buy","symbol":"ETHUSDT","price":2045,"stopLoss":2030,"takeProfit":2075,"regime":"RANGING","score":0.72}'

# Open a SHORT
curl -X POST http://localhost:3450/webhook \
  -H "Content-Type: application/json" \
  -d '{"action":"sell","symbol":"BTCUSDT","price":84500,"stopLoss":85200,"takeProfit":83100,"regime":"VOL_EXPANSION","score":0.68}'

# Close a position
curl -X POST http://localhost:3450/webhook \
  -H "Content-Type: application/json" \
  -d '{"action":"close","symbol":"ETHUSDT","price":2072}'
```

## Files

```
tradingview-paper-trade/
├── strategy/
│   └── ICT_Footprint_Strategy.pine   ← Pine Script (add to TradingView)
├── webhook-server/
│   ├── server.js                      ← Webhook + API server
│   ├── dashboard.html                 ← Dashboard UI
│   └── paper_trades.json              ← Trade data (auto-created)
├── .env                               ← Config (optional)
├── package.json
└── README.md
```

## Notes

- The Pine Script strategy runs **on TradingView's servers** — it uses their paper trading
- The webhook server only **receives alerts** and **tracks PnL** — it doesn't place orders
- Both systems run independently — you get TradingView's chart execution + a local dashboard
- To run the server 24/7, use `pm2` or a systemd service
- No API keys needed for basic setup — just TradingView (free tier works for 1 chart)
