#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Entry Isolation Analyzer — Phase 2-6 Complete
// ═══════════════════════════════════════════════════════════════════
//
// Reads expanded dataset, isolates entry from exit, analyzes:
//   - Entry predictive power (fixed RR vs random)
//   - Feature interactions (combinations)
//   - Time-dependent edge
//   - Loss forensics
//   - Temporal validation

import fs from 'fs';
import path from 'path';

// ── Find latest expanded dataset ──────────────────────────────────
const dataDir = path.join(process.cwd(), 'data');

function findLatest(pattern) {
  const files = fs.readdirSync(dataDir).filter(f => f.startsWith(pattern)).sort();
  return files.length ? path.join(dataDir, files[files.length - 1]) : null;
}

const datasetFile = findLatest('expanded-dataset-');

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   ** ENTRY ISOLATION ANALYZER v1.0                  ║');
console.log('║   Does entry have predictive power?                  ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

if (!datasetFile) {
  console.error('❌ No expanded dataset found. Run data-expansion-engine.js first.');
  process.exit(1);
}

console.log(`  Dataset: ${path.basename(datasetFile)}`);

// ═══════════════════════════════════════════════════════════════════
// PHASE 1: LOAD DATA
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 1: Loading Data ──────────────────────────');

// Stream-read the JSONL file (too large for synchronous read)
const signals = [];
const readline = await import('readline');
const rl = readline.createInterface({
  input: fs.createReadStream(datasetFile),
  crlfDelay: Infinity,
});
for await (const line of rl) {
  try { signals.push(JSON.parse(line)); } catch {}
}

console.log(`  == Signals loaded: ${signals.length.toLocaleString()}`);

// Count by symbol
const bySymbol = {};
for (const s of signals) {
  const sym = s.symbol || 'unknown';
  bySymbol[sym] = (bySymbol[sym] || 0) + 1;
}
for (const [sym, count] of Object.entries(bySymbol)) {
  console.log(`    ${sym}: ${count.toLocaleString()} signals`);
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 2: ENTRY ISOLATION — Fixed RR vs Random Baseline
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 2: Entry Isolation (Fixed RR vs Random) ──');

const exitTypes = ['rr_1', 'rr_2', 'rr_3', 'time_4h', 'time_8h', 'time_12h', 'time_24h', 'time_48h', 'time_7d', 'trailing', 'emergency_only', 'random'];

// Overall exit comparison
console.log('\n  All Signals — Exit Comparison:');
for (const exitType of exitTypes) {
  const pnls = signals.map(s => s.exits?.[exitType]?.pnl).filter(p => p !== undefined && p !== null);
  if (pnls.length === 0) continue;
  const n = pnls.length;
  const totalPnL = pnls.reduce((a, b) => a + b, 0);
  const avgPnL = totalPnL / n;
  const wins = pnls.filter(p => p > 0).length;
  const wr = ((wins / n) * 100).toFixed(1);
  const grossProfit = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0));
  const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞';
  const vsRandom = exitType === 'random' ? '' : '';
  console.log(`    ${exitType.padEnd(16)} ${String(n).padStart(6)} | ${wr.padStart(5)}% WR | PF=${pf.padStart(5)} | Avg=$${avgPnL.toFixed(4).padStart(8)} | Total=$${totalPnL.toFixed(0).padStart(8)}`);
}

// Per-symbol exit comparison
for (const symbol of Object.keys(bySymbol)) {
  const sigs = signals.filter(s => s.symbol === symbol);
  if (sigs.length === 0) continue;
  console.log(`\n  ${symbol} (${sigs.length.toLocaleString()} signals):`);
  for (const exitType of exitTypes) {
    const pnls = sigs.map(s => s.exits?.[exitType]?.pnl).filter(p => p !== undefined && p !== null);
    if (pnls.length === 0) continue;
    const n = pnls.length;
    const totalPnL = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter(p => p > 0).length;
    const wr = ((wins / n) * 100).toFixed(1);
    const grossProfit = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0));
    const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞';
    console.log(`    ${exitType.padEnd(16)} ${String(n).padStart(6)} | ${wr.padStart(5)}% WR | PF=${pf.padStart(5)} | Total=$${totalPnL.toFixed(0).padStart(8)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: ENTRY PREDICTIVE POWER — Signal vs Random
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 3: Entry Predictive Power (vs Random) ───');

// Compare directional signals (long/short) with random exit
// If entry has predictive power, directional signals should outperform random
for (const symbol of Object.keys(bySymbol)) {
  const sigs = signals.filter(s => s.symbol === symbol);
  if (sigs.length < 100) continue;

  console.log(`\n  ${symbol}:`);

  // Long vs Short vs Random
  const longs = sigs.filter(s => s.direction === 'long');
  const shorts = sigs.filter(s => s.direction === 'short');

  for (const [label, group] of [['Long', longs], ['Short', shorts]]) {
    if (group.length === 0) continue;

    const rr2Pnls = group.map(s => s.exits?.rr_2?.pnl).filter(p => p !== undefined);
    const randomPnls = group.map(s => s.exits?.random?.pnl).filter(p => p !== undefined);
    const trailingPnls = group.map(s => s.exits?.trailing?.pnl).filter(p => p !== undefined);

    if (rr2Pnls.length === 0) continue;

    const rr2Total = rr2Pnls.reduce((a, b) => a + b, 0);
    const rr2WR = rr2Pnls.filter(p => p > 0).length / rr2Pnls.length;
    const randomTotal = randomPnls.reduce((a, b) => a + b, 0);
    const randomWR = randomPnls.filter(p => p > 0).length / randomPnls.length;
    const trailingTotal = trailingPnls.reduce((a, b) => a + b, 0);
    const trailingWR = trailingPnls.filter(p => p > 0).length / trailingPnls.length;

    const rr2VsRandom = rr2Total - randomTotal;
    const edge = rr2VsRandom > 0 ? 'OK ENTRY HAS EDGE' : 'XX NO ENTRY EDGE';

    console.log(`    ${label} (${group.length}):`);
    console.log(`      RR 1:2:     WR=${(rr2WR * 100).toFixed(1)}% | Total=$${rr2Total.toFixed(0)}`);
    console.log(`      Random:     WR=${(randomWR * 100).toFixed(1)}% | Total=$${randomTotal.toFixed(0)}`);
    console.log(`      Trailing:   WR=${(trailingWR * 100).toFixed(1)}% | Total=$${trailingTotal.toFixed(0)}`);
    console.log(`      RR vs Rand: $${rr2VsRandom.toFixed(0)} ${edge}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 4: FEATURE INTERACTION ANALYSIS
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 4: Feature Interaction Analysis ─────────');

function analyzeGroup(signals, groupFn, label, exitType = 'trailing') {
  const groups = {};
  for (const s of signals) {
    const key = groupFn(s);
    if (!key) continue;
    const pnl = s.exits?.[exitType]?.pnl;
    if (pnl === undefined) continue;
    if (!groups[key]) groups[key] = { n: 0, pnl: 0, wins: 0, totalPnL: 0 };
    groups[key].n++;
    groups[key].pnl += pnl;
    groups[key].totalPnL += pnl;
    if (pnl > 0) groups[key].wins++;
  }

  // Compute PF per group
  const results = [];
  for (const [key, g] of Object.entries(groups)) {
    if (g.n < 10) continue; // need minimum sample
    const wr = g.wins / g.n;
    const pnls = signals.filter(s => groupFn(s) === key).map(s => s.exits?.[exitType]?.pnl).filter(p => p !== undefined);
    const grossProfit = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
    results.push({ key, n: g.n, wr, pf, pnl: g.totalPnL });
  }

  results.sort((a, b) => b.pf - a.pf);
  return results;
}

// Regime × Direction
console.log('\n  Regime × Direction (trailing exit):');
const regimeDirection = analyzeGroup(signals, s => `${s.regime}+${s.direction}`);
for (const r of regimeDirection.slice(0, 15)) {
  const emoji = r.pnl > 0 ? 'OK' : 'XX';
  console.log(`    ${emoji} ${r.key.padEnd(30)} n=${String(r.n).padStart(5)} | ${(r.wr * 100).toFixed(0)}% WR | PF=${r.pf === Infinity ? '∞' : r.pf.toFixed(2).padStart(5)} | PnL=$${r.pnl.toFixed(0).padStart(8)}`);
}

// Stacked × Divergence
console.log('\n  Stacked Count × Divergence (trailing exit):');
const stackedDiv = analyzeGroup(signals, s => {
  const sc = s.stackedCount || 0;
  const bucket = sc <= 2 ? 'low' : sc <= 4 ? 'med' : 'high';
  return `${bucket}+${s.divergence}`;
});
for (const r of stackedDiv.slice(0, 10)) {
  const emoji = r.pnl > 0 ? 'OK' : 'XX';
  console.log(`    ${emoji} ${r.key.padEnd(20)} n=${String(r.n).padStart(5)} | ${(r.wr * 100).toFixed(0)}% WR | PF=${r.pf === Infinity ? '∞' : r.pf.toFixed(2).padStart(5)} | PnL=$${r.pnl.toFixed(0).padStart(8)}`);
}

// ATR-z × Extension
console.log('\n  Volatility × Extension (trailing exit):');
const volExt = analyzeGroup(signals, s => {
  const vol = s.atrZ < 1.0 ? 'lowV' : s.atrZ < 1.5 ? 'normV' : 'highV';
  const ext = s.distFromMean < 1.0 ? 'lowE' : s.distFromMean < 2.0 ? 'medE' : 'highE';
  return `${vol}+${ext}`;
});
for (const r of volExt.slice(0, 12)) {
  const emoji = r.pnl > 0 ? 'OK' : 'XX';
  console.log(`    ${emoji} ${r.key.padEnd(16)} n=${String(r.n).padStart(5)} | ${(r.wr * 100).toFixed(0)}% WR | PF=${r.pf === Infinity ? '∞' : r.pf.toFixed(2).padStart(5)} | PnL=$${r.pnl.toFixed(0).padStart(8)}`);
}

// Regime × Volatility × Extension (3-way)
console.log('\n  Regime × Volatility × Extension — Top 15 (trailing):');
const threeWay = analyzeGroup(signals, s => {
  const vol = s.atrZ < 1.0 ? 'LV' : s.atrZ < 1.5 ? 'NV' : 'HV';
  const ext = s.distFromMean < 1.0 ? 'LE' : s.distFromMean < 2.0 ? 'ME' : 'HE';
  return `${s.regime}|${vol}|${ext}`;
});
for (const r of threeWay.filter(x => x.n >= 20).slice(0, 15)) {
  const emoji = r.pnl > 0 ? 'OK' : 'XX';
  console.log(`    ${emoji} ${r.key.padEnd(28)} n=${String(r.n).padStart(5)} | ${(r.wr * 100).toFixed(0)}% WR | PF=${r.pf === Infinity ? '∞' : r.pf.toFixed(2).padStart(5)} | PnL=$${r.pnl.toFixed(0).padStart(8)}`);
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 5: TIME-DEPENDENT EDGE
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 5: Time-Dependent Edge ───────────────────');

// Duration bins from trailing exit
console.log('\n  Duration Distribution (trailing exit):');
const durationBins = [
  { label: '≤1h', max: 60 },
  { label: '1-2h', max: 120 },
  { label: '2-4h', max: 240 },
  { label: '4-8h', max: 480 },
  { label: '8-12h', max: 720 },
  { label: '12-24h', max: 1440 },
  { label: '24-48h', max: 2880 },
  { label: '48h+', max: Infinity },
];

const trailingDurations = signals.map(s => ({
  duration: s.exits?.trailing?.durationMin,
  pnl: s.exits?.trailing?.pnl,
  reason: s.exits?.trailing?.reason,
})).filter(d => d.duration !== undefined && d.pnl !== undefined);

for (const bin of durationBins) {
  const prevMax = durationBins[durationBins.indexOf(bin) - 1]?.max || 0;
  const inBin = trailingDurations.filter(d => d.duration > prevMax && d.duration <= bin.max);
  if (inBin.length === 0) continue;
  const wins = inBin.filter(d => d.pnl > 0);
  const wr = ((wins.length / inBin.length) * 100).toFixed(0);
  const pnl = inBin.reduce((s, d) => s + d.pnl, 0);
  console.log(`    ${bin.label.padEnd(10)} ${String(inBin.length).padStart(6)} trades | ${wr}% WR | PnL=$${pnl.toFixed(0).padStart(8)}`);
}

// Cumulative PnL by max duration
console.log('\n  Cumulative PnL by Max Duration:');
const maxDurations = [60, 120, 240, 480, 720, 1440, 2880];
for (const maxDur of maxDurations) {
  const inBin = trailingDurations.filter(d => d.duration <= maxDur);
  if (inBin.length === 0) continue;
  const wins = inBin.filter(d => d.pnl > 0);
  const wr = ((wins.length / inBin.length) * 100).toFixed(0);
  const pnl = inBin.reduce((s, d) => s + d.pnl, 0);
  console.log(`    ≤${String(maxDur).padStart(5)}min  ${String(inBin.length).padStart(6)} trades | ${wr}% WR | PnL=$${pnl.toFixed(0).padStart(8)}`);
}

// Hour of day analysis
console.log('\n  By Hour of Day (trailing exit):');
const byHour = {};
for (const s of signals) {
  const h = s.hour;
  const pnl = s.exits?.trailing?.pnl;
  if (pnl === undefined) continue;
  if (!byHour[h]) byHour[h] = { n: 0, pnl: 0, wins: 0 };
  byHour[h].n++;
  byHour[h].pnl += pnl;
  if (pnl > 0) byHour[h].wins++;
}
for (let h = 0; h < 24; h++) {
  const d = byHour[h];
  if (!d || d.n < 10) continue;
  const wr = ((d.wins / d.n) * 100).toFixed(0);
  const emoji = d.pnl > 0 ? 'OK' : 'XX';
  console.log(`    ${emoji} ${String(h).padStart(2)}:00 UTC  ${String(d.n).padStart(5)} trades | ${wr}% WR | PnL=$${d.pnl.toFixed(0).padStart(8)}`);
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 6: LOSS FORENSICS
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 6: Loss Forensics ────────────────────────');

// Find the worst trades (trailing exit, emergency)
const allTrailingPnls = signals.map(s => ({
  pnl: s.exits?.trailing?.pnl,
  direction: s.direction,
  regime: s.regime,
  stacked: s.stackedCount,
  atrZ: s.atrZ,
  dist: s.distFromMean,
  momentum: s.momentum,
  volRatio: s.volRatio,
  divergence: s.divergence,
  pricePosition: s.pricePosition,
  hour: s.hour,
  duration: s.exits?.trailing?.durationMin,
  reason: s.exits?.trailing?.reason,
})).filter(d => d.pnl !== undefined);

const losers = allTrailingPnls.filter(d => d.pnl < 0).sort((a, b) => a.pnl - b.pnl);
const winners = allTrailingPnls.filter(d => d.pnl > 0);

console.log(`\n  Losers: ${losers.length} | Winners: ${winners.length}`);
console.log(`  Total loss: $${losers.reduce((s, d) => s + d.pnl, 0).toFixed(0)}`);
console.log(`  Total win: $${winners.reduce((s, d) => s + d.pnl, 0).toFixed(0)}`);

// Feature comparison: losers vs winners
console.log('\n  Feature Comparison (Losers vs Winners):');
const compareFeatures = ['stacked', 'atrZ', 'dist', 'momentum', 'volRatio', 'pricePosition'];
for (const feat of compareFeatures) {
  const loserVals = losers.map(d => d[feat]).filter(v => v !== undefined && v !== null);
  const winnerVals = winners.map(d => d[feat]).filter(v => v !== undefined && v !== null);
  if (loserVals.length === 0 || winnerVals.length === 0) continue;
  const loserAvg = loserVals.reduce((a, b) => a + b, 0) / loserVals.length;
  const winnerAvg = winnerVals.reduce((a, b) => a + b, 0) / winnerVals.length;
  const delta = loserAvg - winnerAvg;
  const sig = Math.abs(delta) > (Math.abs(winnerAvg) * 0.15) ? '!!' : '  ';
  console.log(`    ${feat.padEnd(16)} Loser=${loserAvg.toFixed(4).padStart(10)} | Winner=${winnerAvg.toFixed(4).padStart(10)} | Δ=${delta.toFixed(4).padStart(10)} ${sig}`);
}

// Loser regime distribution
console.log('\n  Loser Regime Distribution:');
const loserByRegime = {};
for (const d of losers) {
  const r = d.regime || 'UNKNOWN';
  if (!loserByRegime[r]) loserByRegime[r] = { n: 0, pnl: 0 };
  loserByRegime[r].n++;
  loserByRegime[r].pnl += d.pnl;
}
for (const [r, d] of Object.entries(loserByRegime).sort((a, b) => a[1].pnl - b[1].pnl)) {
  console.log(`    ${r.padEnd(16)} ${String(d.n).padStart(5)} losers | $${d.pnl.toFixed(0).padStart(8)}`);
}

// Emergency exit analysis
const emergencyExits = allTrailingPnls.filter(d => d.reason === 'emergency');
console.log(`\n  Emergency Exits: ${emergencyExits.length}`);
if (emergencyExits.length > 0) {
  console.log(`  Emergency total: $${emergencyExits.reduce((s, d) => s + d.pnl, 0).toFixed(0)}`);
  console.log(`  Emergency avg duration: ${(emergencyExits.reduce((s, d) => s + d.duration, 0) / emergencyExits.length).toFixed(0)}min`);
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 7: TEMPORAL VALIDATION
// ═══════════════════════════════════════════════════════════════════

console.log('\n── Phase 7: Temporal Validation ───────────────────');

// Year by year
const byYear = {};
for (const s of signals) {
  const year = new Date(s.timestamp).getFullYear();
  const pnl = s.exits?.trailing?.pnl;
  if (pnl === undefined) continue;
  if (!byYear[year]) byYear[year] = { n: 0, pnl: 0, wins: 0 };
  byYear[year].n++;
  byYear[year].pnl += pnl;
  if (pnl > 0) byYear[year].wins++;
}

console.log('\n  Year-by-Year (trailing exit):');
for (const [year, d] of Object.entries(byYear).sort()) {
  const wr = ((d.wins / d.n) * 100).toFixed(1);
  const emoji = d.pnl > 0 ? 'OK' : 'XX';
  console.log(`    ${emoji} ${year}  ${String(d.n).padStart(6)} signals | ${wr.padStart(5)}% WR | PnL=$${d.pnl.toFixed(0).padStart(10)}`);
}

// Per-symbol year by year
for (const symbol of Object.keys(bySymbol)) {
  const sigs = signals.filter(s => s.symbol === symbol);
  console.log(`\n  ${symbol} Year-by-Year:`);
  const symByYear = {};
  for (const s of sigs) {
    const year = new Date(s.timestamp).getFullYear();
    const pnl = s.exits?.trailing?.pnl;
    if (pnl === undefined) continue;
    if (!symByYear[year]) symByYear[year] = { n: 0, pnl: 0, wins: 0 };
    symByYear[year].n++;
    symByYear[year].pnl += pnl;
    if (pnl > 0) symByYear[year].wins++;
  }
  for (const [year, d] of Object.entries(symByYear).sort()) {
    const wr = ((d.wins / d.n) * 100).toFixed(1);
    const emoji = d.pnl > 0 ? 'OK' : 'XX';
    console.log(`    ${emoji} ${year}  ${String(d.n).padStart(6)} signals | ${wr.padStart(5)}% WR | PnL=$${d.pnl.toFixed(0).padStart(10)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 8: FINAL VERDICT
// ═══════════════════════════════════════════════════════════════════

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   ** FINAL VERDICT — ENTRY PREDICTIVE POWER         ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// Compare best exit vs random across all signals
const allRR2 = signals.map(s => s.exits?.rr_2?.pnl).filter(p => p !== undefined);
const allRandom = signals.map(s => s.exits?.random?.pnl).filter(p => p !== undefined);

const rr2Total = allRR2.reduce((a, b) => a + b, 0);
const randomTotal = allRandom.reduce((a, b) => a + b, 0);
const rr2WR = allRR2.filter(p => p > 0).length / allRR2.length;
const randomWR = allRandom.filter(p => p > 0).length / allRandom.length;

console.log(`  Dataset: ${signals.length.toLocaleString()} signals across ${Object.keys(bySymbol).length} assets`);
console.log(`  Years covered: ${Object.keys(byYear).sort().join(', ')}`);
console.log('');
console.log(`  ENTRY TEST (RR 1:2 vs Random):`);
console.log(`    RR 1:2:  ${(rr2WR * 100).toFixed(1)}% WR | Total=$${rr2Total.toFixed(0)}`);
console.log(`    Random:  ${(randomWR * 100).toFixed(1)}% WR | Total=$${randomTotal.toFixed(0)}`);
console.log(`    Delta:   $${(rr2Total - randomTotal).toFixed(0)}`);
console.log('');

if (rr2Total > randomTotal) {
  console.log('  OK ENTRY HAS PREDICTIVE POWER');
  console.log('  Directional signals outperform random by $' + (rr2Total - randomTotal).toFixed(0));
} else {
  console.log('  XX ENTRY HAS NO PREDICTIVE POWER');
  console.log('  Directional signals perform equal to or worse than random.');
  console.log('  The current features do not capture what moves price.');
}

console.log('');
console.log('  Data Quality:');
const years = Object.keys(byYear).sort();
console.log(`    Multi-year: ${years.length > 1 ? 'OK ' + years.join(', ') : 'XX Single year'}`);
console.log(`    Sample size: ${signals.length >= 10000 ? 'PASS ' + signals.length.toLocaleString() : 'FAIL ' + signals.length.toLocaleString() + ' (target: 10000+)'}`);
console.log(`    Per-asset coverage: ${Object.keys(bySymbol).map(s => `${s.split('/')[0]}: ${(bySymbol[s] || 0).toLocaleString()}`).join(', ')}`);

console.log('\n  OK Analysis complete.\n');
