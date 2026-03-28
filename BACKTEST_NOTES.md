# Backtest Session Notes — 2026-03-28

## v0.4 Run: Entry Confirmation + Weekend Mode + Signal Demotions

### Setup
- Exchange: Binance (deep historical data — MEXC only has ~5 days)
- Symbol: SOL/USDT, 15m
- Period: 2025-01-01 → 2025-03-01
- Command: `node engine/backtest.js --exchange binance --symbol SOL/USDT --timeframe 15m --from 2025-01-01 --to 2025-03-01 --verbose`

### Results Summary
- 102 trades, 41.2% WR, PF 0.93, -$276 (-6.82%), Max DD 11.87%
- Massive improvement from v0.3 (207 trades, 21.7% WR, PF 0.48, -$3,996)

### What Worked
- Entry confirmation was the single biggest improvement (WR 21% → 41%)
- Trailing stops remain perfect (100% WR, +$3,827)
- OTE became the best signal (60% WR, +$581)
- ORDER_BLOCK demotion eliminated noise (1 trade vs 77)
- Weekend mode correctly filters 0 trades on weekends

### What Didn't Work
- Bullish patterns underperform bullish (pin_bar_bullish 34%, bullish_engulfing 23%)
- FVG still weak at 24% WR even with demotion
- 56% of trades still hit raw stop loss
- PF still below 1.0 (need ~2% more WR)

### MEXC Historical Data Limitation (unchanged)
MEXC's CCXT `fetchOHLCV` returns 0 candles for dates older than ~5 days.
Always use Binance for backtesting. Keep MEXC for live trading.

### Next Steps
1. Multi-symbol validation (ETH, BTC, XRP)
2. Multi-timeframe (5m, 1h)
3. Investigate bullish pattern underperformance
4. Extended period test (Mar-Jun 2025)
5. Consider tighter SL in TRENDING for better PF

### How to Run
```bash
node engine/backtest.js --exchange binance --symbol SOL/USDT --timeframe 15m --from 2025-01-01 --to 2025-03-01 --verbose

# Other symbols
node engine/backtest.js --exchange binance --symbol ETH/USDT --timeframe 15m --from 2025-01-01 --to 2025-03-01 --verbose
node engine/backtest.js --exchange binance --symbol XRP/USDT --timeframe 15m --from 2025-01-01 --to 2025-03-01 --verbose

# Results go to backtest-results/
```
