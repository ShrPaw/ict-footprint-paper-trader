// ═══════════════════════════════════════════════════════════════════
// Monte Carlo Survival Test — Quant Risk Audit
// ═══════════════════════════════════════════════════════════════════
//
// Simulates 10,000 random reorderings of trade sequence to determine:
//   - Worst-case drawdown distribution
//   - Probability of ruin (balance < 50% of starting)
//   - Probability of hitting 20%+ drawdown
//   - Tail risk (5th percentile outcomes)
//
// Usage: node audit/monte_carlo.js <path-to-trades-csv>

import fs from 'fs';
import path from 'path';

const SIMULATIONS = 10000;
const STARTING_BALANCE = 10000;
const RUIN_THRESHOLD = 0.50;   // 50% of starting = ruin
const DD_ALERT_THRESHOLD = 0.20; // 20% DD = danger zone

// Parse trades CSV
function loadTrades(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');

  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    header.forEach((h, i) => obj[h.trim()] = vals[i]);
    return {
      pnl: parseFloat(obj.pnl),
      regime: obj.regime,
      closeReason: obj.closeReason,
      assetProfile: obj.assetProfile,
      entryTime: obj.entryTime,
    };
  }).filter(t => !isNaN(t.pnl));
}

// Shuffle array in-place (Fisher-Yates)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Run one simulation: walk through trades in given order, track equity
function simulatePath(trades, startingBalance) {
  let balance = startingBalance;
  let peak = startingBalance;
  let maxDD = 0;
  let maxDDPercent = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  let emergencyStopCount = 0;
  let firstRuinIndex = -1;

  for (let i = 0; i < trades.length; i++) {
    balance += trades[i].pnl;

    if (balance > peak) peak = balance;
    const dd = (peak - balance) / peak;
    if (dd > maxDDPercent) {
      maxDDPercent = dd;
      maxDD = peak - balance;
    }

    if (trades[i].pnl <= 0) {
      consecutiveLosses++;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    } else {
      consecutiveLosses = 0;
    }

    if (trades[i].closeReason === 'emergency_stop') emergencyStopCount++;
    if (balance <= startingBalance * RUIN_THRESHOLD && firstRuinIndex === -1) {
      firstRuinIndex = i;
    }
  }

  return {
    finalBalance: balance,
    totalPnL: balance - startingBalance,
    maxDrawdown: maxDD,
    maxDrawdownPercent: maxDDPercent,
    maxConsecutiveLosses,
    emergencyStopCount,
    ruined: balance <= startingBalance * RUIN_THRESHOLD,
    ruinIndex: firstRuinIndex,
    hitDD20: maxDDPercent >= DD_ALERT_THRESHOLD,
  };
}

// Main
const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node audit/monte_carlo.js <trades-csv>');
  process.exit(1);
}

const trades = loadTrades(csvPath);
console.log(`\n📊 Monte Carlo Survival Test — ${SIMULATIONS.toLocaleString()} simulations`);
console.log(`   Loaded ${trades.length} trades from ${path.basename(csvPath)}`);
console.log(`   Starting balance: $${STARTING_BALANCE.toLocaleString()}\n`);

// Also compute stats on the original (chronological) sequence
const originalResult = simulatePath(trades, STARTING_BALANCE);
console.log('── Original Sequence (Chronological) ─────────────');
console.log(`  Final Balance:    $${originalResult.finalBalance.toFixed(2)}`);
console.log(`  Total PnL:        $${originalResult.totalPnL.toFixed(2)}`);
console.log(`  Max Drawdown:     ${(originalResult.maxDrawdownPercent * 100).toFixed(2)}% ($${originalResult.maxDrawdown.toFixed(2)})`);
console.log(`  Max Consec Loss:  ${originalResult.maxConsecutiveLosses}`);
console.log(`  Emergency Stops:  ${originalResult.emergencyStopCount}`);
console.log(`  Ruined:           ${originalResult.ruined ? '❌ YES' : '✅ NO'}`);

// Run simulations
const results = [];
for (let i = 0; i < SIMULATIONS; i++) {
  const shuffled = shuffle([...trades]);
  results.push(simulatePath(shuffled, STARTING_BALANCE));
}

// Analyze distribution
const finalBalances = results.map(r => r.finalBalance).sort((a, b) => a - b);
const maxDDs = results.map(r => r.maxDrawdownPercent).sort((a, b) => a - b);
const consecutiveLosses = results.map(r => r.maxConsecutiveLosses).sort((a, b) => a - b);

const ruinedCount = results.filter(r => r.ruined).length;
const hitDD20Count = results.filter(r => r.hitDD20).length;

const p5 = arr => arr[Math.floor(arr.length * 0.05)];
const p10 = arr => arr[Math.floor(arr.length * 0.10)];
const p25 = arr => arr[Math.floor(arr.length * 0.25)];
const p50 = arr => arr[Math.floor(arr.length * 0.50)];
const p75 = arr => arr[Math.floor(arr.length * 0.75)];
const p95 = arr => arr[Math.floor(arr.length * 0.95)];
const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

console.log('\n── Monte Carlo Results ───────────────────────────');
console.log(`  Simulations:      ${SIMULATIONS.toLocaleString()}`);

console.log('\n  Final Balance Distribution:');
console.log(`    5th percentile:  $${p5(finalBalances).toFixed(2)}  ← WORST CASE`);
console.log(`    10th percentile: $${p10(finalBalances).toFixed(2)}`);
console.log(`    25th percentile: $${p25(finalBalances).toFixed(2)}`);
console.log(`    Median:          $${p50(finalBalances).toFixed(2)}`);
console.log(`    75th percentile: $${p75(finalBalances).toFixed(2)}`);
console.log(`    95th percentile: $${p95(finalBalances).toFixed(2)}`);
console.log(`    Mean:            $${mean(finalBalances).toFixed(2)}`);

console.log('\n  Max Drawdown Distribution:');
console.log(`    5th percentile:  ${(p5(maxDDs) * 100).toFixed(2)}%`);
console.log(`    10th percentile: ${(p10(maxDDs) * 100).toFixed(2)}%`);
console.log(`    Median:          ${(p50(maxDDs) * 100).toFixed(2)}%`);
console.log(`    95th percentile: ${(p95(maxDDs) * 100).toFixed(2)}%  ← WORST CASE`);

console.log('\n  Consecutive Loss Distribution:');
console.log(`    Median:          ${p50(consecutiveLosses)}`);
console.log(`    95th percentile: ${p95(consecutiveLosses)}`);
console.log(`    Max observed:    ${Math.max(...consecutiveLosses)}`);

console.log('\n── Survival Analysis ─────────────────────────────');
console.log(`  Probability of Ruin (<$${(STARTING_BALANCE * RUIN_THRESHOLD).toLocaleString()}): ${(ruinedCount / SIMULATIONS * 100).toFixed(2)}% (${ruinedCount}/${SIMULATIONS})`);
console.log(`  Probability of 20%+ DD:                          ${(hitDD20Count / SIMULATIONS * 100).toFixed(2)}% (${hitDD20Count}/${SIMULATIONS})`);
console.log(`  Probability of PROFIT:                           ${(results.filter(r => r.finalBalance > STARTING_BALANCE).length / SIMULATIONS * 100).toFixed(2)}%`);

// Worst case scenario
const worst = results.reduce((w, r) => r.finalBalance < w.finalBalance ? r : w);
console.log(`\n  Worst Case Scenario:`);
console.log(`    Final Balance:   $${worst.finalBalance.toFixed(2)}`);
console.log(`    Max DD:          ${(worst.maxDrawdownPercent * 100).toFixed(2)}%`);
console.log(`    Max Consec Loss: ${worst.maxConsecutiveLosses}`);

// Risk verdict
console.log('\n══════════════════════════════════════════════════════');
if (ruinedCount / SIMULATIONS > 0.05) {
  console.log('🔴 VERDICT: HIGH RISK — >5% probability of ruin');
} else if (ruinedCount / SIMULATIONS > 0.01) {
  console.log('🟡 VERDICT: MODERATE RISK — 1-5% probability of ruin');
} else if (hitDD20Count / SIMULATIONS > 0.30) {
  console.log('🟡 VERDICT: MODERATE RISK — >30% chance of 20%+ DD');
} else {
  console.log('🟢 VERDICT: LOW RISK — <1% ruin probability, manageable DD');
}
console.log('══════════════════════════════════════════════════════\n');
