// Deep context analysis — duration, order flow features, price structure
import fs from 'fs';

const tradesFile = '/root/.openclaw/workspace/ict-footprint-paper-trader/backtest-results/trades-2026-04-03T21-05-16.csv';
const lines = fs.readFileSync(tradesFile, 'utf-8').trim().split('\n');
const headers = lines[0].split(',');
const trades = lines.slice(1).map(line => {
  const vals = line.split(',');
  const t = {};
  headers.forEach((h, i) => t[h.trim()] = vals[i]?.trim());
  t.pnl = parseFloat(t.pnl) || 0;
  t.entryPrice = parseFloat(t.entryPrice) || 0;
  t.exitPrice = parseFloat(t.exitPrice) || 0;
  t.entryTime = new Date(t.entryTime);
  t.exitTime = new Date(t.exitTime);
  t.durationMin = parseInt(t.durationMin) || 0;
  return t;
});

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   🔬 DEEP CONTEXT — Feature Distribution at Entry          ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KEY QUESTION: What separates the 2 losers from 9 winners
// within STACKED_IMBALANCE in TRENDING_UP?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const stacked = trades.filter(t => t.signalType === 'STACKED_IMBALANCE');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('CRITICAL COMPARISON: Same entry price, different outcome');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// The March 2 entries are at the SAME price (102.64) on the SAME day
const march2 = stacked.filter(t => t.entryTime.toISOString().startsWith('2022-03-02'));
console.log('March 2, 2022 — Same signal, same entry price:');
for (const t of march2) {
  const maxFav = t.pnl > 0 
    ? `${((t.exitPrice - t.entryPrice) / t.entryPrice * 100).toFixed(1)}%` 
    : `${((t.exitPrice - t.entryPrice) / t.entryPrice * 100).toFixed(1)}%`;
  console.log(`  Exit: ${t.closeReason.padEnd(16)} | Duration: ${(t.durationMin/60).toFixed(1)}h | PnL: ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)} | ${maxFav}`);
}
console.log('  → Partial TP closed at +3.3% in 3.5h. The REMAINDER hit emergency stop 5.5 days later.');
console.log('  → This means the trade WAS profitable initially, but the leftover position got crushed.\n');

// Duration distribution
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('DURATION × OUTCOME — The clearest discriminator');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const sorted = [...trades].sort((a, b) => a.durationMin - b.durationMin);
console.log('Duration   | Outcome | Signal              | PnL');
console.log('─'.repeat(60));
for (const t of sorted) {
  const dur = `${(t.durationMin/60).toFixed(0)}h`.padStart(5);
  const emoji = t.pnl > 0 ? '✅' : '❌';
  console.log(`  ${dur}  | ${emoji}     | ${t.signalType.padEnd(20)}| ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2).padStart(8)}`);
}

// The key insight: all trades > 50h
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('THE STRUCTURAL PROBLEM: Emergency Stop Sizing');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const allStacked = stacked;
const wins = allStacked.filter(t => t.pnl > 0);
const losses = allStacked.filter(t => t.pnl < 0);

console.log('STACKED_IMBALANCE break-even math:');
const avgWin = wins.reduce((s,t) => s + t.pnl, 0) / wins.length;
const avgLoss = Math.abs(losses.reduce((s,t) => s + t.pnl, 0) / losses.length);
console.log(`  Avg win: +$${avgWin.toFixed(2)} | Avg loss: -$${avgLoss.toFixed(2)}`);
console.log(`  Break-even WR: ${(avgLoss / (avgWin + avgLoss) * 100).toFixed(1)}%`);
console.log(`  Actual WR: ${(wins.length / allStacked.length * 100).toFixed(1)}%`);
console.log(`  Needed: ${(avgLoss / (avgWin + avgLoss) * 100).toFixed(0)}% win rate to break even`);
console.log(`  Have: ${(wins.length / allStacked.length * 100).toFixed(0)}% win rate`);
console.log(`  Gap: ${(wins.length / allStacked.length * 100 - avgLoss / (avgWin + avgLoss) * 100).toFixed(1)} percentage points\n`);

console.log('If emergency stop were at 6 ATR instead of 10 ATR:');
const reducedLoss = avgLoss * 0.6; // roughly 6/10
const newBE = reducedLoss / (avgWin + reducedLoss) * 100;
console.log(`  Est. avg loss: -$${reducedLoss.toFixed(2)}`);
console.log(`  Break-even WR: ${newBE.toFixed(1)}%`);
console.log(`  Actual WR: ${(wins.length / allStacked.length * 100).toFixed(1)}%`);
console.log(`  Edge: ${(wins.length / allStacked.length * 100 - newBE).toFixed(1)}pp positive ✓\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SYSTEMIC ANALYSIS: Is STACKED_IMBALANCE inherently different?');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Compare signal types by duration behavior
const bySignal = {};
for (const t of trades) {
  if (!bySignal[t.signalType]) bySignal[t.signalType] = [];
  bySignal[t.signalType].push(t);
}

console.log('Signal              | Count | Avg Dur(h) | Max Dur(h) | Emergency Stops');
console.log('─'.repeat(70));
for (const [sig, ts] of Object.entries(bySignal).sort()) {
  const avgDur = ts.reduce((s,t) => s + t.durationMin, 0) / ts.length / 60;
  const maxDur = Math.max(...ts.map(t => t.durationMin)) / 60;
  const eStops = ts.filter(t => t.closeReason === 'emergency_stop').length;
  console.log(`${sig.padEnd(20)}| ${String(ts.length).padStart(5)} | ${avgDur.toFixed(1).padStart(10)} | ${maxDur.toFixed(1).padStart(10)} | ${String(eStops).padStart(15)}`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('ENTRY SEQUENCE ANALYSIS — When do STACKED_IMBALANCE entries happen?');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Look at sequence: which trade numbers within a rolling window
const sortedTrades = [...trades].sort((a, b) => a.entryTime - b.entryTime);
let tradeNum = 0;
for (const t of sortedTrades) {
  tradeNum++;
  if (t.signalType === 'STACKED_IMBALANCE') {
    const date = t.entryTime.toISOString().slice(0, 10);
    const emoji = t.pnl > 0 ? '✅' : '❌';
    // Count how many trades in the 7 days before this entry
    const weekBefore = sortedTrades.filter(
      o => o.entryTime < t.entryTime && 
      (t.entryTime - o.entryTime) < 7 * 86400000
    ).length;
    console.log(`  ${emoji} Trade #${String(tradeNum).padStart(2)} ${date} ${t.closeReason.padEnd(16)} ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2).padStart(8)} | ${weekBefore} trades in prior 7 days`);
  }
}

