# ICT + Footprint Paper Trader

Regime-adaptive paper trading engine for crypto perpetuals. Per-asset regime filtering where each asset only trades in its empirically validated winning regime.

**v2.0.0** — Per-asset regime optimization. PF 1.68, +$2,255 over 5 months (SOL + XRP).

## Validated Results (Jan-May 2025)

| Asset | PnL | Profit Factor | Win Rate | Max DD | Regime Filter |
|-------|-----|---------------|----------|--------|---------------|
| **XRP** | **+$2,341** | **1.89** | **60.2%** | — | VOL_EXPANSION only |
| **SOL** | **+$616** | **1.25** | **51.5%** | — | RANGING only |
| **Combined** | **+$2,255** | **1.68** | **56.4%** | **5.35%** | Per-asset |

**~31 trades/month. $19 expectancy per trade after fees. Sharpe 3.01.**

### Excluded Assets
- **BTC**: PF 0.72, -$491. No edge in any regime.
- **ETH**: PF ~0.95, -$160. Marginal, excluded until edge found.

## How It Works

Each asset **only trades in its winning regime**:
- 🟢 **XRP** → VOL_EXPANSION only (61% WR, +$1,161 in original test)
- 🟢 **SOL** → RANGING only (62% WR, +$1,762 in original test)
- 🔴 **BTC** → Excluded (no regime produces edge)
- 🔴 **ETH** → Excluded (marginal across all regimes)

**Strategy:** ICT concepts (Order Blocks, OTE, Liquidity Sweeps) on 1H candles with order flow footprint analysis. Entry requires confluence of ICT + Footprint signals, filtered by per-asset regime rules.

## Signal Performance

| Signal | Trades | Win Rate | PnL | Notes |
|--------|--------|----------|-----|-------|
| **DELTA_FLIP** | 135 | 56% | +$2,587 | Primary signal — cumulative delta direction change |
| **POC_REACTION** | 17 | 71% | +$631 | High conviction — price reacting at volume POC |
| ABSORPTION | 3 | 0% | -$201 | Too small sample, disabled pending data |
| STACKED_IMBALANCE | 1 | 0% | -$60 | Too small sample |

### Exit Performance
| Exit Type | Trades | Win Rate | PnL |
|-----------|--------|----------|-----|
| **Trailing Stop** | 63 | 100% | +$5,312 |
| **Partial TP** | 11 | 100% | +$1,395 |
| Stop Loss | 82 | 17% | -$3,750 |

## Quick Start

```bash
npm install
cp .env.example .env

# Backtest (5-month validation)
node engine/backtest.js --exchange binance --from 2025-01-01 --to 2025-05-01 --verbose

# Single asset
node engine/backtest.js --exchange binance --symbol XRP/USDT --from 2025-01-01 --to 2025-05-01 --verbose

# Live paper trading (needs Telegram creds in .env)
npm start
```

## Configuration

### `config.js`
- `symbols` — SOL/USDT, XRP/USDT (validated edge)
- `risk.*` — Per-regime SL/TP multipliers
- `strategy.*` — Confluence scoring, entry confirmation

### `config/assetProfiles.js`
- `allowedRegimes` — Per-asset regime whitelist (the core filter)
- `regimeBoosts` — Per-asset regime score multipliers
- Per-asset volatility, trend behavior, session weights
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

1. **Per-asset regime filtering** — The single biggest improvement. Each asset only trades where it has edge.
2. **XRP is the star** — PF 1.89, 60% WR in VOL_EXPANSION. Excluded in v1, now primary.
3. **DELTA_FLIP > DELTA_DIVERGENCE** — Flipped signals (67% WR) massively outperform divergences (49% WR).
4. **Trailing stops are the edge** — 100% WR, +$5,312. Let winners run.
5. **No time exits** — 0% WR in testing. Removed entirely.
6. **BTC/ETH excluded** — No regime produces edge. Don't force it.

## Known Limitations

- 156 trades over 5 months — moderate sample size
- No live execution validation yet
- SOL at 51% WR is thin — needs more data
- Jul-Nov 2024 / 2023 data not yet tested
- ABSORPTION/STACKED_IMBALANCE signals have too few trades to validate

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
