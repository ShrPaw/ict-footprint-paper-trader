# 🔬 A/B TEST RESULTS — Portfolio Risk & Exhaustion Impact

**Date:** 2026-04-03 | **Test:** Disable portfolio risk manager + exhaustion detector

---

## HEADLINE

**The portfolio risk manager was NOT over-conservative. It was the ONLY thing keeping the system alive.**

Without it, the system trades across all years but the emergency stops destroy everything.

---

## A/B COMPARISON TABLE

| Asset | Filters | Trades | WR | PF | PnL | Max DD | Years |
|-------|---------|--------|-----|-----|-----|--------|-------|
| SOL | WITH | 50 | 96% | 3.36 | **+$1,170** | 3.3% | 2022 only |
| SOL | WITHOUT | 284 | 83% | 1.03 | +$582 | **24.1%** | all |
| BTC | WITH | 4 | 75% | 0.13 | -$1,167 | 16.2% | 2022 only |
| BTC | WITHOUT | 194 | 87% | 1.31 | +$6,867 | **39.7%** | all |
| ETH | WITH | 12 | 83% | 0.52 | -$217 | N/A | 2022 only |
| ETH | WITHOUT | 243 | 82% | 1.00 | -$100 | 13.2% | all |
| XRP | WITH | 10 | 80% | 0.51 | -$152 | 2.4% | 2022 only |
| XRP | WITHOUT | 146 | 77% | 0.79 | **-$1,240** | 15.5% | all |
| **ALL** | **WITH** | **76** | **91%** | **N/A** | **-$366** | | **2022 only** |
| **ALL** | **WITHOUT** | **867** | **82%** | **1.06** | **+$6,109** | | **all years** |

---

## THE EMERGENCY STOP PROBLEM

Without filters, 152 emergency stops fire across all assets. **They are the system killer.**

| Asset | Emergency Stops | Stop Loss | Take Profit | Net |
|-------|----------------|-----------|-------------|-----|
| SOL | 49 | -$17,976 | +$11,417 | -$6,559 |
| BTC | 26 | -$22,142 | +$19,192 | -$2,950 |
| ETH | 44 | -$9,676 | +$6,112 | -$3,564 |
| XRP | 33 | -$5,775 | +$2,937 | -$2,838 |
| **ALL** | **152** | **-$55,569** | **+$39,658** | **-$15,911** |

**Key insight:** Take profits produce +$39,658 across all assets. Partial TPs produce another ~$15K+. The exit management IS robust. But emergency stops at 12 ATR produce -$55,569 — wiping out all gains.

---

## REGIME BREAKDOWN (ALL ASSETS COMBINED, NO FILTERS)

| Regime | Trades | WR | PnL | Verdict |
|--------|--------|-----|-----|---------|
| RANGING | 222 | 88% | -$185 | ~breakeven |
| TRENDING_UP | 341 | 81% | -$3,046 | loses |
| VOL_EXPANSION | 304 | 79% | **-$12,841** | **DESTROYS** |
| TRENDING_DOWN | blocked | — | — | — |
| LOW_VOL | blocked | — | — | — |

**VOL_EXPANSION is the killer regime.** The regime where BTC and XRP supposedly have their "edge" (per README) actually loses $12,841 combined.

---

## YEAR-BY-YEAR (ALL ASSETS, NO FILTERS)

| Year | Trades | WR | PnL |
|------|--------|-----|-----|
| 2022 | 187 | 83% | +$1,079 |
| 2023 | 173 | 86% | -$2,589 |
| 2024 | 242 | 82% | +$1,630 |
| 2025 | 217 | 79% | **-$14,968** |
| 2026 | 48 | 75% | -$1,663 |

**2025 is catastrophic.** -$14,968 in a single year. This completely destroys any edge from 2022-2024.

---

## ROOT CAUSE ANALYSIS

### Why Emergency Stops Are So Destructive

The emergency stop is set at **12 ATR** from entry. This means:
- A trade must move 12x the average true range against the position before stopping out
- During VOL_EXPANSION, ATR is already elevated (high volatility)
- 12 ATR during VOL_EXP = a HUGE dollar distance
- But the trade still reaches it — meaning the entry was catastrophically wrong

**The 12 ATR emergency stop is not tight — the entries are fundamentally wrong during volatile markets.**

### Why Portfolio Risk "Saved" the System

The original system (with portfolio risk) executed only 50-76 trades. These were the "cream of the crop" — the signals that passed ALL quality gates AND the portfolio risk state was clean enough to allow them.

The portfolio risk manager effectively **survivorship-biased** the results:
- Only trades when portfolio state is NORMAL
- After 2 emergency stops → blocks everything
- Result: Only the best early-window trades execute
- Those trades look great (96% WR, PF 3.36) but it's because the system stopped trading before it could fail

### Why 2022 Looked Good

2022 was a specific market regime (crypto winter, high volatility, strong directional moves). The system's ICT + order flow signals happened to work in that environment. But:
- The same signals fail in 2023-2025
- The system has NO adaptive mechanism for regime change
- The "edge" was regime-specific, not structural

---

## WHAT ACTUALLY WORKS

### Confirmed Edge:
1. **Trailing stops** — 100% WR when they activate. Genuine risk management.
2. **Partial TP** — 100% WR. De-risks positions. Works.
3. **DELTA_DIVERGENCE signal** — Best signal type. Has real edge in RANGING regime.

### Not Edge:
1. **STACKED_IMBALANCE signal** — Causes most emergency stops
2. **VOL_EXPANSION regime** — -$12,841 combined. All assets lose.
3. **Fixed 12 ATR emergency stop** — Too wide, allows catastrophic losses
4. **The entire entry model** — PF 1.06 without filters = barely breakeven before fees

---

## FINAL VERDICT

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   The system has NO STRUCTURAL EDGE in entry signals.       ║
║                                                              ║
║   What appeared to be edge was:                             ║
║   1. Portfolio risk survivorship bias (cherry-picking)      ║
║   2. 2022-specific regime fit                               ║
║   3. Exit management (trailing stops) doing heavy lifting   ║
║                                                              ║
║   Without filters: PF 1.06 across 867 trades = NO EDGE     ║
║   With filters: PF 3.36 on 50 trades = NOT VALIDATABLE     ║
║                                                              ║
║   The ONLY real edge is:                                    ║
║   • Exit management (trailing + partial TP)                 ║
║   • DELTA_DIVERGENCE in RANGING regime                      ║
║                                                              ║
║   Everything else needs fundamental redesign.               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

---

## WHAT TO DO NEXT

1. **If you want to save this system:** Focus ONLY on DELTA_DIVERGENCE + RANGING regime. Block everything else. Test this narrow hypothesis.

2. **If you want to rebuild:** Keep the exit management (it works). Completely redesign entry signals. Add walk-forward validation from day one.

3. **Critical fix regardless:** Replace the 12 ATR emergency stop with a regime-adaptive stop (tighter in VOL_EXP, wider in RANGING).
