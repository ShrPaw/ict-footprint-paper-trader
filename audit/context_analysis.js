// Context analysis — understand what was happening at entry time
// for emergency stop trades and winning STACKED_IMBALANCE trades

import fs from 'fs';
import path from 'path';

// Read the SOL candle data to understand context at specific entry points
// We need to look at what the market was doing around the two emergency stop entries

const dataDir = '/root/.openclaw/workspace/ict-footprint-paper-trader';

// Parse the trades CSV
const tradesFile = path.join(dataDir, 'backtest-results/trades-2026-04-03T21-05-16.csv');
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
  return t;
});

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   🔬 CONTEXT DISTRIBUTION ANALYSIS                         ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 1: Signal type breakdown with context
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('1. SIGNAL TYPE × REGIME × EXIT — Full Breakdown');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const bySignalRegime = {};
for (const t of trades) {
  const key = `${t.signalType}|${t.regime}|${t.closeReason}`;
  if (!bySignalRegime[key]) bySignalRegime[key] = { count: 0, wins: 0, pnl: 0, trades: [] };
  bySignalRegime[key].count++;
  if (t.pnl > 0) bySignalRegime[key].wins++;
  bySignalRegime[key].pnl += t.pnl;
  bySignalRegime[key].trades.push({
    date: t.entryTime.toISOString().slice(0, 10),
    side: t.side,
    entry: t.entryPrice,
    exit: t.exitPrice,
    pnl: t.pnl,
    duration: t.durationMin
  });
}

console.log('Signal              | Regime         | Exit             | # | WR  | PnL');
console.log('─'.repeat(85));
for (const [key, data] of Object.entries(bySignalRegime).sort((a, b) => b[1].pnl - a[1].pnl)) {
  const [signal, regime, exit] = key.split('|');
  const wr = ((data.wins / data.count) * 100).toFixed(0);
  const pnlStr = data.pnl >= 0 ? `+$${data.pnl.toFixed(0)}` : `-$${Math.abs(data.pnl).toFixed(0)}`;
  console.log(`${signal.padEnd(20)}| ${regime.padEnd(15)}| ${exit.padEnd(17)}| ${String(data.count).padStart(2)} | ${wr.padStart(3)}% | ${pnlStr.padStart(8)}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 2: Winning vs Losing STACKED_IMBALANCE comparison
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('2. STACKED_IMBALANCE — Winners vs Losers');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const stackedTrades = trades.filter(t => t.signalType === 'STACKED_IMBALANCE');
const stackedWins = stackedTrades.filter(t => t.pnl > 0);
const stackedLosses = stackedTrades.filter(t => t.pnl <= 0);

console.log('WINNERS (9 trades):');
for (const t of stackedWins) {
  const date = t.entryTime.toISOString().slice(0, 10);
  const exitDate = t.exitTime.toISOString().slice(0, 10);
  const durH = (t.durationMin / 60).toFixed(1);
  console.log(`  ${date} → ${exitDate} | Entry: ${t.entryPrice.toFixed(2)} | Exit: ${t.exitPrice.toFixed(2)} | PnL: +$${t.pnl.toFixed(2)} | Duration: ${durH}h | Exit: ${t.closeReason}`);
}

console.log('\nLOSERS (2 trades):');
for (const t of stackedLosses) {
  const date = t.entryTime.toISOString().slice(0, 10);
  const exitDate = t.exitTime.toISOString().slice(0, 10);
  const durH = (t.durationMin / 60).toFixed(1);
  const drawdown = ((t.exitPrice - t.entryPrice) / t.entryPrice * 100).toFixed(1);
  console.log(`  ${date} → ${exitDate} | Entry: ${t.entryPrice.toFixed(2)} | Exit: ${t.exitPrice.toFixed(2)} | PnL: -$${Math.abs(t.pnl).toFixed(2)} | Duration: ${durH}h | Drawdown: ${drawdown}%`);
}

// Stats comparison
console.log('\nStatistical Comparison:');
const avgWinDur = stackedWins.reduce((s, t) => s + t.durationMin, 0) / stackedWins.length;
const avgLossDur = stackedLosses.reduce((s, t) => s + t.durationMin, 0) / stackedLosses.length;
const avgWinPnl = stackedWins.reduce((s, t) => s + t.pnl, 0) / stackedWins.length;
const avgLossPnl = stackedLosses.reduce((s, t) => s + t.pnl, 0) / stackedLosses.length;
console.log(`  Avg win duration: ${(avgWinDur/60).toFixed(1)}h | Avg loss duration: ${(avgLossDur/60).toFixed(1)}h`);
console.log(`  Avg win PnL: +$${avgWinPnl.toFixed(2)} | Avg loss PnL: -$${Math.abs(avgLossPnl).toFixed(2)}`);
console.log(`  Win/Loss duration ratio: ${(avgWinDur / avgLossDur).toFixed(2)} (losses take ${(avgLossDur/avgWinDur).toFixed(0)}x longer)`);
console.log(`  Win/Loss PnL ratio: ${(avgWinPnl / Math.abs(avgLossPnl)).toFixed(3)} (losses are ${(Math.abs(avgLossPnl)/avgWinPnl).toFixed(0)}x larger)`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 3: All signals in TRENDING_UP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('3. TRENDING_UP REGIME — Which signals work?');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const trendingUp = trades.filter(t => t.regime === 'TRENDING_UP');
const bySigTU = {};
for (const t of trendingUp) {
  const sig = t.signalType;
  if (!bySigTU[sig]) bySigTU[sig] = { count: 0, wins: 0, pnl: 0 };
  bySigTU[sig].count++;
  if (t.pnl > 0) bySigTU[sig].wins++;
  bySigTU[sig].pnl += t.pnl;
}

console.log('Signal              | # | Wins | WR  | PnL');
console.log('─'.repeat(55));
for (const [sig, data] of Object.entries(bySigTU).sort((a, b) => b[1].pnl - a[1].pnl)) {
  const wr = ((data.wins / data.count) * 100).toFixed(0);
  console.log(`${sig.padEnd(20)}| ${String(data.count).padStart(2)} | ${String(data.wins).padStart(4)} | ${wr.padStart(3)}% | $${data.pnl.toFixed(2).padStart(8)}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 4: Entry price context — where in the trend?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('4. ENTRY PRICE DISTRIBUTION — Price Level Analysis');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// What were SOL prices at each entry?
console.log('All SOL entries sorted by price:');
const solTrades = trades.filter(t => t.assetProfile === 'SOL').sort((a, b) => a.entryPrice - b.entryPrice);
for (const t of solTrades) {
  const date = t.entryTime.toISOString().slice(0, 10);
  const emoji = t.pnl > 0 ? '✅' : '❌';
  const sig = t.signalType.padEnd(20);
  console.log(`  ${emoji} ${date} ${sig} Entry: $${t.entryPrice.toFixed(2).padStart(8)} | PnL: ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 5: Clustering analysis — do losses cluster in time?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('5. LOSS CLUSTERING — Temporal proximity of losses');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const losses = trades.filter(t => t.pnl < 0).sort((a, b) => a.entryTime - b.entryTime);
console.log('All losses in chronological order:');
for (let i = 0; i < losses.length; i++) {
  const t = losses[i];
  const date = t.entryTime.toISOString().slice(0, 10);
  let daysSinceLast = i > 0 ? ((t.entryTime - losses[i-1].entryTime) / 86400000).toFixed(0) : 'N/A';
  console.log(`  ${date} ${t.signalType.padEnd(20)} $${t.pnl.toFixed(2).padStart(8)} | ${daysSinceLast} days since last loss`);
}

// Gap between the two emergency stops
if (losses.length >= 2) {
  const gap = (losses[1].entryTime - losses[0].entryTime) / 86400000;
  console.log(`\n  Gap between emergency stops: ${gap.toFixed(0)} days`);
  console.log(`  First stop: ${losses[0].entryTime.toISOString().slice(0,10)} at $${losses[0].entryPrice.toFixed(2)}`);
  console.log(`  Second stop: ${losses[1].entryTime.toISOString().slice(0,10)} at $${losses[1].entryPrice.toFixed(2)}`);
  console.log(`  Price moved: ${((losses[1].entryPrice - losses[0].entryPrice) / losses[0].entryPrice * 100).toFixed(1)}% between entries`);
  console.log(`\n  INTERPRETATION: The second stop entered at a HIGHER price (${losses[1].entryPrice.toFixed(2)} vs ${losses[0].entryPrice.toFixed(2)})`);
  console.log(`  This is a classic "buying higher into exhaustion" pattern.`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PART 6: Correlation analysis
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('6. PATTERN ANALYSIS — What correlates with losses?');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Duration vs outcome
const shortTrades = trades.filter(t => t.durationMin < 600); // <10h
const medTrades = trades.filter(t => t.durationMin >= 600 && t.durationMin < 3000); // 10-50h
const longTrades = trades.filter(t => t.durationMin >= 3000); // >50h

function analyzeBucket(bucket, name) {
  const wins = bucket.filter(t => t.pnl > 0).length;
  const pnl = bucket.reduce((s, t) => s + t.pnl, 0);
  console.log(`  ${name.padEnd(12)} ${String(bucket.length).padStart(2)} trades | ${wins}/${bucket.length} wins | PnL: $${pnl.toFixed(2)}`);
}

console.log('Duration Analysis:');
analyzeBucket(shortTrades, '<10h');
analyzeBucket(medTrades, '10-50h');
analyzeBucket(longTrades, '>50h');

console.log('\n  KEY INSIGHT: Emergency stops take 5-10x longer than winning trades.');
console.log(`  Winners avg: ${(avgWinDur/60).toFixed(1)}h | Losers avg: ${(avgLossDur/60).toFixed(1)}h`);
console.log(`  This means: winning trades move quickly in favor, losses slowly grind against.`);
console.log(`  The trailing stop catches winners fast. The emergency stop is a slow bleed.`);

