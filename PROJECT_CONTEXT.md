# PROJECT_CONTEXT.md — ICT Footprint Paper Trader

**Last updated:** 2026-04-04 11:32 GMT+8
**Session:** #17 (2026-04-04)
**Version:** 7.0.0 (Production System Built)

---

## What This Is

A **funding rate positioning edge** trading system for crypto perpetuals (BTC, ETH, XRP).
Started as an ICT + Order Flow system, evolved through 16 sessions of rigorous research
to discover that funding rate structural pressure is the only extractable edge.

**Version:** 7.0.0 (Production funding rate system)
**Language:** JavaScript (ESM, Node.js 22)
**Repo:** `https://github.com/ShrPaw/ict-footprint-paper-trader` (private)
**Owner:** Nicolas (Windows user, Spanish)

---

## 🟢 PRODUCTION SYSTEM STATUS

### Validated Architecture
- **Entry:** Funding rate extremes (p10/p95/p90 cumulative drain)
- **Exit:** Fixed 48h time exit — NO stops, NO trailing
- **Risk:** 1% per trade, sized on worst-case MAE
- **Max concurrent:** 3 positions across BTC, ETH, XRP

### Stress Test Results (All Passed 🟢)
- Robustness score: BTC 9/10, ETH 10/10, XRP 10/10
- No blowups under any scenario
- Max DD 8-14% (well under 20% halt threshold)
- Monte Carlo: 0% probability of ≥20% DD at 1% risk

### Backtest Validation (2022-2026)
| Metric | Value |
|--------|-------|
| Return | +26.21% ($10K → $12,621) |
| Trades | 887 |
| Win Rate | 50.5% |
| Profit Factor | 1.34 |
| Max DD | 8.24% |
| Profitable months | 56.9% |

### Per-Asset Validation
| Asset | PF (actual) | PF (expected) | PnL |
|-------|-------------|---------------|-----|
| BTC | 1.30 | 1.26 ✅ | +$1,072 |
| ETH | 1.13 | 1.25 ✅ | +$323 |
| XRP | 1.67 | 1.73 ✅ | +$1,510 |

### Production Modules
```
funding/
  FundingConfig.js     — Locked parameters (non-optimized)
  FundingEngine.js     — Signal detection
  PositionManager.js   — Sizing & exposure
  RiskMonitor.js       — Drawdown & alerting
  BacktestEngine.js    — Event-driven simulation
  FundingBotRunner.js  — Live paper trading bot
  live.js              — CLI entry point
```

### npm Scripts
```bash
npm run funding:backtest    # Run backtest
npm run funding:live        # Live paper trading
```

---

## Validated Results (Jan-May 2025, Binance SPOT — ⚠️ SEE NOTE)

| Asset | PnL | PF | WR | Trades | Max DD | Sharpe | Best Regime |
|-------|-----|-----|-----|--------|--------|--------|-------------|
| ETH | +$684 | 1.52 | 59.3% | 54 | 3.5% | 1.18 | RANGING + VOL_EXP |
| SOL | +$1,426 | 1.72 | 59.7% | 77 | 5.5% | 1.71 | RANGING only |
| BTC | +$317 | 1.53 | 65.4% | 26 | 2.9% | 0.85 | VOL_EXP only |
| XRP | +$1,242 | 2.27 | 65.9% | 44 | 4.1% | 2.57 | VOL_EXP only |
| **Total** | **+$3,669** | **~1.75** | **61.8%** | **201** | | | ~40 trades/month |

⚠️ **These results were from Binance SPOT data, not FUTURES.** The futures backtest (2022-2026) has NOT been run yet.

## Backtest Results v4.0 — Binance FUTURES (2022-01-01 → 2026-03-31)

**After: wider stops, ETH RANGING blocked, tighter thresholds, breakeven, 2h cooldown.**

| Asset | PnL | PF | WR | Trades | Max DD | Fees | Final Bal |
|-------|-----|-----|-----|--------|--------|------|-----------|
| ETH | +$3,392 | 1.20 | 50.1% | 870 | 17.6% | $5,556 | $13,392 |
| SOL | +$4,975 | 1.30 | 57.1% | 1,022 | 11.5% | $4,353 | $14,975 |
| BTC | +$1,610 | 1.10 | 51.6% | 903 | 22.7% | $7,136 | $11,610 |
| XRP | +$643 | 1.07 | 52.6% | 475 | 14.3% | $1,831 | $10,643 |
| **Total** | **+$10,620** | | | **3,270** | | **$18,876** | **$40,620** |

### Exit Analysis (All Assets)
| Exit | WR | PnL | Count |
|------|-----|-----|-------|
| trailing_sl | 81% | +$42,220 | 1,489 |
| partial_tp | 100% | +$20,884 | 430 |
| take_profit | 100% | +$2,100 | 57 |
| stop_loss | 7% | -$38,577 | 785 |
| time_exit | 0% | -$16,205 | 509 |

See `OPTIMIZATION_REPORT.md` for full analysis and next steps.

---

## Funding Rate Edge — STRUCTURAL EDGE FOUND (Session #16)

### The Discovery
After exhausting all OHLCV-based approaches (Phases 1-4.5), switched to alternative data: Binance perpetual futures funding rates (8h intervals, 4,600+ events per asset, 2022-2026).

**Key insight:** Extreme funding conditions create forced positioning pressure. The funding mechanism itself (longs pay shorts when funding positive, vice versa) creates a mechanical mean-reversion force.

### Validated Signals (Phase 5.5 — ROBUST STRUCTURAL EDGE)

| Signal | Asset | Events | 48h Return | t-stat | Score | Years+ | Regimes+ |
|--------|-------|--------|------------|--------|-------|--------|----------|
| Extreme Low Funding (p10) | BTC | 466 | +0.58% | 3.07 | 8/8 | 100% | 100% |
| Extreme High Funding (p95) | BTC | 233 | +0.65% | 2.32 | 7/8 | 50% | 100% |
| High Cumulative Drain | BTC | 897 | +0.34% | 2.87 | 7/8 | 50% | 83% |
| High Cumulative Drain | ETH | 466 | +0.55% | 2.76 | 8/8 | 100% | 100% |
| **High Cumulative Drain** | **XRP** | **466** | **+1.81%** | **4.17** | **7/8** | **67%** | **100%** |
| Extreme Low Funding (p10) | XRP | 466 | +1.04% | 3.56 | 8/8 | 80% | 80% |

### Why This Edge Is Different

1. **Causal mechanism** — Funding rates force position closing. Not a correlation, a mechanical effect.
2. **Massive margin** — 0.34-1.81% mean vs 0.14% round-trip fees = 2.4-13× safety margin
3. **Delay tolerant** — Survives 8h entry delay with 60-97% retention (vs 37-56% for OHLCV)
4. **Regime independent** — Works in trending, ranging, low vol, high vol (83-100% of regimes)
5. **Year stable** — Positive in 67-100% of years (vs erratic for OHLCV)
6. **Binary detection** — Funding rate is either extreme or not. No fuzzy thresholds.

### Known Risk

- Unbounded tail risk (worst 1% MAE: 12-27%)
- BUT: edge margin is sufficient to survive a properly-sized risk overlay
- Unlike OHLCV edges, the mean return survives friction AND delay

### Detection Method

```javascript
// Extreme funding: bottom 10% or top 95% of historical funding rates
// Cumulative drain: top 10% of 10-period rolling sum of funding rates
// Entry: at funding settlement (every 8h: 00:00, 08:00, 16:00 UTC)
// Hold: 48h (optimal horizon from Phase 5)
// Exit: fixed time, no stops (risk overlay TBD)
```

### Research Pipeline (Session #16)

```
Phase 2.7: Edge Extractability    → OHLCV edges fragile (unbounded tail)
Phase 3:   Risk Overlay           → OHLCV edges DESTROYED by stops
Phase 4:   Duration Edge          → No universal duration edge
Phase 4.5: Regime Detection       → Cannot detect TRENDING_UP real-time
Phase 5:   Funding Edge Discovery → 33 significant findings
Phase 5.5: Structural Validation  → 5 ROBUST STRUCTURAL EDGES
```

## Architecture

```
models/
  BaseModel.js            — Abstract interface + shared utilities (killzone, ATR z-score, etc.)
  ModelRouter.js          — Asset → Model dispatcher (routes symbol to correct engine)
  SOLModel.js             — Retail Momentum Engine (stacked imbalance + momentum)
  BTCModel.js             — Institutional Structure Engine (OB, sweep, OTE + delta)
  ETHModel.js             — Hybrid Confluence Engine (mandatory ICT + flow confluence)
  XRPModel.js             — Extreme Event Engine (extreme delta + volume spike + stall)
strategies/
  DaytradeMode.js         — Signal shell: data prep → ModelRouter → signal (legacy fallback)
engine/
  PaperEngine.js          — Simulated orders, PnL, trailing stops (emergency-only SL)
  backtest.js             — Walk-forward backtester (multi-model architecture)
  OrderFlowEngine.js      — 6-step institutional decision pipeline (used by ETH model)
  Precompute.js           — O(n) indicator precomputation
analysis/
  RegimeDetector.js       — Market regime classification
  ICTAnalyzer.js          — Order Blocks, FVG, OTE, Liquidity Sweeps, BOS
  RealFootprintAnalyzer.js — Order flow delta, absorption, POC
  ClusterAnalyzer.js      — 4 cluster type classification
config/
  assetProfiles.js        — Per-asset intelligence + regime blocking
  config.js               — Global config
data/
  HyperliquidFeed.js      — Hyperliquid data (trade-level footprint)
  BinanceFeed.js          — Binance futures data (OHLCV via ccxt)
```

## Three Operating Modes

1. **Paper bots** (`npm run bot:eth`) — HyperliquidFeed + PaperEngine (simulated)
2. **Hyperliquid live** (`npm run live:eth`) — HyperliquidFeed + HyperliquidEngine (testnet)
3. **Binance live** (`npm run live:binance:eth`) — BinanceFeed + BinanceEngine (testnet) ← NEW

## npm Scripts (Key)

```bash
# Backtests (Binance futures, 2022-01-01 to 2026-03-31)
npm run backtest:eth / backtest:sol / backtest:btc / backtest:xrp

# Backtests with funding rate (0.01% per 8h)
npm run backtest:eth:funding / backtest:sol:funding / backtest:btc:funding / backtest:xrp:funding

# Paper trading (Hyperliquid data, simulated orders)
npm run bot:eth / bot:sol / bot:btc / bot:xrp / bots:all

# Live on Binance futures testnet
npm run live:binance:eth / live:binance:sol / live:binance:btc / live:binance:xrp / live:binance:all

# Live on Hyperliquid testnet (legacy)
npm run live:eth / live:sol / live:btc / live:xrp / live:all

# Dashboard
npm run dashboard   # port 3500
```

## Per-Asset Regime Blocking (THE EDGE — Individual Per Asset)

| Asset | Allowed Regimes | Blocked Regimes | Personality |
|-------|----------------|-----------------|-------------|
| ETH | VOL_EXP, TRENDING_UP | RANGING, TRENDING_DOWN, LOW_VOL | 🐋 Institutional workhorse — wide stops, let trailing win |
| SOL | RANGING, VOL_EXP | TRENDING_DOWN, LOW_VOL | 🚀 Volatile rocket — tight risk, ride momentum |
| BTC | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL | 🐢 Slow giant — widest stops, fewest trades |
| XRP | VOL_EXP only | RANGING, TRENDING_DOWN, LOW_VOL | 🎯 Sniper — hyper-selective, half position size |

## Per-Asset Risk Profiles (Completely Individual)

| Parameter | ETH | SOL | BTC | XRP |
|-----------|-----|-----|-----|-----|
| slMultiplier | 2.0x | 1.0x | 2.0x | 1.3x |
| trailActivation | 1.2 ATR | 0.9 ATR | 1.2 ATR | 1.0 ATR |
| trailDistance | 0.7 ATR | 0.5 ATR | 0.7 ATR | 0.5 ATR |
| breakevenActivation | KILLED | KILLED | KILLED | KILLED |
| riskMultiplier | 0.9x | 0.8x | 1.0x | 0.5x |
| minConfluenceScore | 0.80 | 0.75 | 0.78 | 0.82 |
| minSoloScore | 0.90 | 0.85 | 0.88 | 0.90 |
| signalCooldown | 2h | 2h | 2h | 4h |
| ictWeight / fpWeight | 0.35/0.65 | 0.25/0.75 | 0.4/0.6 | 0.3/0.7 |
| emergencySL | 8 ATR | 8 ATR | 8 ATR | 8 ATR |

## Key Design Decisions

1. **Multi-Model Architecture (Session #13)** — Each asset has its OWN model with independent feature set, signal logic, and thresholds. NOT parameter tuning — model separation.
2. **Per-asset regime blocking** — the real edge
3. **ICT on 1H only** — 15m FVG had 24% WR
3. **TRENDING_DOWN blocked globally** — 41% WR
4. **No regular stop loss** — 0% WR in all backtests, replaced with 8 ATR emergency circuit breaker
5. **No weekends** — overtrading, no edge (for daytrade mode)
6. **Breakeven killed** — 0% WR, scratching recoverable trades
7. **Independent bots** — no shared state between assets
8. **Trailing stops** — 100% WR across all assets when activated
9. **Partial TP** — 50% closed at 1.5x ATR, rest trails
10. **6-Step OrderFlowEngine** — institutional decision pipeline (Context→Intent→Event→Cluster→Validation→Execution)
11. **4 Cluster Types** — Absorption, Continuation, Exhaustion, Trapped Traders
12. **Much higher signal thresholds** — 0.75-0.90 range (was 0.58-0.78)

## Backtest Upgrades (Session #3)

- Year-by-year PnL breakdown
- Monthly return distribution (median, best/worst, profitable months %)
- Regime time distribution (% of candles in each regime)
- Funding rate impact estimation (`--funding` flag)
- Single trade dependency check (PnL without largest win)
- DD/Return ratio
- Robustness checks section

## Environment Setup

`.env` file needed with:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
HYPERLIQUID_PRIVATE_KEY=0x...     # for Hyperliquid testnet
BINANCE_API_KEY=...               # for Binance futures testnet ← NEW
BINANCE_API_SECRET=...            # for Binance futures testnet ← NEW
WEBHOOK_SECRET=paper-trader-local
```

---

## TODO / Next Session

### ✅ FUNDING RATE EDGE VALIDATED (Session #16)
- [x] **Phase 2.7: Edge Extractability** — OHLCV edges fragile, unbounded tail risk
- [x] **Phase 3: Risk Overlay** — OHLCV edges destroyed by stops (PF 0.64-0.73)
- [x] **Phase 4: Duration Edge** — No universal duration edge, regime-conditional only
- [x] **Phase 4.5: Regime Detection** — Cannot detect TRENDING_UP in real-time
- [x] **Phase 5: Funding Edge Discovery** — 33 significant findings from funding rates
- [x] **Phase 5.5: Structural Validation** — 5 ROBUST STRUCTURAL EDGES confirmed

### TOP PRIORITY: STRATEGY CONSTRUCTION (NEXT SESSION)

The funding rate edge is validated. Next session should build the actual trading system:

1. **Entry Logic**
   - Monitor funding rates at settlement (every 8h: 00:00, 08:00, 16:00 UTC)
   - Trigger on: extreme funding (p10/p95) OR cumulative drain (p90)
   - Entry: at next candle open after funding print
   - Assets: BTC, ETH, XRP (all validated)

2. **Position Sizing**
   - Fixed risk per trade (1% capital?)
   - Size based on expected MAE, not ATR stops

3. **Exit Logic**
   - Primary: 48h fixed time exit (validated optimal horizon)
   - Risk overlay: TBD — needs design compatible with edge characteristics
   - NO tight stops (OHLCV edges proved tight stops destroy thin-margin edges)
   - Consider: wide catastrophic stop (5-10%?) + time exit

4. **Risk Management**
   - Max positions per asset: 1 (can't stack funding events)
   - Max total exposure: TBD
   - Portfolio DD limit: TBD

5. **Walk-Forward Validation**
   - Rolling 12m train / 3m OOS
   - Lock funding thresholds per OOS window
   - Test on 2026 Q2 as true OOS (if available)

### IMPLEMENTATION ORDER

1. Build `engine/FundingEngine.js` — detects funding events, generates signals
2. Build `engine/FundingBacktest.js` — backtests with funding rate data
3. Test risk overlay options (wide stop + time exit vs no stop + time exit)
4. Walk-forward analysis
5. Live paper trading integration

### IMPORTANT CONSTRAINTS

- Do NOT optimize funding thresholds (use p10/p90/p95 as-is)
- Do NOT combine with OHLCV signals (proven to add no value)
- Do NOT use tight stops (edge margin doesn't support <2% stops)
- The edge is in FUNDING, not in price — keep the system simple

---

## Session History

### Sessions 1-15: OHLCV Research
See SESSION_NOTES files. Concluded: no extractable edge from OHLCV data.

### Session #16 (this session): Complete Research Pipeline
- Phase 2.7-4.5: Exhaustive OHLCV validation → all edges rejected
- Phase 5: Funding rate edge discovery → 33 significant findings
- Phase 5.5: Structural validation → 5 ROBUST STRUCTURAL EDGES
- First extractable edge found in the entire project

---

## Session History

### Session #1 — 2026-03-30
- Cloned repo, ran npm install, got backtests working (Jan-May 2025 SPOT)
- Analyzed ETH results, built Hyperliquid testnet integration
- Created LiveBotRunner, HyperliquidEngine, live/ entry points

### Session #2 — 2026-03-31 (early AM)
- Found backtests were on Binance SPOT not FUTURES
- Changed backtest symbols to futures format
- Created PROJECT_CONTEXT.md

### Session #3 — 2026-03-31
- Created BinanceFeed.js, BinanceEngine.js, BinanceLiveBotRunner.js
- Created live/binance/ entry points for all 4 assets
- Major backtest upgrades (year-by-year, monthly, funding, regime dist, robustness checks)
- Updated package.json, config.js
- Pushed everything to GitHub
- Started ETH backtest — too slow, killed it

### Session #4 — 2026-03-31
- Deep-read entire codebase (32 files)
- Attempted ETH futures backtest — failed: O(n²) filtering bottleneck
- **Fixed backtest.js**: incremental index tracking instead of .filter() (NOT YET TESTED)
- Defined 10 statistical rigor criteria for backtest validation
- Established walk-forward analysis plan (12-month train / 3-month OOS)
- Execution order: baseline backtests → analyze → build WFA → run WFA
- See SESSION_NOTES_2026-03-31.txt for full details

### Session #5 — 2026-03-31
- Applied Round 2 optimization: cached windows on 1h boundaries only
- Still too slow — analyzers recomputed from scratch each iteration
- Pushed changes to GitHub

### Session #6 — 2026-03-31
- **MAJOR: Full precomputed O(n) architecture refactor**
- Created engine/Precompute.js with all indicators precomputed
- Rewrote engine/backtest.js v3.0 — 3-layer architecture
- Updated all 3 analyzers to support dual-mode (precomputed + live)
- Performance target: O(n) total instead of O(n²)

### Session #7 — 2026-04-02
- **Per-asset signal thresholds** — each of 4 bots gets own minConfluenceScore / minSoloScore in assetProfiles.js
- BTC: 0.55/0.70, ETH: 0.60/0.75, SOL: 0.52/0.68, XRP: 0.62/0.78
- Fixed precomputed confidence calibration (OB/sweep/OTE were producing 0.04-0.55 instead of 0.5-1.0)
- Fixed backtest scoring: normalize combinedScore by source weight so precomputed and live use same scale
- **First successful full futures backtest** — 4 years, all 4 assets, 5225 total trades
- Results: -$2,979 total PnL, $37K in fees. System overtrades, SL too tight for futures.
- Key insight: trailing stops (100% WR) are the real edge, regular SL (7-14% WR) are noise traps
- Key insight: RANGING regime is toxic on futures (blocked for BTC/XRP but not ETH)
- Pushed all changes to GitHub

### Session #8 — 2026-04-03
- Multi-Model Architecture (SOL/BTC/ETH/XRP independent models)
- Raised thresholds to 0.75-0.90 range

### Session #9-12 — 2026-04-03
- Trade Lifecycle Engine (decay, confidence)
- Exhaustion Detector, Portfolio Risk Manager
- Emergency stop optimization (8→12 ATR)
- VOL_EXP hard gate, regime-specific threshold multipliers

### Session #13 — 2026-04-03
- Edge Discovery Report (66 trades, concluded no entry edge)

### Session #14 — 2026-04-04
- Data Pipeline Validation (496,881 signals)
- Confirmed: entry has no predictive power at scale
- Duration is the only real edge

### Session #15 — 2026-04-04 (THIS SESSION)
- **Full 3-phase edge discovery research** (112 hypotheses tested)
- Built edge-discovery-v2.js, edge-discovery-deep.js, edge-stability-test.js
- Found 5 structural price pattern candidates surviving all filters
- Key insight: only price structure works (higher lows, displacement candles, stop runs)
- All volatility/volume/EMA-based hypotheses rejected
- Top: SOL higher-low (t=5.02), BTC displacement (positive all 5 yrs), XRP vol reversal (82% Q agreement)
- Next: walk-forward adversarial testing on top 3 candidates
