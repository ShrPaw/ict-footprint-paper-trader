// ═══════════════════════════════════════════════════════════════════
// ARCHITECTURE PROTOTYPING — PRE-IMPLEMENTATION VALIDATION
// ═══════════════════════════════════════════════════════════════════
//
// OBJECTIVE: Test whether a simple, non-optimized extraction
// architecture can preserve the funding rate edge WITHOUT
// destroying it through premature design decisions.
//
// RULES:
// - NO optimization
// - NO trailing stops
// - NO OHLCV signal combination
// - NO production modules
// - Fixed entry model (percentile-based, coarse)
// - Grid of simple exit structures
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCHANGE = 'binance';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:00Z';
const FEE_ROUND_TRIP = 0.0014; // 0.07% taker × 2 (conservative)

// ═══════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════

async function fetchFundingRates(symbol) {
  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const since = new Date(START_DATE).getTime();
  const end = new Date(END_DATE).getTime();
  const all = [];
  let cursor = since;
  process.stdout.write(`  📥 Funding ${symbol}...`);
  while (cursor < end) {
    try {
      const rates = await exchange.fetchFundingRateHistory(symbol, cursor, 1000);
      if (!rates || rates.length === 0) break;
      all.push(...rates);
      cursor = rates[rates.length - 1].timestamp + 1;
      if (rates.length < 1000) break;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) {
      cursor += 8 * 3600 * 1000;
      await new Promise(r => setTimeout(r, exchange.rateLimit * 3));
    }
  }
  const seen = new Set(), unique = [];
  for (const r of all) {
    if (!seen.has(r.timestamp)) {
      seen.add(r.timestamp);
      unique.push({ timestamp: r.timestamp, fundingRate: r.fundingRate });
    }
  }
  console.log(` ${unique.length} ✅`);
  return unique.filter(r => r.timestamp >= since && r.timestamp <= end);
}

async function fetchCandles(symbol) {
  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const since = new Date(START_DATE).getTime();
  const end = new Date(END_DATE).getTime();
  const all = [];
  let cursor = since;
  process.stdout.write(`  📥 Candles ${symbol}...`);
  while (cursor < end) {
    const c = await exchange.fetchOHLCV(symbol, '1h', cursor, 1000);
    if (!c || !c.length) break;
    all.push(...c);
    cursor = c[c.length - 1][0] + 1;
    await new Promise(r => setTimeout(r, exchange.rateLimit));
  }
  const seen = new Set(), unique = [];
  for (const c of all) {
    if (!seen.has(c[0])) {
      seen.add(c[0]);
      unique.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4] });
    }
  }
  console.log(` ${unique.length} ✅`);
  return unique.filter(c => c.timestamp >= since && c.timestamp <= end);
}

function alignFundingToCandles(fr, candles) {
  const aligned = [];
  let ci = 0;
  for (const f of fr) {
    while (ci < candles.length - 1 && candles[ci].timestamp < f.timestamp) ci++;
    if (Math.abs(candles[ci].timestamp - f.timestamp) <= 3600000) {
      aligned.push({ ...f, candleIdx: ci });
    }
  }
  return aligned;
}

// ═══════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════

function stats(arr) {
  const v = arr.filter(x => x !== null && !isNaN(x) && isFinite(x));
  if (v.length < 3) return { n: v.length, mean: 0, median: 0, std: 0, pctPositive: 0, tStat: 0, min: 0, max: 0, p5: 0, p95: 0 };
  const n = v.length;
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sorted = [...v].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const pos = v.filter(r => r > 0).length;
  let m2 = 0;
  for (const x of v) { const d = x - mean; m2 += d * d; }
  m2 /= n;
  const std = Math.sqrt(m2);
  const t = std > 0 ? mean / (std / Math.sqrt(n)) : 0;
  return {
    n, mean, median, std, pctPositive: pos / n, tStat: t,
    min: sorted[0], max: sorted[n - 1],
    p5: sorted[Math.floor(n * 0.05)],
    p25: sorted[Math.floor(n * 0.25)],
    p75: sorted[Math.floor(n * 0.75)],
    p95: sorted[Math.floor(n * 0.95)],
  };
}

function percentile(arr, p) {
  const sorted = [...arr].filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(p / 100 * sorted.length), sorted.length - 1)];
}

// ═══════════════════════════════════════════════════════════════════
// STEP 1 — ENTRY MODEL (FIXED, NON-OPTIMIZED)
// ═══════════════════════════════════════════════════════════════════

function detectSignals(aligned, candles, label) {
  const n = aligned.length;
  const rates = aligned.map(f => f.fundingRate);
  const p10 = percentile(rates, 10);
  const p95 = percentile(rates, 95);

  // Cumulative drain (10 periods = ~80h)
  const cumWindow = 10;
  const cumValues = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) sum += aligned[j].fundingRate;
    cumValues.push(sum);
  }
  const cumP90 = percentile(cumValues, 90);

  const signals = [];

  // Signal types per asset
  const signalDefs = {
    BTC: [
      { name: 'btc_extremeLow_p10', filter: (f, i) => f.fundingRate <= p10 },
      { name: 'btc_extremeHigh_p95', filter: (f, i) => f.fundingRate >= p95 },
      { name: 'btc_highCumDrain', filter: (f, i) => cumValues[i] >= cumP90 },
    ],
    ETH: [
      { name: 'eth_highCumDrain', filter: (f, i) => cumValues[i] >= cumP90 },
      { name: 'eth_extremeLow_p10', filter: (f, i) => f.fundingRate <= p10 },
    ],
    XRP: [
      { name: 'xrp_highCumDrain', filter: (f, i) => cumValues[i] >= cumP90 },
      { name: 'xrp_extremeLow_p10', filter: (f, i) => f.fundingRate <= p10 },
    ],
  };

  const defs = signalDefs[label] || [];
  for (const def of defs) {
    for (let i = 0; i < n; i++) {
      if (def.filter(aligned[i], i)) {
        signals.push({
          signal: def.name,
          entryIdx: aligned[i].candleIdx,
          entryTs: aligned[i].timestamp,
          fundingRate: aligned[i].fundingRate,
        });
      }
    }
  }

  return signals;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2 — EXIT MODEL GRID
// ═══════════════════════════════════════════════════════════════════

// For each signal event, extract the full 72h price path
function extractPath(candles, entryIdx, maxHours = 72) {
  const path = [];
  const entryPrice = candles[entryIdx]?.close;
  if (!entryPrice || entryPrice <= 0) return null;

  for (let h = 0; h <= maxHours; h++) {
    const idx = entryIdx + h;
    if (idx >= candles.length) break;
    path.push({
      hour: h,
      close: candles[idx].close,
      high: candles[idx].high,
      low: candles[idx].low,
      retFromEntry: (candles[idx].close - entryPrice) / entryPrice,
      highFromEntry: (candles[idx].high - entryPrice) / entryPrice,
      lowFromEntry: (candles[idx].low - entryPrice) / entryPrice,
    });
  }

  return { entryPrice, path, maxHour: path.length - 1 };
}

// Simulate each exit architecture on a price path
function simulateExit(pathData, exitConfig) {
  if (!pathData || pathData.path.length < 3) return null;
  const { entryPrice, path: candles } = pathData;

  let exitHour = candles.length - 1;
  let exitPrice = candles[candles.length - 1].close;
  let exitReason = 'time_limit';

  const maxHold = Math.min(exitConfig.maxHoldHours, candles.length - 1);

  for (let h = 1; h <= maxHold; h++) {
    const c = candles[h];

    // TIME-BASED EXIT
    if (h === maxHold) {
      exitHour = h;
      exitPrice = c.close;
      exitReason = 'time_exit';
      break;
    }

    // CATASTROPHIC STOP (wide, percentile-based)
    if (exitConfig.catastrophicStop) {
      if (c.lowFromEntry <= -exitConfig.catastrophicStop) {
        exitHour = h;
        // Fill at the stop level (conservative) or at the low (worst case)
        exitPrice = entryPrice * (1 - exitConfig.catastrophicStop);
        exitReason = 'catastrophic_stop';
        break;
      }
    }
  }

  const grossReturn = (exitPrice - entryPrice) / entryPrice;
  const netReturn = grossReturn - FEE_ROUND_TRIP;

  return {
    grossReturn,
    netReturn,
    exitHour,
    exitReason,
    entryPrice,
    exitPrice,
    // Path stats
    maxAdverse: Math.min(...candles.slice(0, exitHour + 1).map(c => c.lowFromEntry)),
    maxFavorable: Math.max(...candles.slice(0, exitHour + 1).map(c => c.highFromEntry)),
    timeToFirstPositive: (() => {
      for (let h = 1; h <= exitHour; h++) {
        if (candles[h].close > entryPrice) return h;
      }
      return exitHour;
    })(),
    year: new Date(pathData.path[0]?.hour !== undefined ? 0 : 0).getUTCFullYear(), // will be set from signal
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3 — RISK ARCHITECTURE TEST
// ═══════════════════════════════════════════════════════════════════

function evaluateArchitecture(results, configName) {
  const netReturns = results.map(r => r.netReturn);
  const s = stats(netReturns);
  const maes = results.map(r => Math.abs(r.maxAdverse));

  // Drawdown sequence
  let peak = 0, cumPnL = 0, maxDD = 0;
  const equity = [];
  for (const r of netReturns) {
    cumPnL += r;
    if (cumPnL > peak) peak = cumPnL;
    const dd = peak - cumPnL;
    if (dd > maxDD) maxDD = dd;
    equity.push(cumPnL);
  }

  // Worst-case sequences
  const worst10 = [...netReturns].sort((a, b) => a - b).slice(0, Math.min(10, netReturns.length));
  const worstSeqSum = worst10.reduce((s, x) => s + x, 0);

  // Loss clustering
  let maxConsecLosses = 0, curConsec = 0;
  for (const r of netReturns) {
    if (r < 0) { curConsec++; maxConsecLosses = Math.max(maxConsecLosses, curConsec); }
    else curConsec = 0;
  }

  // MAE containment
  const maesSorted = [...maes].sort((a, b) => b - a);
  const maeP95 = maesSorted[Math.floor(maesSorted.length * 0.05)] || 0;
  const maeP99 = maesSorted[Math.floor(maesSorted.length * 0.01)] || 0;

  // Exit reasons
  const exitReasons = {};
  for (const r of results) {
    exitReasons[r.exitReason] = (exitReasons[r.exitReason] || 0) + 1;
  }

  // Year stability
  const byYear = {};
  for (let i = 0; i < results.length; i++) {
    const yr = results[i].year;
    if (!byYear[yr]) byYear[yr] = [];
    byYear[yr].push(netReturns[i]);
  }
  const yearStats = {};
  let yearsPos = 0, yearsTotal = 0;
  for (const [y, rets] of Object.entries(byYear)) {
    const ys = stats(rets);
    yearStats[y] = ys;
    yearsTotal++;
    if (ys.mean > 0) yearsPos++;
  }

  // Profit factor
  const wins = netReturns.filter(r => r > 0);
  const losses = netReturns.filter(r => r < 0);
  const grossProfit = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  // Survival score (0-100)
  let survival = 50;
  if (s.mean > 0) survival += 10;
  if (s.tStat > 2.0) survival += 10;
  if (pf > 1.2) survival += 5;
  if (pf > 1.5) survival += 5;
  if (maxDD < 0.05 * results.length) survival += 5; // DD < 5% of trade count as % of capital
  if (maxConsecLosses < 10) survival += 5;
  if (yearsPos / Math.max(yearsTotal, 1) > 0.5) survival += 5;
  if (maeP99 < 0.15) survival += 5;
  if (maeP99 < 0.10) survival += 5;
  if (s.pctPositive > 0.50) survival += 5;
  survival = Math.min(100, Math.max(0, survival));

  return {
    configName,
    n: results.length,
    expectancy: s.mean,
    expectancyBps: s.mean * 10000,
    median: s.median,
    tStat: s.tStat,
    pctPositive: s.pctPositive,
    std: s.std,
    pf,
    maxDD,
    maxConsecLosses,
    worstSeqSum,
    maeP95: maeP95 * 100,
    maeP99: maeP99 * 100,
    avgMAE: stats(maes).mean * 100,
    exitReasons,
    yearStats,
    yearsPos,
    yearsTotal,
    survival,
    grossReturn: netReturns.reduce((s, x) => s + x, 0),
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4 — POSITION SIZING SIMULATION
// ═══════════════════════════════════════════════════════════════════

function simulatePositionSizing(results, capital = 10000) {
  // Conservative: size based on worst MAE
  const maes = results.map(r => Math.abs(r.maxAdverse));
  const worstMAE = percentile(maes, 99);

  // If worst MAE is 20%, risk 1% of capital → position = capital * 0.01 / worstMAE
  const riskPerTrade = 0.01; // 1% of capital
  const positionSize = worstMAE > 0 ? (capital * riskPerTrade) / worstMAE : capital * 0.1;

  // Simulate equity curve
  let equity = capital;
  let maxEquity = capital;
  let maxDD = 0;
  let blown = false;
  const equityCurve = [capital];

  for (const r of results) {
    const pnl = positionSize * r.netReturn;
    equity += pnl;
    if (equity > maxEquity) maxEquity = equity;
    const dd = (maxEquity - equity) / maxEquity;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push(equity);
    if (equity <= 0) { blown = true; break; }
  }

  const totalReturn = (equity - capital) / capital;

  // Test multiple concurrent signals (worst case: 3 signals fire simultaneously)
  const concurrentSize = positionSize / 3; // split across 3 positions
  let concurrentEquity = capital;
  let concurrentMaxDD = 0;
  let concurrentBlown = false;
  let concurrentPeak = capital;

  // Worst case: all 3 concurrent positions hit worst MAE simultaneously
  const worstCaseLoss = 3 * concurrentSize * worstMAE;
  const worstCasePct = worstCaseLoss / capital;

  return {
    worstMAE: worstMAE * 100,
    positionSize: positionSize.toFixed(2),
    positionSizePct: (positionSize / capital * 100).toFixed(2),
    totalReturn: (totalReturn * 100).toFixed(2),
    maxDD: (maxDD * 100).toFixed(2),
    blown,
    finalEquity: equity.toFixed(2),
    // Concurrent
    concurrentSize: concurrentSize.toFixed(2),
    concurrentWorstCase: worstCasePct * 100,
    concurrentSurvives: worstCasePct < 0.50, // can survive 50 simultaneous worst-case
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5 — FAILURE MODE ANALYSIS
// ═══════════════════════════════════════════════════════════════════

function analyzeFailureModes(results) {
  const netReturns = results.map(r => r.netReturn);

  // When do losses cluster?
  const lossClusters = [];
  let cluster = [];
  for (let i = 0; i < netReturns.length; i++) {
    if (netReturns[i] < 0) {
      cluster.push({ idx: i, ret: netReturns[i], mae: results[i].maxAdverse });
    } else {
      if (cluster.length >= 3) lossClusters.push([...cluster]);
      cluster = [];
    }
  }
  if (cluster.length >= 3) lossClusters.push(cluster);

  // What triggers catastrophic losses?
  const catastrophic = results.filter(r => r.netReturn < -0.03); // >3% loss
  const catastrophicReasons = {};
  for (const c of catastrophic) {
    catastrophicReasons[c.exitReason] = (catastrophicReasons[c.exitReason] || 0) + 1;
  }

  // Which signals lose most?
  const bySignal = {};
  for (let i = 0; i < results.length; i++) {
    const sig = results[i].signal;
    if (!bySignal[sig]) bySignal[sig] = [];
    bySignal[sig].push(netReturns[i]);
  }
  const signalRisk = {};
  for (const [sig, rets] of Object.entries(bySignal)) {
    const s = stats(rets);
    signalRisk[sig] = { n: s.n, mean: s.mean, worst: s.min, pctNeg: 1 - s.pctPositive };
  }

  // Distribution of MAE
  const maes = results.map(r => r.maxAdverse).sort((a, b) => a - b);
  const maeDistribution = {
    p50: percentile(maes.map(Math.abs), 50) * 100,
    p90: percentile(maes.map(Math.abs), 90) * 100,
    p95: percentile(maes.map(Math.abs), 95) * 100,
    p99: percentile(maes.map(Math.abs), 99) * 100,
    max: Math.abs(maes[0]) * 100,
  };

  return {
    lossClusterCount: lossClusters.length,
    largestCluster: lossClusters.length > 0 ? Math.max(...lossClusters.map(c => c.length)) : 0,
    catastrophicCount: catastrophic.length,
    catastrophicReasons,
    signalRisk,
    maeDistribution,
  };
}

// ═══════════════════════════════════════════════════════════════════
// GRID DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

const EXIT_CONFIGS = [
  // TIME-BASED ONLY
  { name: 'TIME_24h', maxHoldHours: 24, catastrophicStop: null },
  { name: 'TIME_48h', maxHoldHours: 48, catastrophicStop: null },
  { name: 'TIME_72h', maxHoldHours: 72, catastrophicStop: null },

  // HYBRID: TIME + VERY WIDE CATASTROPHIC STOP (percentile-based, NOT ATR)
  // Using 10%, 15%, 20% — based on observed worst MAE distributions
  { name: 'TIME_48h+STOP_10%', maxHoldHours: 48, catastrophicStop: 0.10 },
  { name: 'TIME_48h+STOP_15%', maxHoldHours: 48, catastrophicStop: 0.15 },
  { name: 'TIME_48h+STOP_20%', maxHoldHours: 48, catastrophicStop: 0.20 },

  { name: 'TIME_72h+STOP_10%', maxHoldHours: 72, catastrophicStop: 0.10 },
  { name: 'TIME_72h+STOP_15%', maxHoldHours: 72, catastrophicStop: 0.15 },
  { name: 'TIME_72h+STOP_20%', maxHoldHours: 72, catastrophicStop: 0.20 },

  // CATASTROPHIC STOP ONLY (no time limit within 72h window)
  { name: 'STOP_10%_ONLY', maxHoldHours: 72, catastrophicStop: 0.10 },
  { name: 'STOP_15%_ONLY', maxHoldHours: 72, catastrophicStop: 0.15 },
  { name: 'STOP_20%_ONLY', maxHoldHours: 72, catastrophicStop: 0.20 },
];

// ═══════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let r = `# 🏗️ ARCHITECTURE PROTOTYPING — PRE-IMPLEMENTATION VALIDATION\n`;
  r += `**Generated:** ${new Date().toISOString()}\n`;
  r += `**Data:** Binance perpetual futures, ${START_DATE.slice(0, 10)} → ${END_DATE.slice(0, 10)}\n`;
  r += `**Method:** Grid test of simple exit architectures on funding rate signals\n`;
  r += `**Fee model:** ${(FEE_ROUND_TRIP * 100).toFixed(2)}% round-trip (taker)\n`;
  r += `**Rules:** NO optimization, NO trailing stops, NO OHLCV signals\n\n---\n\n`;

  // Per-asset comparison tables
  for (const [asset, configs] of Object.entries(allResults)) {
    r += `## ${asset}\n\n`;

    // Architecture Comparison Table
    r += `### Architecture Comparison\n\n`;
    r += `| Config | n | Expectancy (bps) | t-stat | %Win | PF | Max DD | Max Consec | MAE p99% | Survival |\n`;
    r += `|--------|---|------------------|--------|------|----|----|------------|----------|----------|\n`;

    const sorted = [...configs].sort((a, b) => b.evaluation.survival - a.evaluation.survival);
    for (const c of sorted) {
      const e = c.evaluation;
      const icon = e.survival >= 70 ? '🟢' : e.survival >= 50 ? '🟡' : '🔴';
      r += `| ${e.configName} | ${e.n} | ${e.expectancyBps.toFixed(1)} | ${e.tStat.toFixed(2)} | ${(e.pctPositive * 100).toFixed(1)}% | ${e.pf.toFixed(2)} | ${(e.maxDD * 100).toFixed(2)} | ${e.maxConsecLosses} | ${e.maeP99.toFixed(1)}% | ${icon} ${e.survival} |\n`;
    }

    // Edge Integrity Check
    r += `\n### Edge Integrity Check\n\n`;
    const baseline = configs.find(c => c.evaluation.configName === 'TIME_48h');
    if (baseline) {
      const b = baseline.evaluation;
      r += `**Baseline (TIME_48h):**\n`;
      r += `- Expectancy: ${b.expectancyBps.toFixed(1)} bps (${(b.expectancy * 100).toFixed(4)}%)\n`;
      r += `- t-stat: ${b.tStat.toFixed(2)}\n`;
      r += `- Edge survives: ${b.tStat > 2.0 && b.expectancy > 0 ? '✅ YES' : '❌ NO'}\n`;
      r += `- Economically viable: ${b.pf > 1.0 ? '✅ YES (PF=' + b.pf.toFixed(2) + ')' : '❌ NO (PF=' + b.pf.toFixed(2) + ')'}\n\n`;
    }

    // Risk Viability
    r += `### Risk Viability\n\n`;
    for (const c of configs) {
      const e = c.evaluation;
      const ps = c.positionSizing;
      r += `**${e.configName}:**\n`;
      r += `- Worst MAE p99%: ${e.maeP99.toFixed(1)}%\n`;
      r += `- Position size (1% risk): ${ps.positionSizePct}% of capital\n`;
      r += `- Total return (sized): ${ps.totalReturn}%\n`;
      r += `- Max DD (sized): ${ps.maxDD}%\n`;
      r += `- Blown up: ${ps.blown ? '❌ YES' : '✅ NO'}\n`;
      r += `- Concurrent 3-pos worst case: ${ps.concurrentWorstCase.toFixed(1)}% of capital\n`;
      r += `- Survives concurrent: ${ps.concurrentSurvives ? '✅ YES' : '❌ NO'}\n\n`;
    }

    // Failure Modes (for best config)
    const best = sorted[0];
    if (best) {
      r += `### Failure Mode Analysis (${best.evaluation.configName})\n\n`;
      const fm = best.failureModes;
      r += `- Loss clusters (≥3 consecutive): ${fm.lossClusterCount}\n`;
      r += `- Largest cluster: ${fm.largestCluster} consecutive losses\n`;
      r += `- Catastrophic losses (>3%): ${fm.catastrophicCount}\n`;
      if (Object.keys(fm.catastrophicReasons).length > 0) {
        r += `- Catastrophic reasons: ${JSON.stringify(fm.catastrophicReasons)}\n`;
      }
      r += `- MAE distribution: p50=${fm.maeDistribution.p50.toFixed(1)}% p90=${fm.maeDistribution.p90.toFixed(1)}% p95=${fm.maeDistribution.p95.toFixed(1)}% p99=${fm.maeDistribution.p99.toFixed(1)}% max=${fm.maeDistribution.max.toFixed(1)}%\n\n`;

      r += `| Signal | n | Mean | Worst | % Negative |\n`;
      r += `|--------|---|------|-------|------------|\n`;
      for (const [sig, sr] of Object.entries(fm.signalRisk)) {
        r += `| ${sig} | ${sr.n} | ${(sr.mean * 100).toFixed(4)}% | ${(sr.worst * 100).toFixed(2)}% | ${(sr.pctNeg * 100).toFixed(1)}% |\n`;
      }
      r += `\n`;
    }

    // Year-by-year for best config
    if (best) {
      r += `### Year Stability (${best.evaluation.configName})\n\n`;
      r += `| Year | Mean (bps) | t-stat | n | %Win |\n`;
      r += `|------|------------|--------|---|------|\n`;
      for (const [y, ys] of Object.entries(best.evaluation.yearStats)) {
        r += `| ${y} | ${(ys.mean * 10000).toFixed(1)} | ${ys.tStat.toFixed(2)} | ${ys.n} | ${(ys.pctPositive * 100).toFixed(1)}% |\n`;
      }
      r += `\nYears positive: ${best.evaluation.yearsPos}/${best.evaluation.yearsTotal}\n\n`;
    }

    r += `---\n\n`;
  }

  // Global comparison across assets
  r += `## CROSS-ASSET SUMMARY\n\n`;
  r += `| Asset | Best Config | Expectancy (bps) | PF | Survival | Viable? |\n`;
  r += `|-------|------------|------------------|-----|----------|--------|\n`;
  for (const [asset, configs] of Object.entries(allResults)) {
    const best = [...configs].sort((a, b) => b.evaluation.survival - a.evaluation.survival)[0];
    if (best) {
      const e = best.evaluation;
      const viable = e.survival >= 60 && e.tStat > 2.0 && e.pf > 1.0;
      r += `| ${asset} | ${e.configName} | ${e.expectancyBps.toFixed(1)} | ${e.pf.toFixed(2)} | ${e.survival} | ${viable ? '✅' : '❌'} |\n`;
    }
  }

  // FINAL CLASSIFICATION
  r += `\n---\n\n## FINAL CLASSIFICATION\n\n`;

  const viableAssets = [];
  const nonViableAssets = [];
  for (const [asset, configs] of Object.entries(allResults)) {
    const best = [...configs].sort((a, b) => b.evaluation.survival - a.evaluation.survival)[0];
    if (best && best.evaluation.survival >= 60 && best.evaluation.tStat > 2.0 && best.evaluation.pf > 1.0) {
      viableAssets.push({ asset, config: best.evaluation.configName, survival: best.evaluation.survival, bps: best.evaluation.expectancyBps });
    } else {
      nonViableAssets.push({ asset, reason: best ? `survival=${best.evaluation.survival}, t=${best.evaluation.tStat.toFixed(2)}, PF=${best.evaluation.pf.toFixed(2)}` : 'no data' });
    }
  }

  if (viableAssets.length > 0) {
    r += `### 🟢 CASE A — VIABLE ARCHITECTURE EXISTS\n\n`;
    r += `The following assets have a survivable architecture:\n\n`;
    for (const v of viableAssets) {
      r += `- **${v.asset}**: ${v.config} (survival=${v.survival}, edge=${v.bps.toFixed(1)} bps)\n`;
    }
    r += `\n**Simplest viable structure:**\n`;
    r += `- Entry: Funding rate percentile triggers (p10/p95/p90 cumulative)\n`;
    r += `- Exit: Time-based (48h) with optional wide catastrophic stop\n`;
    r += `- Risk: Conservative sizing based on worst MAE\n`;
    r += `- No trailing stops, no OHLCV signals, no optimization\n`;
  }
  if (nonViableAssets.length > 0) {
    r += `\n### 🔴 CASE B — NON-VIABLE ASSETS\n\n`;
    for (const nv of nonViableAssets) {
      r += `- **${nv.asset}**: ${nv.reason}\n`;
    }
    r += `\nThese assets have a real edge but no simple architecture preserves it.\n`;
  }

  if (viableAssets.length === 0) {
    r += `### 🔴 CASE B — ALL ARCHITECTURES FAIL\n\n`;
    r += `No simple, non-optimized architecture preserves the edge for any asset.\n`;
    r += `The edge is real but NOT implementable with simple structures.\n`;
  }

  return r;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏗️  ARCHITECTURE PROTOTYPING — PRE-IMPLEMENTATION VALIDATION   ║
║  Grid test of exit architectures on funding rate signals        ║
║  NO optimization. NO trailing. NO OHLCV. Simple structures.    ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults = {};
  const ASSETS = [
    { label: 'BTC', symbol: 'BTC/USDT:USDT' },
    { label: 'ETH', symbol: 'ETH/USDT:USDT' },
    { label: 'XRP', symbol: 'XRP/USDT:USDT' },
  ];

  for (const asset of ASSETS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔬 ${asset.label}`);
    console.log(`${'═'.repeat(60)}`);

    // Fetch data
    const fundingRates = await fetchFundingRates(asset.symbol);
    const candles = await fetchCandles(asset.symbol);
    const aligned = alignFundingToCandles(fundingRates, candles);
    console.log(`  Aligned: ${aligned.length} funding events`);

    // STEP 1: Detect signals
    const signals = detectSignals(aligned, candles, asset.label);
    console.log(`  📊 Signals detected: ${signals.length}`);

    // For each signal, extract the full 72h price path
    const signalPaths = [];
    for (const sig of signals) {
      const pathData = extractPath(candles, sig.entryIdx, 72);
      if (pathData && pathData.path.length >= 24) {
        signalPaths.push({
          ...sig,
          year: new Date(candles[sig.entryIdx].timestamp).getUTCFullYear(),
          pathData,
        });
      }
    }
    console.log(`  📈 Valid paths: ${signalPaths.length}`);

    // STEP 2: Run exit grid
    const assetResults = [];
    for (const config of EXIT_CONFIGS) {
      const results = [];
      for (const sp of signalPaths) {
        const sim = simulateExit(sp.pathData, config);
        if (sim) {
          sim.signal = sp.signal;
          sim.year = sp.year;
          results.push(sim);
        }
      }

      // STEP 3: Evaluate
      const evaluation = evaluateArchitecture(results, config.name);

      // STEP 4: Position sizing
      const positionSizing = simulatePositionSizing(results);

      // STEP 5: Failure modes
      const failureModes = analyzeFailureModes(results);

      assetResults.push({ config: config.name, evaluation, positionSizing, failureModes });

      const icon = evaluation.survival >= 70 ? '🟢' : evaluation.survival >= 50 ? '🟡' : '🔴';
      console.log(`  ${icon} ${config.name}: exp=${evaluation.expectancyBps.toFixed(1)}bps t=${evaluation.tStat.toFixed(2)} PF=${evaluation.pf.toFixed(2)} surv=${evaluation.survival}`);
    }

    allResults[asset.label] = assetResults;
  }

  // Generate report
  const report = generateReport(allResults);
  const reportPath = path.join(__dirname, 'ARCHITECTURE_PROTOTYPE_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  const rawPath = path.join(__dirname, 'architecture-prototype-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw: ${rawPath}`);

  // Final verdict
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  🏆 FINAL VERDICT`);
  console.log(`${'═'.repeat(60)}\n`);

  for (const [asset, configs] of Object.entries(allResults)) {
    const best = [...configs].sort((a, b) => b.evaluation.survival - a.evaluation.survival)[0];
    const e = best.evaluation;
    const viable = e.survival >= 60 && e.tStat > 2.0 && e.pf > 1.0;
    console.log(`  ${viable ? '🟢' : '🔴'} ${asset}: ${e.configName} (survival=${e.survival}, ${e.expectancyBps.toFixed(1)}bps, PF=${e.pf.toFixed(2)}, t=${e.tStat.toFixed(2)})`);
  }

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
