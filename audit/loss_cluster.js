// ═══════════════════════════════════════════════════════════════════
// Loss Cluster & Dependency Analysis — Quant Risk Audit
// ═══════════════════════════════════════════════════════════════════
//
// Analyzes:
//   1. Loss clustering — are losses random or clustered?
//   2. SOL dependency — is the system profitable without SOL?
//   3. Emergency stop patterns — what regime/signal causes them?
//   4. Entry quality — why did losing trades exist?
//   5. Single-trade dependency — PnL without largest win

import fs from 'fs';
import path from 'path';

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
      signalType: obj.signalType,
      entryTime: obj.entryTime,
      durationMin: parseInt(obj.durationMin),
      totalFees: parseFloat(obj.totalFees),
    };
  }).filter(t => !isNaN(t.pnl));
}

const csvPath = process.argv[2];
if (!csvPath) { console.error('Usage: node audit/loss_cluster.js <trades-csv>'); process.exit(1); }

const trades = loadTrades(csvPath);
const wins = trades.filter(t => t.pnl > 0);
const losses = trades.filter(t => t.pnl <= 0);
const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);

console.log(`\n📊 Loss Cluster & Dependency Analysis`);
console.log(`   ${trades.length} trades loaded\n`);

// ═══════════════════════════════════════════════════════════════════
// 1. LOSS CLUSTERING
// ═══════════════════════════════════════════════════════════════════
console.log('── 1. Loss Clustering Analysis ──────────────────');

// Count consecutive loss runs
const lossRuns = [];
let currentRun = 0;
for (const t of trades) {
  if (t.pnl <= 0) { currentRun++; }
  else { if (currentRun > 0) lossRuns.push(currentRun); currentRun = 0; }
}
if (currentRun > 0) lossRuns.push(currentRun);

const runDistribution = {};
lossRuns.forEach(r => { runDistribution[r] = (runDistribution[r] || 0) + 1; });

console.log('  Consecutive loss run distribution:');
for (const [len, count] of Object.entries(runDistribution).sort((a, b) => a[0] - b[0])) {
  console.log(`    ${len} consecutive losses: ${count} occurrences`);
}
console.log(`  Max consecutive losses: ${Math.max(...lossRuns, 0)}`);
console.log(`  Avg consecutive loss run: ${(lossRuns.reduce((a, b) => a + b, 0) / Math.max(lossRuns.length, 1)).toFixed(1)}`);

// Are losses temporally clustered? (check if losses tend to happen close together)
const lossIndices = trades.map((t, i) => t.pnl <= 0 ? i : -1).filter(i => i >= 0);
const gaps = [];
for (let i = 1; i < lossIndices.length; i++) gaps.push(lossIndices[i] - lossIndices[i - 1]);
if (gaps.length > 0) {
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const expectedGap = trades.length / losses.length;
  console.log(`  Avg gap between losses: ${avgGap.toFixed(1)} trades (expected if random: ${expectedGap.toFixed(1)})`);
  if (avgGap < expectedGap * 0.7) {
    console.log(`  ⚠️  CLUSTERED: Losses are ${(expectedGap / avgGap).toFixed(1)}x closer than random expectation`);
  } else {
    console.log(`  ✅ Distribution appears approximately random`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. MODEL DEPENDENCY (SOL removal test)
// ═══════════════════════════════════════════════════════════════════
console.log('\n── 2. Model Dependency (SOL Removal) ───────────');

const byAsset = {};
for (const t of trades) {
  if (!byAsset[t.assetProfile]) byAsset[t.assetProfile] = [];
  byAsset[t.assetProfile].push(t);
}

for (const [asset, assetTrades] of Object.entries(byAsset).sort()) {
  const aPnL = assetTrades.reduce((s, t) => s + t.pnl, 0);
  const aWins = assetTrades.filter(t => t.pnl > 0).length;
  const aWR = ((aWins / assetTrades.length) * 100).toFixed(1);
  const aPF = (() => {
    const gp = assetTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(assetTrades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
    return gl > 0 ? (gp / gl).toFixed(2) : '∞';
  })();
  console.log(`  ${asset.padEnd(6)} ${String(assetTrades.length).padStart(4)} trades | ${aWR}% WR | PF ${aPF} | PnL: $${aPnL.toFixed(2)}`);
}

const withoutSOL = trades.filter(t => t.assetProfile !== 'SOL');
const solPnL = (byAsset['SOL'] || []).reduce((s, t) => s + t.pnl, 0);
const withoutSOLPnL = withoutSOL.reduce((s, t) => s + t.pnl, 0);
const solPct = totalPnL > 0 ? ((solPnL / totalPnL) * 100).toFixed(1) : 'N/A';

console.log(`\n  Total PnL:           $${totalPnL.toFixed(2)}`);
console.log(`  SOL PnL:             $${solPnL.toFixed(2)} (${solPct}% of total)`);
console.log(`  Without SOL:         $${withoutSOLPnL.toFixed(2)}`);
console.log(`  SOL Dependency:      ${parseFloat(solPct) > 60 ? '🔴 CRITICAL — system depends on single asset' : parseFloat(solPct) > 40 ? '🟡 HIGH — significant concentration' : '🟢 DIVERSIFIED'}`);

// ═══════════════════════════════════════════════════════════════════
// 3. EMERGENCY STOP ANALYSIS
// ═══════════════════════════════════════════════════════════════════
console.log('\n── 3. Emergency Stop Patterns ──────────────────');

const emergencyStops = trades.filter(t => t.closeReason === 'emergency_stop');
console.log(`  Total emergency stops: ${emergencyStops.length}`);
console.log(`  Emergency PnL:         $${emergencyStops.reduce((s, t) => s + t.pnl, 0).toFixed(2)}`);
console.log(`  Avg loss per stop:     $${(emergencyStops.reduce((s, t) => s + t.pnl, 0) / Math.max(emergencyStops.length, 1)).toFixed(2)}`);

// By regime
const emergByRegime = {};
for (const t of emergencyStops) {
  if (!emergByRegime[t.regime]) emergByRegime[t.regime] = { count: 0, pnl: 0 };
  emergByRegime[t.regime].count++;
  emergByRegime[t.regime].pnl += t.pnl;
}
console.log('  By regime:');
for (const [regime, data] of Object.entries(emergByRegime).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`    ${regime.padEnd(16)} ${data.count} stops | $${data.pnl.toFixed(2)}`);
}

// By asset
const emergByAsset = {};
for (const t of emergencyStops) {
  if (!emergByAsset[t.assetProfile]) emergByAsset[t.assetProfile] = { count: 0, pnl: 0 };
  emergByAsset[t.assetProfile].count++;
  emergByAsset[t.assetProfile].pnl += t.pnl;
}
console.log('  By asset:');
for (const [asset, data] of Object.entries(emergByAsset).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`    ${asset.padEnd(6)} ${data.count} stops | $${data.pnl.toFixed(2)}`);
}

// By signal type
const emergBySignal = {};
for (const t of emergencyStops) {
  if (!emergBySignal[t.signalType]) emergBySignal[t.signalType] = { count: 0, pnl: 0 };
  emergBySignal[t.signalType].count++;
  emergBySignal[t.signalType].pnl += t.pnl;
}
console.log('  By signal type:');
for (const [sig, data] of Object.entries(emergBySignal).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`    ${sig.padEnd(24)} ${data.count} stops | $${data.pnl.toFixed(2)}`);
}

// Clustering: did emergency stops happen in bursts?
const emergTimes = emergencyStops.map(t => new Date(t.entryTime).getTime()).sort((a, b) => a - b);
let clusterCount = 0;
for (let i = 1; i < emergTimes.length; i++) {
  const gapHours = (emergTimes[i] - emergTimes[i - 1]) / (1000 * 60 * 60);
  if (gapHours < 24) clusterCount++;
}
console.log(`\n  Clustering: ${clusterCount} of ${emergTimes.length - 1} gaps between stops < 24h`);
if (clusterCount > (emergTimes.length - 1) * 0.3) {
  console.log(`  ⚠️  STOPS ARE CLUSTERED — systemic failure, not random noise`);
}

// ═══════════════════════════════════════════════════════════════════
// 4. ENTRY QUALITY — Losing Trades Analysis
// ═══════════════════════════════════════════════════════════════════
console.log('\n── 4. Entry Quality (Losing Trades) ────────────');

const lossesByRegime = {};
for (const t of losses) {
  if (!lossesByRegime[t.regime]) lossesByRegime[t.regime] = { count: 0, pnl: 0 };
  lossesByRegime[t.regime].count++;
  lossesByRegime[t.regime].pnl += t.pnl;
}

console.log('  Losses by regime:');
for (const [regime, data] of Object.entries(lossesByRegime).sort((a, b) => b[1].count - a[1].count)) {
  // Calculate what % of trades in this regime were losses
  const regimeTrades = trades.filter(t => t.regime === regime);
  const lossRate = ((data.count / regimeTrades.length) * 100).toFixed(1);
  console.log(`    ${regime.padEnd(16)} ${data.count} losses (${lossRate}% of regime trades) | $${data.pnl.toFixed(2)}`);
}

console.log('\n  Losses by close reason:');
const lossesByReason = {};
for (const t of losses) {
  if (!lossesByReason[t.closeReason]) lossesByReason[t.closeReason] = { count: 0, pnl: 0 };
  lossesByReason[t.closeReason].count++;
  lossesByReason[t.closeReason].pnl += t.pnl;
}
for (const [reason, data] of Object.entries(lossesByReason).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`    ${reason.padEnd(20)} ${data.count} losses | $${data.pnl.toFixed(2)}`);
}

// Loss duration analysis
const lossDurations = losses.filter(t => t.durationMin).map(t => t.durationMin).sort((a, b) => a - b);
if (lossDurations.length > 0) {
  console.log('\n  Loss trade duration:');
  console.log(`    Median: ${p50(lossDurations)} minutes`);
  console.log(`    < 60min: ${lossDurations.filter(d => d < 60).length} (${((lossDurations.filter(d => d < 60).length / lossDurations.length) * 100).toFixed(1)}%)`);
  console.log(`    < 240min: ${lossDurations.filter(d => d < 240).length} (${((lossDurations.filter(d => d < 240).length / lossDurations.length) * 100).toFixed(1)}%)`);
}

// ═══════════════════════════════════════════════════════════════════
// 5. SINGLE-TRADE DEPENDENCY
// ═══════════════════════════════════════════════════════════════════
console.log('\n── 5. Single-Trade Dependency ──────────────────');

const sortedByPnL = [...trades].sort((a, b) => b.pnl - a.pnl);
const top5 = sortedByPnL.slice(0, 5);
const top5PnL = top5.reduce((s, t) => s + t.pnl, 0);
const withoutTop5 = totalPnL - top5PnL;

console.log(`  Top 5 trades contribute: $${top5PnL.toFixed(2)} (${((top5PnL / totalPnL) * 100).toFixed(1)}% of total PnL)`);
console.log(`  PnL without top 5:       $${withoutTop5.toFixed(2)}`);
for (let i = 0; i < top5.length; i++) {
  const t = top5[i];
  console.log(`    #${i + 1}: $${t.pnl.toFixed(2)} | ${t.assetProfile} | ${t.regime} | ${t.closeReason}`);
}

const largestWin = sortedByPnL[0];
const withoutLargest = totalPnL - largestWin.pnl;
console.log(`\n  Without single largest win ($${largestWin.pnl.toFixed(2)}): $${withoutLargest.toFixed(2)}`);
if (withoutLargest < 0) {
  console.log(`  🔴 SYSTEM IS NEGATIVE WITHOUT LARGEST TRADE — fragile`);
} else {
  console.log(`  ✅ System remains profitable without largest trade`);
}

// Helper
function p50(arr) { return arr[Math.floor(arr.length * 0.5)]; }

console.log('\n══════════════════════════════════════════════════════\n');
