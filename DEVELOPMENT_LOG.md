# ICT + Footprint Paper Trader — Development Log

## Session: 2026-03-28

### 📊 Backtest Results — SOL/USDT, 15m, Jan-Feb 2025 (Binance)

**Config:** Confluence mode, deadzone-based killzone, 45min cooldown, strict trend alignment

| Metric | Value | Verdict |
|--------|-------|---------|
| Starting Balance | $10,000 | — |
| Final Balance | $6,004 | ❌ -39.96% |
| Total Trades | 207 | ✅ Good volume |
| Win Rate | 21.7% (45W / 162L) | ❌ Too low |
| Avg Win / Avg Loss | $66.51 / $38.72 (1.72:1) | ✅ Good R:R |
| Profit Factor | 0.48 | ❌ Need >1.0 |
| Max Drawdown | 41.09% | ❌ Too high |
| Sharpe Ratio | -12.46 | ❌ |
| Max Consec Wins | 3 | — |
| Max Consec Losses | 12 | ❌ |
| Avg Duration | 56 min | ✅ |
| Total Fees | $1,433 | ⚠️ |

### By Exit Reason

| Exit Type | Trades | Win Rate | PnL | Notes |
|-----------|--------|----------|-----|-------|
| trailing_sl | 45 | **100%** | **+$2,993** | ✅ Works perfectly — don't touch |
| stop_loss | 106 | 0% | -$5,994 | ❌ Too many stopped out |
| breakeven_sl | 54 | 0% | -$218 | ⚠️ Kills potential winners |
| time_exit | 2 | 0% | -$59 | Minor |

### By Regime

| Regime | Trades | Win Rate | PnL |
|--------|--------|----------|-----|
| VOL_EXPANSION | 104 | 23% | -$1,460 |
| TRENDING_UP | 33 | 18% | -$817 |
| TRENDING_DOWN | 64 | 23% | -$795 |
| RANGING | 6 | 0% | -$207 |
| LOW_VOL | 0 | — | — (skipped) |

### By Signal Type

| Signal | Trades | Win Rate | PnL | Notes |
|--------|--------|----------|-----|-------|
| DELTA_DIVERGENCE | 13 | 38% | **+$186** | ✅ Only profitable signal |
| OTE | 28 | 25% | -$117 | ⚠️ Decent |
| FVG | 36 | 22% | -$636 | ❌ |
| IMBALANCE | 30 | 23% | -$724 | ❌ |
| LIQUIDITY_SWEEP | 23 | 17% | -$474 | ❌ Worst after ORDER_BLOCK |
| ORDER_BLOCK | 77 | 18% | **-$1,514** | ❌ Worst performer — too many false signals |

---

## Bug Fixes Applied This Session

### Critical (7)

1. **Killzone used real-world clock instead of candle timestamp** — backtest was only generating signals in whatever session the real clock was in when you ran it
2. **Position sizing hardcoded to starting balance** — didn't adapt to PnL growth/decline
3. **Backtest daily loss limit was inverted** — `dailyPnL / startingBalance <= -3%` only blocked positive PnL (no `Math.abs`)
4. **BE/trailing stops used TP distance as ATR proxy** — inconsistent with actual ATR-based config
5. **Backtest trailing logic differed from live engine** — unified both to use `atr * config` values
6. **Footprint analyzer state never reset** — `volumeProfile` and `deltaHistory` grew unbounded → OOM on long backtests
7. **ICT analyzer FVGs/OrderBlocks never pruned** — arrays grew unbounded

### Performance Fixes

- FVG detection: scans only new candles since last analysis (not full history every tick)
- ATR/EMA: cached between calls in StrategyEngine
- Volume profile: limited to last 200 candles, max 100 levels per candle
- FVG/OB: auto-prune tested/mitigated + deduplication
- Added `--exchange` CLI flag for backtest (MEXC has no deep historical data)

---

## Strategy Evolution

### v0.2 → v0.3 Changes

| What | Before | After |
|------|--------|-------|
| Killzone | Hard gate (London/NY/Asia only) | Deadzone filter (blocks 4-6, 18-22 UTC only) |
| Signal selection | Best single signal | Confluence: ICT + Footprint agreement required (or score >0.75) |
| Cooldown | 1 min | 45 min per symbol |
| LOW_VOL | Traded | Skipped entirely |
| Trend alignment | Soft (EMA check) | Hard block (no short in TRENDING_UP, no long in TRENDING_DOWN) |
| R:R TRENDING | 1:2.5 | 1:3.75 (SL 0.8x, TP 3.0x) |
| R:R RANGING | 1:1.5 | 1:2.5 (SL 0.8x, TP 2.0x) |
| R:R VOL_EXP | 1:1.67 | 1:2.5 (SL 1.0x, TP 2.5x) |
| R:R LOW_VOL | 1:1.25 | Skipped |
| R:R ABSORPTION | 1:2 | 1:3.125 (SL 0.8x, TP 2.5x) |

### Trade Count Progression

| Version | Trades (2 months) | Win Rate | PnL |
|---------|-------------------|----------|-----|
| v0.2 original | 2 | 100% | +$35 |
| v0.3 killzone fix | 1,198 | 22% | -$7,156 |
| v0.3 confluence gate | 351 | 21% | -$4,946 |
| v0.3 trend filter + LS penalty | 207 | 22% | -$3,279 |

---

## Key Insights

### What Works
- **Trailing stops have 100% WR on winners** — when a trade runs, it runs well. Don't change trailing logic.
- **DELTA_DIVERGENCE is the only profitable signal** (38% WR, +$186) — order flow divergence is the real edge
- **Avg win:avg loss ratio of 1.72:1** — the R:R structure works, we just need more winners
- **Confluence trades DO produce bigger wins** — the biggest winner ($295) was a confluence trade

### What Doesn't Work
- **ORDER_BLOCK is the worst signal** (77 trades, 18% WR, -$1,514) — too many false signals
- **LIQUIDITY_SWEEP is second worst** (23 trades, 17% WR) — even after heavy penalty
- **Breakeven stops kill potential winners** — -$218 in losses from trades that could've trailed
- **We enter too early** — price hits ICT zone, we enter, then continues through and stops us out
- **22% WR with 1.72:1 R:R = negative expectancy** — need WR > 37% to break even at this R:R

### The Fundamental Problem
ICT zones (FVG, OB, OTE) tell us WHERE price might reverse, but not WHEN. We're entering at the zone without confirmation that the reversal is actually happening.

---

## Recommended Next Steps

### Priority 1: Entry Confirmation (Highest Impact)
- Add **rejection candle pattern** at ICT zones — bullish/bearish engulfing, pin bar, or inside bar breakout
- This should filter out entries where price just blasts through the zone
- Expected impact: WR from 22% → 40%+

### Priority 2: Remove Breakeven Stops
- Let trailing SL handle everything — data shows 100% WR on trailing exits
- BE stops are cutting $218 of potential profit by moving SL too early
- Replace with: wider activation for trailing (2x ATR instead of 1.5x)

### Priority 3: Widen R:R to 1:3 Minimum
- SL tighter (0.6x ATR), TP wider (3x ATR)
- Fewer stopped out, bigger winners when right
- Current 1.72:1 isn't enough at 22% WR

### Priority 4: Demote ORDER_BLOCK
- Remove from primary confluence or require 2x confidence threshold
- It's generating 37% of all trades with 18% WR

### Priority 5: Test More Symbols & Timeframes
- Current results only on SOL/USDT 15m
- Need XRP, ETH, BTC to validate edge is symbol-agnostic
- Try 5m and 1h to see if timeframe affects signal quality

---

## Architecture

```
engine/
  main.js           — Live paper trader (orchestrator) v0.3
  PaperEngine.js    — Order management, PnL, trailing stops (actual ATR-based)
  backtest.js       — Historical backtester with metrics, --exchange flag
data/
  DataFeed.js       — CCXT exchange data (polling)
  TradingViewWebhook.js — TradingView alert receiver
analysis/
  RegimeDetector.js — Market regime (TRENDING_UP/DOWN, RANGING, VOL_EXPANSION, LOW_VOL)
  ICTAnalyzer.js    — FVG, Order Block, Liquidity Sweep, OTE, BOS (pruned + deduped)
  FootprintAnalyzer.js — Delta estimation, Volume Profile, POC, Absorption (rolling window)
strategies/
  StrategyEngine.js — Confluence scoring, deadzone killzone, regime filters
alerts/
  TelegramAlerter.js — Telegram bot notifications
config.js           — All parameters, R:R per regime, strategy settings
```

---

## How to Run

```bash
# Install
npm install

# Backtest (use Binance for historical data)
node engine/backtest.js --exchange binance --symbol SOL/USDT --timeframe 15m --from 2025-01-01 --to 2025-03-01 --verbose

# Live paper trading (requires .env with Telegram credentials)
npm start

# Results go to backtest-results/
```

## Files Modified (this session)
- `config.js` — R:R ratios, killzone, strategy settings, pruning limits
- `strategies/StrategyEngine.js` — killzone fix, confluence scoring, trend filter, signal penalties
- `analysis/ICTAnalyzer.js` — state pruning, dedup, incremental scanning
- `analysis/FootprintAnalyzer.js` — rolling window, volume profile cap
- `engine/PaperEngine.js` — actual ATR-based BE/trailing
- `engine/backtest.js` — daily loss fix, unified trailing, --exchange flag
- `engine/main.js` — ATR passthrough, v0.3 dashboard
