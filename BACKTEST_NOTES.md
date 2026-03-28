# Backtest Session Notes — 2026-03-28

## What We Did

Cloned the repo, installed deps (`npm install`), and attempted to run the backtest engine with various configurations.

## Issues Found

### 1. MEXC Historical Data Limitation
**Problem:** MEXC's CCXT `fetchOHLCV` with a `since` parameter for dates older than ~1 week returns **0 candles**. Only recent data works.

**Tested:**
```bash
# Returns 0 candles for any date before ~5 days ago
const ohlcv = await ex.fetchOHLCV('SOL/USDT', '15m', since, 1000); // since = Sep 2024 → 0 results
# But recent data works fine:
const ohlcv = await ex.fetchOHLCV('SOL/USDT', '15m', Date.now() - 5*86400000, 100); // ✅ 100 candles
```

**Workaround:** Switch to Binance for backtesting (supports deep historical data):
```js
// In config.js, change:
exchange: 'binance',  // instead of 'mexc'
```
Binance works for any historical range. Keep `mexc` for live trading.

### 2. Killzone Bug in Backtest (`StrategyEngine.js`)
**Problem:** `_checkKillzone()` uses `new Date()` (real-world clock) instead of the backtest candle's timestamp. This means:
- Backtest only generates signals during whatever killzone the **real clock** is in when you run it
- If you run at 2 AM UTC, only Asia session signals fire
- If you run at 14 UTC, only NY overlap signals fire

**Fix needed in `strategies/StrategyEngine.js`:**
```js
_checkKillzone(candleTimestamp) {  // ← accept candle time
  const now = candleTimestamp ? new Date(candleTimestamp) : new Date();  // ← use candle time in backtest
  const utcHour = now.getUTCHours();
  // ... rest stays the same
}
```
And in `generateSignal()`, pass the candle timestamp:
```js
const inKillzone = this._checkKillzone(candles[candles.length - 1].timestamp);
```

### 3. Very Low Signal Count
**Result:** Even with working data (Binance, 2689 candles / 1 month of 15m), only **2 trades** were generated.

**Why:** The strategy has multiple compounding filters:
- **ICT signals** require price to be IN specific zones (FVG, Order Block, OTE) — rare condition
- **Footprint signals** need delta divergence / absorption / POC proximity — also selective
- **Regime filters** block trades in certain conditions (e.g., RANGING only at range extremes, TRENDING needs EMA alignment)
- **Combined score threshold** of 0.4 filters out weak signals
- **Killzone filter** restricts to specific trading hours

This makes the strategy **extremely selective** — good for avoiding bad trades, but hard to backtest with statistical significance.

### 4. Performance / OOM on Long Ranges
**Problem:** The backtest iterates every candle and rebuilds the full analysis window (ICT + Footprint + Regime) on each tick. For 17,377 candles (6 months of 15m), this consumed ~19GB RAM and ran for 40+ minutes before being killed.

**Root cause:** `_detectFVGs()` loops through ALL candles on every call, `orderBlocks` and `fvgs` arrays grow unbounded, and volume profile rebuilds every tick.

**Fixes needed for scalability:**
- Limit lookback window (don't re-scan entire history for FVGs each candle)
- Prune old FVGs/OBs from memory
- Use rolling indicators instead of recalculating from scratch

## Successful Run (1 month, Binance 15m)

```
Starting Balance:  $10,000.00
Final Balance:     $10,026.81
Total PnL:         +$34.62 (+0.27%)
Total Trades:      2
Win Rate:          100% (2W / 0L)
Max Drawdown:      $6.92 (0.07%)

Trades:
  ✅ LONG @ 228.47 → +$18.53 (TRENDING_DOWN, IMBALANCE signal, breakeven exit, 15min)
  ✅ LONG @ 147.17 → +$16.10 (LOW_VOL, ORDER_BLOCK signal, breakeven exit, 30min)
```

Both winners were stopped at breakeven SL (moved SL to entry after 1x ATR profit, then got stopped). Positive but too few trades to draw conclusions.

## Recommendations

1. **Fix killzone bug** — pass candle timestamp to `_checkKillzone()`
2. **Lower signal thresholds** for backtesting:
   - Reduce `combinedScore` minimum from 0.4 to 0.3
   - Lower regime filter strictness (e.g., allow RANGING trades at 0.2-0.8 range position instead of 0.3-0.7)
   - Consider removing killzone filter for backtesting to get more data
3. **Add a `--exchange` CLI flag** to backtest.js so you can easily switch between exchanges
4. **Optimize analysis loops** — use rolling window instead of full-history rescan
5. **Test on shorter timeframes** (1m, 5m) with shorter ranges for more trade samples
6. **Consider running on multiple symbols** simultaneously to get more trades per run

## How to Run

```bash
# Install
npm install

# Quick backtest (1 month, works on Binance)
# First change config.js: exchange: 'binance'
node engine/backtest.js --symbol SOL/USDT --timeframe 15m --from 2025-02-01 --to 2025-03-01 --verbose

# With custom balance
node engine/backtest.js --symbol SOL/USDT --balance 50000 --verbose

# Results go to backtest-results/
# - trades-*.csv
# - equity-*.csv
# - stats-*.json
```

## Files Modified
- `config.js` — tested with `exchange: 'binance'` (reverted to `mexc`)
- No code changes committed — issues documented here for next session
