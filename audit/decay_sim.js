// Simulate decay engine impact on the 2 emergency stop trades
// to verify the math before running the full backtest

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   🧮 DECAY ENGINE SIMULATION                               ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Emergency stop trade parameters from backtest data
const trades = [
  {
    date: '2022-03-02',
    entry: 102.64,
    exit: 79.94,
    pnl: -153.61,
    durationMin: 7950,
    bars: 7950 / 15,  // 15m bars
    regime: 'TRENDING_UP',
    volatilityState: 'NORMAL',  // estimated from ATR-z -0.07
    atrAtEntry: 102.64 * 0.015,  // estimate: ~1.5% ATR for SOL
  },
  {
    date: '2022-04-08',
    entry: 119.77,
    exit: 95.60,
    pnl: -343.03,
    durationMin: 14655,
    bars: 14655 / 15,
    regime: 'TRENDING_UP',
    volatilityState: 'NORMAL',
    atrAtEntry: 119.77 * 0.015,
  }
];

// Decay parameters
const volBase = { 'LOW': 72, 'NORMAL': 48, 'HIGH': 24, 'EXTREME': 16 };
const regimeMult = { 'TRENDING_UP': 1.0, 'VOL_EXPANSION': 0.75, 'RANGING': 1.5 };

console.log('DECAY PARAMETERS:');
console.log('  Base limits (15m bars): LOW=72, NORMAL=48, HIGH=24, EXTREME=16');
console.log('  Regime mult: TRENDING_UP=1.0, VOL_EXP=0.75, RANGING=1.5');
console.log('  Stage 1: 70% of emergency ATR (after decay limit)');
console.log('  Stage 2: 40% of emergency ATR (after 2x decay limit)\n');

for (const t of trades) {
  console.log(`━━━ ${t.date} Trade ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Entry: $${t.entry} | Actual exit: $${t.exit} | Loss: $${t.pnl.toFixed(2)}`);
  console.log(`  Duration: ${(t.durationMin/60).toFixed(1)}h (${t.bars} bars)`);
  console.log(`  Regime: ${t.regime} | Vol: ${t.volatilityState}`);

  const base = volBase[t.volatilityState] || 48;
  const mult = regimeMult[t.regime] || 1.0;
  const decayLimit = Math.round(base * mult);
  const stage2Limit = decayLimit * 2;

  console.log(`  Decay limit: ${decayLimit} bars (${(decayLimit * 15 / 60).toFixed(1)}h)`);
  console.log(`  Stage 2 at: ${stage2Limit} bars (${(stage2Limit * 15 / 60).toFixed(1)}h)`);

  // Original emergency stop at 10 ATR
  const originalATR = 10.0;
  const emergencyDist = t.atrAtEntry * originalATR;
  const originalStop = t.entry - emergencyDist;

  // With decay engine
  let decayStop;
  let decayExit;
  if (t.bars > stage2Limit) {
    // Stage 2: 40% of emergency
    const decayATR = originalATR * 0.4;
    decayStop = t.entry - (t.atrAtEntry * decayATR);
    decayExit = Math.max(decayStop, t.exit * 0.6 + t.entry * 0.4); // approximation
    console.log(`  Bars > ${stage2Limit} → Stage 2 → Emergency at ${(decayATR).toFixed(1)} ATR`);
  } else if (t.bars > decayLimit) {
    // Stage 1: 70% of emergency
    const decayATR = originalATR * 0.7;
    decayStop = t.entry - (t.atrAtEntry * decayATR);
    decayExit = decayStop;
    console.log(`  Bars > ${decayLimit} → Stage 1 → Emergency at ${(decayATR).toFixed(1)} ATR`);
  }

  if (decayStop !== undefined) {
    const decayPnL = (decayStop - t.entry) / t.entry * 100;
    const originalPnlPct = (t.exit - t.entry) / t.entry * 100;
    console.log(`\n  Original stop: $${originalStop.toFixed(2)} (${((originalStop-t.entry)/t.entry*100).toFixed(1)}%)`);
    console.log(`  Decay stop:    $${decayStop.toFixed(2)} (${decayPnL.toFixed(1)}%)`);
    console.log(`  Loss saved:    ~$${Math.abs(t.exit - decayStop).toFixed(2)} per unit size`);
    console.log(`  Time to exit:  ${(decayLimit * 15 / 60).toFixed(1)}h instead of ${(t.durationMin/60).toFixed(1)}h`);
  }
  console.log('');
}

// Impact on STACKED_IMBALANCE net PnL
console.log('━━━ NET PnL IMPACT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const wins = 9;
const avgWin = 35.45;
const totalWins = wins * avgWin;
console.log(`  Wins: ${wins} × $${avgWin} = +$${totalWins.toFixed(2)}`);
console.log(`  Original losses: -$153.61 + -$343.03 = -$496.64`);
console.log(`  Original net: $${(totalWins - 496.64).toFixed(2)}`);

// Estimated decay losses (rough — based on tighter stops)
const estLoss1 = 153.61 * 0.7; // Stage 1 would have caught it
const estLoss2 = 343.03 * 0.4; // Stage 2 would have caught it
const estTotalLoss = estLoss1 + estLoss2;
console.log(`  Est. decay losses: -$${estLoss1.toFixed(2)} + -$${estLoss2.toFixed(2)} = -$${estTotalLoss.toFixed(2)}`);
console.log(`  Est. decay net: $${(totalWins - estTotalLoss).toFixed(2)}`);
console.log(`  Improvement: +$${(estTotalLoss - 496.64).toFixed(2)} (saved from decay tightening)`);

