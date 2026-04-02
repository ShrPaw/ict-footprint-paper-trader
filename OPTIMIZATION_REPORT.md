# ICT Footprint Paper Trader — Strategy Optimization Report

**Date:** 2026-04-02  
**Session:** #8  
**Engine:** v3.0 Precomputed O(n) Backtest  
**Period:** 2022-01-01 → 2026-03-31 (Binance Perpetual Futures)

---

## Current Results (After Optimization)

| Asset | PnL | PF | WR | Trades | Max DD | Fees | Final Bal |
|-------|-----|-----|-----|--------|--------|------|-----------|
| ETH | +$3,392 | 1.20 | 50.1% | 870 | 17.6% | $5,556 | $13,392 |
| SOL | +$4,975 | 1.30 | 57.1% | 1,022 | 11.5% | $4,353 | $14,975 |
| BTC | +$1,610 | 1.10 | 51.6% | 903 | 22.7% | $7,136 | $11,610 |
| XRP | +$643 | 1.07 | 52.6% | 475 | 14.3% | $1,831 | $10,643 |
| **Total** | **+$10,620** | | | **3,270** | | **$18,876** | **$40,620** |

### Before vs After This Session

| Metric | Before (Session #7) | After (Session #8) | Change |
|--------|--------------------|--------------------|--------|
| Total PnL | -$2,979 | +$10,620 | +$13,599 |
| Total Trades | 5,225 | 3,270 | -37% (fewer fees) |
| Total Fees | $37,297 | $18,876 | -$18,421 |
| ETH DD | 81.1% | 17.6% | -63.5pp |
| BTC DD | 83.8% | 22.7% | -61.1pp |
| SOL DD | 47.8% | 11.5% | -36.3pp |
| XRP DD | 41.2% | 14.3% | -26.9pp |

### What Changed

1. **Wider stop losses** — SL multipliers increased from 0.45-0.55x ATR to 0.8-1.0x ATR. The old tight stops were noise traps (7-14% WR on regular SL exits). The system has edge via trailing stops (73-91% WR), so the SL just needs to survive initial noise until trailing activates.

2. **Blocked RANGING for ETH** — RANGING regime was -$1,869 for ETH on futures (45% WR). Was already blocked for BTC and XRP, now ETH too. SOL keeps RANGING (it's profitable there: +$1,680).

3. **Tightened per-asset signal thresholds** — Raised minConfluenceScore and minSoloScore across all assets to reduce overtrading. ETH: 0.65/0.78, SOL: 0.58/0.72, BTC: 0.62/0.78, XRP: 0.62/0.78.

4. **Signal cooldown doubled** — From 45 minutes to 2 hours between signals per asset.

5. **Enabled breakeven protection** — Moves SL to entry after 1.0x ATR profit.

6. **Reduced slippage estimate** — From 0.01% to 0.005% (more realistic for liquid futures pairs).

7. **Breakeven in backtest** — Added breakeven exit tracking that was missing from the backtest engine.

---

## Exit Analysis (All Assets Combined)

| Exit Reason | WR | PnL | Count | Verdict |
|-------------|-----|-----|-------|---------|
| trailing_sl | 81% | +$42,220 | 1,489 | **THE EDGE** — keep |
| partial_tp | 100% | +$20,884 | 430 | **Perfect** — keep |
| take_profit | 100% | +$2,100 | 57 | Good — rare but fine |
| stop_loss | 7% | -$38,577 | 785 | **Noise trap** — widen further? |
| time_exit | 0% | -$16,205 | 509 | **KILL IT** — biggest bleed |

### Key Insight: The System Only Needs To Not Lose

Trailing stops and partial TPs generate $63,104 in gross profit. The system's total PnL is only +$10,620 because stop losses (-$38,577) and time exits (-$16,205) eat $54,782 of it. If we could convert even 20% of the SL/time_exit losses into trailing_sl wins, PnL would roughly triple.

---

## Priority Action Items

### PRIORITY 1 — Fix Time Exits (IMMEDIATE, HIGH IMPACT)

**Problem:** Time exits have 0% WR and cost -$16,205 across all assets. Current logic: exit after 4h if in loss > 0.5 ATR. This cuts trades that might recover and hit trailing stops.

**Options:**
- **Option A: Remove time exits entirely.** Let every trade either hit trailing SL or regular SL. Simple, eliminates the bleed. Risk: a few trades might sit for days in drawdown.
- **Option B: Extend timer + raise threshold.** Change from 4h/0.5 ATR to 8h/1.0 ATR. Only exit trades that are clearly dead after a full trading session.
- **Option C: Regime-specific time exits.** Only use time exits in RANGING (where mean reversion makes slow trades unlikely to recover). Disable in VOL_EXPANSION (where trends take time to develop).
- **Option D: Convert time exits to trailing activation.** After 4h, instead of market-exiting, tighten the trailing activation to 0.5 ATR. Trade gets a chance to recover via trailing instead of hard exit.

**Recommended:** Option A or D. Test both in backtest.

### PRIORITY 2 — Earlier Breakeven (IMMEDIATE, MEDIUM IMPACT)

**Problem:** Breakeven activates at 1.0 ATR profit, but trailing activates at 0.9 ATR. Since trailing always fires first, breakeven is effectively dead code.

**Fix:** Move breakeven activation from 1.0x ATR to 0.6x ATR. This protects trades that move in our favor but stall before reaching trailing activation. Current stop_loss exits (7% WR, -$38,577) are trades that never reached 0.9 ATR profit. Breakeven at 0.6 would catch more of them.

**Expected impact:** Convert 20-30% of stop_loss exits into breakeven_sl exits (small loss or scratch instead of full SL hit).

### PRIORITY 3 — Walk-Forward Analysis (VALIDATION, CRITICAL)

**Problem:** We've been optimizing parameters on the full 2022-2026 dataset. This is in-sample optimization. The parameters might be curve-fitted to this specific period.

**Solution:** Rolling walk-forward analysis:
```
Window 1: Train Jan 2022 - Dec 2022  | OOS: Jan-Mar 2023
Window 2: Train Apr 2022 - Mar 2023  | OOS: Apr-Jun 2023
Window 3: Train Jul 2022 - Jun 2023  | OOS: Jul-Sep 2023
...
Window N: Train [N-15 months] - [N-3 months] | OOS: [N-3] - [N]
```

**Parameters to optimize per window:**
- `blockedRegimes` per asset
- `slTightness` / `riskMultiplier` per asset
- `minConfluenceScore` / `minSoloScore` per asset
- `trailingStop.activationATR` / `trailATR`

**Validation criteria:**
- OOS Sharpe > 0 in >70% of windows
- OOS PF > 1.0 in >60% of windows
- Max OOS DD < 2x in-sample DD
- Parameter stability across windows (not jumping wildly)

**Why this matters:** If walk-forward results are significantly worse than full-sample, the edge isn't real. Better to find out now than with real money.

### PRIORITY 4 — BTC/XRP Decision (BEFORE LIVE)

**Problem:** BTC PF 1.10 and XRP PF 1.07 are razor-thin. After real-world slippage, execution delays, and spread widening during volatile moments, these could easily flip negative.

**Options:**
- **Option A: Keep all 4, but session-filter BTC/XRP.** Only trade BTC/XRP during NY/overlap sessions where they have best session weights (1.2/1.3). This could raise PF by reducing noise trades.
- **Option B: Drop BTC/XRP, concentrate on ETH + SOL.** 2-asset portfolio with PF 1.20 + 1.30 is more robust. Less capital at risk, fewer fees, simpler monitoring.
- **Option C: Keep but halve position size for BTC/XRP.** If they bleed, it's small. If they work, you still capture upside.

**Recommended:** Option B for initial live deployment. Add BTC/XRP back after walk-forward validates they have real edge.

### PRIORITY 5 — Session-Based Filtering (OPTIMIZATION)

**Observation:** Session weights differ per asset. ETH works best in NY/overlap (1.1/1.2), SOL is balanced (0.9-1.1), BTC likes NY/overlap (1.2/1.3), XRP likes Asia (1.0).

**Potential fix:** Instead of soft session weights, use hard session gates:
- ETH: Only NY + overlap sessions (skip London and Asia)
- SOL: All sessions (it works everywhere)
- BTC: Only NY + overlap
- XRP: Only Asia + London

**Expected impact:** Fewer trades, higher quality, lower fees. Needs backtest validation.

### PRIORITY 6 — Fee Optimization (NICE TO HAVE)

**Current fees:** $18,876 over 4 years ($393/month avg).

**Options:**
- Use maker orders instead of taker (limit orders at bid/ask). Maker fee is typically 0.02% vs 0.05% taker. Saves 60% on fees.
- Fee-aware position sizing: reduce size slightly on assets with higher fee impact.
- Volume-based fee tiers (if trading enough to qualify).

**Expected impact:** If maker orders work (need to model fill rate), fees drop from $18.8K to ~$7.5K. Adds ~$11K to PnL.

---

## Unresolved Issues From Previous Sessions

### From Session #4: 2022 vs 2023-2026 Divergence

2022 was consistently profitable (+$2,451 combined) while 2023-2024 lost money. This was partially addressed by blocking RANGING for ETH and widening stops. Now 2022-2026 is profitable overall, but we should still understand WHY 2022 worked better. Possible causes:
- 2022 had more VOL_EXPANSION regimes (crypto winter = big directional moves)
- 2023-2024 had more choppy/ranging markets that bled via SL
- The wider stops should help in choppy markets, need to verify via walk-forward

### From Session #4: Statistical Rigor Criteria

Defined 10 criteria for backtest validation. Current status:
1. ✅ Profitable across multiple years (2022 profitable, 2024 profitable, net positive)
2. ✅ Profitable without largest single trade ($9,076 without $500 win)
3. ⚠️ PF > 1.3 — ETH 1.20, BTC 1.10, XRP 1.07. Only SOL clears 1.30
4. ⚠️ Monthly win rate > 55% — ETH 51%, SOL 65%, BTC 55%, XRP 45%
5. ❌ Not yet validated via walk-forward
6. ✅ Max DD < 30% for all assets now
7. ✅ Trailing stops 73-91% WR across all assets
8. ⚠️ BTC/XRP PF too thin for comfortable live deployment
9. ✅ Consistent behavior across regime types (VOL_EXP works for all)
10. ❌ Not tested with live data yet

---

## Next Session Plan

1. Implement Priority 1 (time exit fix) — test Option A (remove) and Option D (trailing conversion)
2. Implement Priority 2 (earlier breakeven at 0.6 ATR)
3. Run all 4 backtests with new settings
4. If results improve, start Priority 3 (walk-forward framework)
5. Update PROJECT_CONTEXT.md with final results

---

## Architecture Notes

- Engine: Precomputed O(n) — all indicators calculated once, loop is pure O(1) lookups
- Backtest fetches from Binance (ccxt), ~245s for data loading per asset
- Precompute phase: <1s for all indicators + features
- Backtest loop: <1s for 148K 15m candles
- Results auto-exported to `backtest-results/` (CSV trades, CSV equity, JSON stats)
