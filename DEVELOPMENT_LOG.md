# ICT + Footprint Paper Trader — Development Log

## Session: 2026-03-29 — v1.1.0 Complete System Overhaul

### 🎯 Mission: 3-Mode System with Asset Intelligence

User requested a complete redesign from single-strategy to 3 independent modes with per-asset customization for the Big Four (BTC, ETH, SOL, XRP).

### 📊 Final Validated Results (Jan-May 2025, Binance)

| Asset | PnL | PF | WR | Trades | Max DD | $/Trade |
|-------|-----|-----|-----|--------|--------|---------|
| ETH | +$790 | 1.65 | 59.3% | 54 | 3.2% | $14.63 |
| SOL | +$1,325 | 1.68 | 56.4% | 78 | 6.6% | $16.99 |
| **Combined** | **+$2,115** | **~1.67** | **57.6%** | **132** | — | **$16.02** |

### What We Built (10 commits)

#### New Files
- `config/assetProfiles.js` — Per-asset intelligence (BTC/ETH/SOL/XRP)
- `strategies/ModeRouter.js` — Day/weekend mode detection + routing
- `strategies/DaytradeMode.js` — 1H ICT + trend (the only surviving mode)
- `strategies/WeekendMode.js` — Footprint/cluster (disabled — overtrading)
- `strategies/ScalpingProMode.js` — 15m hybrid (disabled — no edge)

#### Modified Files
- `config.js` — Symbols (ETH+SOL only), risk params, 1H TF
- `engine/main.js` — ModeRouter integration, v1.0 dashboard
- `engine/backtest.js` — 3-mode backtesting, mode/asset/regime breakdowns
- `README.md` — Complete rewrite
- `package.json` — Version 1.1.0

### 🔑 Key Discoveries (Data-Driven)

#### What Works
1. **RANGING regime** — Best performer. SOL: +$1,391 (62% WR), ETH: +$371 (59% WR)
2. **VOL_EXPANSION regime** — ETH: +$419 (59% WR). SOL breakeven.
3. **ICT on 1H** — Much cleaner than 15m. FVG (24% WR) and OB (18% WR) killed.
4. **Tight SL (0.5x ATR)** — Brought avg loss closer to avg win
5. **Partial TP at 1.5x ATR** — 100% WR, locks in profit on 50% of position
6. **Trailing stop at 0.9x activation** — 91-100% WR on winners

#### What Doesn't Work
1. **TRENDING_DOWN regime** — 41-42% WR, -$167 ETH, -$830 SOL. Blocked.
2. **LOW_VOL regime** — No momentum. Blocked.
3. **Weekend mode** — Overtrading (504 trades/quarter on SOL). Disabled.
4. **Scalping (15m)** — 44% WR, -$421. No edge at low TF. Disabled.
5. **BTC** — PF 0.61, -$1,623. No edge in any regime. Excluded.
6. **XRP** — PF 0.85, -$849. Only works in VOL_EXPANSION. Excluded.
7. **ETH weekends** — 53% WR, -$1,110. No edge. Disabled.

#### By-Regime Performance (ETH+SOL combined, Jan-May 2025)
| Regime | Trades | WR | PnL | Verdict |
|--------|--------|-----|-----|---------|
| RANGING | 61 | 61% | +$1,762 | ✅ PRIMARY EDGE |
| VOL_EXPANSION | 71 | 55% | +$353 | ✅ Secondary edge |
| TRENDING_DOWN | 0 | — | Blocked | ❌ |
| TRENDING_UP | 0 | — | Not triggered | — |
| LOW_VOL | 0 | — | Blocked | ❌ |

### ⚠️ Known Limitations

1. **Jul-Nov 2024 period loses** — PF 0.69 ETH, 0.96 SOL. This was a strong bull run (BTC 55k→90k). The system only trades RANGING+VOL_EXPANSION, so it misses trends. It also takes some losses during trend transitions.

2. **TRENDING_UP handling** — Re-enabled but doesn't trigger with current EMA filters. Need to investigate if we can safely trade WITH the trend.

3. **Sample size** — 54 ETH + 78 SOL trades over 5 months. Not huge. Need more validation periods.

4. **No live testing yet** — All results are backtested. Real execution may differ (slippage, API delays, etc.).

---

## 🔮 Next Steps (Next Session)

### Priority 1: Validate Edge Robustness
- [ ] Test on Q3-Q4 2024 (different market conditions)
- [ ] Test on 2023 data if available
- [ ] Walk-forward optimization (train on 3mo, test on next 1mo)
- [ ] Monte Carlo simulation on trade sequence

### Priority 2: Improve TRENDING Regime Handling
- [ ] Analyze why TRENDING_DOWN loses — is it the direction, timing, or both?
- [ ] Test "trend continuation" entries (only trade WITH the trend in TRENDING_DOWN)
- [ ] Investigate TRENDING_UP entries with different EMA filters
- [ ] Consider regime-specific SL/TP (tighter in trends, wider in ranges)

### Priority 3: RANGING Regime Optimization
- [ ] It's already the best — can we increase trade frequency here?
- [ ] Lower the confluence bar specifically for RANGING (it's already 62% WR)
- [ ] Test different ICT signal weights in RANGING vs other regimes

### Priority 4: Live Paper Trading
- [ ] Set up .env with Telegram credentials
- [ ] Run `npm start` on a VPS or always-on machine
- [ ] Monitor for 2 weeks, compare live vs backtest
- [ ] Track slippage and execution quality

### Priority 5: Weekend Mode Rebuild (If Time)
- [ ] The concept is sound (footprint on weekends) but thresholds were too low
- [ ] Try: only ABSORPTION signals, 2-hour cooldown, confluence score > 0.85
- [ ] Test separately from weekday system

### Priority 6: Multi-Symbol Expansion
- [ ] Re-test BTC with different ADX/EMA filters
- [ ] Consider adding DOGE, AVAX, or other high-volume perps
- [ ] Each needs the same validation process as ETH/SOL

### Code Quality
- [ ] Add unit tests for RegimeDetector
- [ ] Add signal consistency tests (same input → same output)
- [ ] Clean up unused ScalpingProMode/WeekendMode code (or fully disable)
- [ ] Add logging levels (debug/info/warn)

---

## 📁 Current File Structure
```
config.js                    — Master config (ETH+SOL, risk params)
config/assetProfiles.js      — Per-asset intelligence (4 assets defined)
strategies/
  ModeRouter.js              — Day/weekend routing (daytrade only active)
  DaytradeMode.js            — 1H ICT + trend (THE strategy)
  WeekendMode.js             — Footprint/cluster (disabled)
  ScalpingProMode.js         — 15m hybrid (disabled)
  StrategyEngine.js          — Original v0.5 engine (legacy, unused)
engine/
  main.js                    — Live paper trader
  PaperEngine.js             — Order management, PnL, trailing
  backtest.js                — Historical backtester
analysis/
  RegimeDetector.js          — Market regime classification
  ICTAnalyzer.js             — ICT concepts (FVG, OB, sweeps, OTE)
  RealFootprintAnalyzer.js   — Order flow analysis
  FootprintAnalyzer.js       — Estimated footprint
data/
  HyperliquidFeed.js         — Real-time data + trade footprint
  DataFeed.js                — CCXT fallback
  TradingViewWebhook.js      — External signal receiver
alerts/
  TelegramAlerter.js         — Telegram notifications
```

## 🏃 How to Continue
```bash
# Clone and install
git clone https://github.com/ShrPaw/ict-footprint-paper-trader.git
cd ict-footprint-paper-trader
npm install

# Backtest
node engine/backtest.js --exchange binance --from 2025-01-01 --to 2025-05-01 --verbose

# Single asset
node engine/backtest.js --exchange binance --symbol ETH/USDT --from 2025-01-01 --to 2025-05-01 --verbose

# Live paper trading (needs .env with Telegram creds)
cp .env.example .env
# Edit .env with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
npm start
```
