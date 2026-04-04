// ═══════════════════════════════════════════════════════════════════
// FINAL ROBUSTNESS VALIDATION — PRE-CONSTRUCTION STRESS TEST
// ═══════════════════════════════════════════════════════════════════
//
// OBJECTIVE: Can the architecture survive REAL capital conditions?
//
// Architecture under test:
//   Entry: Funding rate percentile triggers (p10/p95/p90 cumulative)
//   Exit:  Fixed 48h time exit — NO stops, NO trailing
//   Risk:  Conservative sizing based on worst MAE
//
// RULES: NO optimization. NO changes to core logic.
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCHANGE = 'binance';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:00Z';
const FEE_ROUND_TRIP = 0.0014;
const HOLD_HOURS = 48;
const CAPITAL = 10000;
const RISK_PER_TRADE = 0.01; // 1%

// ═══════════════════════════════════════════════════════════════════
// DATA (same as architecture prototype)
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
    if (Math.abs(candles[ci].timestamp - f.timestamp) <= 3600000) aligned.push({ ...f, candleIdx: ci });
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
  return { n, mean, median, std, pctPositive: pos / n, tStat: t, min: sorted[0], max: sorted[n - 1],
    p5: sorted[Math.floor(n * 0.05)], p25: sorted[Math.floor(n * 0.25)],
    p75: sorted[Math.floor(n * 0.75)], p95: sorted[Math.floor(n * 0.95)] };
}

function percentile(arr, p) {
  const sorted = [...arr].filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(p / 100 * sorted.length), sorted.length - 1)];
}

// ═══════════════════════════════════════════════════════════════════
// SIGNAL DETECTION + PATH EXTRACTION
// ═══════════════════════════════════════════════════════════════════

function detectSignals(aligned, candles, label) {
  const n = aligned.length;
  const rates = aligned.map(f => f.fundingRate);
  const p10 = percentile(rates, 10);
  const p95 = percentile(rates, 95);
  const cumWindow = 10;
  const cumValues = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) sum += aligned[j].fundingRate;
    cumValues.push(sum);
  }
  const cumP90 = percentile(cumValues, 90);

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

  const signals = [];
  const defs = signalDefs[label] || [];
  for (const def of defs) {
    for (let i = 0; i < n; i++) {
      if (def.filter(aligned[i], i)) {
        signals.push({
          signal: def.name,
          entryIdx: aligned[i].candleIdx,
          entryTs: aligned[i].timestamp,
          fundingRate: aligned[i].fundingRate,
          year: new Date(candles[aligned[i].candleIdx]?.timestamp || 0).getUTCFullYear(),
        });
      }
    }
  }
  return signals;
}

function extractEvent(candles, entryIdx, holdHours) {
  const exitIdx = entryIdx + holdHours;
  if (exitIdx >= candles.length || entryIdx >= candles.length) return null;
  const entryPrice = candles[entryIdx].close;
  if (entryPrice <= 0) return null;

  // Full path for MAE/MFE
  let mae = 0, mfe = 0;
  const pathReturns = [];
  for (let j = entryIdx; j <= exitIdx; j++) {
    const adverse = (candles[j].low - entryPrice) / entryPrice;
    const favorable = (candles[j].high - entryPrice) / entryPrice;
    if (adverse < mae) mae = adverse;
    if (favorable > mfe) mfe = favorable;
    pathReturns.push((candles[j].close - entryPrice) / entryPrice);
  }

  const netReturn = (candles[exitIdx].close - entryPrice) / entryPrice - FEE_ROUND_TRIP;

  return {
    entryPrice,
    exitPrice: candles[exitIdx].close,
    grossReturn: (candles[exitIdx].close - entryPrice) / entryPrice,
    netReturn,
    mae,
    mfe,
    pathReturns,
    year: new Date(candles[entryIdx].timestamp).getUTCFullYear(),
    month: new Date(candles[entryIdx].timestamp).getUTCMonth(),
    signal: '', // set by caller
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 1 — LOSS CLUSTER STRESS TEST
// ═══════════════════════════════════════════════════════════════════

function stressTestLossClusters(events) {
  const netReturns = events.map(e => e.netReturn);
  const maes = events.map(e => Math.abs(e.mae));
  const worstMAE = percentile(maes, 99);
  const positionSize = (CAPITAL * RISK_PER_TRADE) / worstMAE;

  // 1a. Historical worst-case sequences
  const sorted = [...netReturns].sort((a, b) => a - b);
  const worstN = [5, 10, 15, 20, 25, 30];

  const historicalSequences = {};
  for (const n of worstN) {
    const worst = sorted.slice(0, n);
    const totalLoss = worst.reduce((s, x) => s + x, 0);
    const ddPct = (positionSize * Math.abs(totalLoss)) / CAPITAL * 100;
    historicalSequences[`${n}_worst`] = {
      totalReturn: totalLoss * 100,
      avgLoss: (totalLoss / n) * 100,
      drawdownPct: ddPct,
      sizedLoss: positionSize * totalLoss,
    };
  }

  // 1b. Monte Carlo — synthetic worst-case clusters
  const MC_RUNS = 10000;
  const worstLosses = events.filter(e => e.netReturn < 0).map(e => e.netReturn);
  const lossDistribution = [...worstLosses]; // pool of losses

  const mcResults = [];
  for (let run = 0; run < MC_RUNS; run++) {
    // Simulate 30 consecutive losses drawn from actual loss distribution
    let cumLoss = 0;
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(Math.random() * lossDistribution.length);
      cumLoss += lossDistribution[idx];
    }
    mcResults.push(cumLoss);
  }
  mcResults.sort((a, b) => a - b);

  const mcWorst = {
    p50: mcResults[Math.floor(MC_RUNS * 0.5)] * 100,
    p10: mcResults[Math.floor(MC_RUNS * 0.1)] * 100,
    p1: mcResults[Math.floor(MC_RUNS * 0.01)] * 100,
    p0_1: mcResults[Math.floor(MC_RUNS * 0.001)] * 100,
    worst: mcResults[0] * 100,
    dd_p1: (positionSize * Math.abs(mcResults[Math.floor(MC_RUNS * 0.01)])) / CAPITAL * 100,
    dd_p0_1: (positionSize * Math.abs(mcResults[Math.floor(MC_RUNS * 0.001)])) / CAPITAL * 100,
  };

  // 1c. Historical loss cluster analysis
  let maxCluster = 0, curCluster = 0;
  const clusterLengths = [];
  for (const r of netReturns) {
    if (r < 0) { curCluster++; }
    else {
      if (curCluster > 0) clusterLengths.push(curCluster);
      maxCluster = Math.max(maxCluster, curCluster);
      curCluster = 0;
    }
  }
  if (curCluster > 0) { clusterLengths.push(curCluster); maxCluster = Math.max(maxCluster, curCluster); }

  clusterLengths.sort((a, b) => b - a);

  return {
    positionSize: positionSize.toFixed(2),
    positionSizePct: (positionSize / CAPITAL * 100).toFixed(2),
    worstMAE: worstMAE * 100,
    historicalSequences,
    monteCarlo: mcWorst,
    maxHistoricalCluster: maxCluster,
    top5Clusters: clusterLengths.slice(0, 5),
    clusterDistribution: {
      mean: (clusterLengths.reduce((s, x) => s + x, 0) / Math.max(clusterLengths.length, 1)).toFixed(1),
      median: clusterLengths[Math.floor(clusterLengths.length / 2)] || 0,
      p95: clusterLengths[Math.floor(clusterLengths.length * 0.05)] || 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2 — TAIL EXTREME SIMULATION
// ═══════════════════════════════════════════════════════════════════

function stressTestTailExtremes(events) {
  const maes = events.map(e => Math.abs(e.mae));
  const netReturns = events.map(e => e.netReturn);
  const historicalMaxMAE = Math.max(...maes);

  // Simulate tail events beyond observed max
  const tailScenarios = [
    { label: 'p99+50%', mae: percentile(maes, 99) * 1.5 },
    { label: '2x_p99', mae: percentile(maes, 99) * 2.0 },
    { label: '30%', mae: 0.30 },
    { label: '40%', mae: 0.40 },
    { label: '50%', mae: 0.50 },
    { label: 'historical_max', mae: historicalMaxMAE },
  ];

  const results = {};
  const lossReturns = netReturns.filter(r => r < 0);
  const lossPool = lossReturns.length > 0 ? lossReturns : [-0.01];

  for (const scenario of tailScenarios) {
    // Replace worst 1% of MAE events with this scenario's MAE
    const numTailEvents = Math.max(1, Math.floor(events.length * 0.01));
    const maeSorted = [...maes].sort((a, b) => b - a);

    // Size with this worst MAE
    const positionSize = (CAPITAL * RISK_PER_TRADE) / scenario.mae;

    // Impact: if the worst 1% of trades had this MAE (assume they lose the stop amount)
    const tailLoss = -scenario.mae; // worst case: loss equals MAE
    const baseReturns = [...netReturns];
    // Sort by MAE descending, replace worst numTailEvents with tail loss
    const indexed = baseReturns.map((r, i) => ({ r, mae: maes[i], i }));
    indexed.sort((a, b) => b.mae - a.mae);

    let replaced = 0;
    for (const item of indexed) {
      if (replaced >= numTailEvents) break;
      if (item.r > tailLoss) {
        baseReturns[item.i] = tailLoss - FEE_ROUND_TRIP;
        replaced++;
      }
    }

    // Also simulate: 3 tail events in sequence
    const threeSeqLoss = 3 * (tailLoss - FEE_ROUND_TRIP);

    const s = stats(baseReturns);
    const totalPnL = baseReturns.reduce((sum, x) => sum + x, 0);
    const sizedPnL = positionSize * totalPnL;
    const sizedMaxDD = positionSize * Math.abs(threeSeqLoss);

    results[scenario.label] = {
      mae: scenario.mae * 100,
      positionSize: positionSize.toFixed(2),
      positionSizePct: (positionSize / CAPITAL * 100).toFixed(2),
      newExpectancy: s.mean * 100,
      newPF: (() => {
        const w = baseReturns.filter(r => r > 0);
        const l = baseReturns.filter(r => r < 0);
        const gp = w.reduce((s, x) => s + x, 0);
        const gl = Math.abs(l.reduce((s, x) => s + x, 0));
        return gl > 0 ? gp / gl : 999;
      })(),
      sizedTotalReturn: (sizedPnL / CAPITAL * 100).toFixed(2),
      threeSeqDrawdown: (sizedMaxDD / CAPITAL * 100).toFixed(2),
      survivesThreeSeq: sizedMaxDD < CAPITAL * 0.50,
    };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3 — EXIT TIME STABILITY
// ═══════════════════════════════════════════════════════════════════

function stressTestExitTime(signals, candles, label) {
  const holdPeriods = [36, 48, 60];
  const results = {};

  for (const hold of holdPeriods) {
    const events = [];
    for (const sig of signals) {
      const ev = extractEvent(candles, sig.entryIdx, hold);
      if (ev) { ev.signal = sig.signal; ev.year = sig.year; events.push(ev); }
    }

    const netReturns = events.map(e => e.netReturn);
    const s = stats(netReturns);

    // By year
    const byYear = {};
    for (const ev of events) {
      if (!byYear[ev.year]) byYear[ev.year] = [];
      byYear[ev.year].push(ev.netReturn);
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
    const gp = wins.reduce((s, r) => s + r, 0);
    const gl = Math.abs(losses.reduce((s, r) => s + r, 0));
    const pf = gl > 0 ? gp / gl : 999;

    results[`${hold}h`] = {
      n: events.length,
      expectancy: s.mean * 100,
      tStat: s.tStat,
      pctPositive: s.pctPositive * 100,
      pf,
      yearsPos,
      yearsTotal,
      yearConsistency: yearsTotal > 0 ? yearsPos / yearsTotal : 0,
      yearStats,
      // Sensitivity: how much does expectancy change between 36-48-60?
    };
  }

  // Compute sensitivity
  const exp36 = results['36h']?.expectancy || 0;
  const exp48 = results['48h']?.expectancy || 0;
  const exp60 = results['60h']?.expectancy || 0;

  results.sensitivity = {
    range_bps: Math.max(exp36, exp48, exp60) - Math.min(exp36, exp48, exp60),
    is_48h_optimal: exp48 >= exp36 && exp48 >= exp60,
    is_monotonic: exp36 < exp48 < exp60,
    pct_change_36_to_48: exp48 !== 0 ? ((exp48 - exp36) / Math.abs(exp48) * 100) : 0,
    pct_change_48_to_60: exp48 !== 0 ? ((exp60 - exp48) / Math.abs(exp48) * 100) : 0,
    fragile: results.sensitivity?.range_bps > 100, // large sensitivity = fragile
  };

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4 — CAPITAL PATH SIMULATION
// ═══════════════════════════════════════════════════════════════════

function simulateCapitalPath(events, label) {
  const netReturns = events.map(e => e.netReturn);
  const maes = events.map(e => Math.abs(e.mae));
  const worstMAE = percentile(maes, 99);

  // Scenario A: Fixed position sizing (no compounding)
  const fixedSize = (CAPITAL * RISK_PER_TRADE) / worstMAE;
  let fixedEquity = CAPITAL;
  let fixedPeak = CAPITAL;
  let fixedMaxDD = 0;
  const fixedCurve = [CAPITAL];
  let fixedBlown = false;

  for (const r of netReturns) {
    const pnl = fixedSize * r;
    fixedEquity += pnl;
    if (fixedEquity > fixedPeak) fixedPeak = fixedEquity;
    const dd = (fixedPeak - fixedEquity) / fixedPeak;
    if (dd > fixedMaxDD) fixedMaxDD = dd;
    fixedCurve.push(fixedEquity);
    if (fixedEquity <= 0) { fixedBlown = true; break; }
  }

  // Scenario B: Compounding (risk 1% of current equity)
  let compoundEquity = CAPITAL;
  let compoundPeak = CAPITAL;
  let compoundMaxDD = 0;
  const compoundCurve = [CAPITAL];
  let compoundBlown = false;

  for (const r of netReturns) {
    const currentSize = (compoundEquity * RISK_PER_TRADE) / worstMAE;
    const pnl = currentSize * r;
    compoundEquity += pnl;
    if (compoundEquity > compoundPeak) compoundPeak = compoundEquity;
    const dd = (compoundPeak - compoundEquity) / compoundPeak;
    if (dd > compoundMaxDD) compoundMaxDD = dd;
    compoundCurve.push(compoundEquity);
    if (compoundEquity <= 0) { compoundBlown = true; break; }
  }

  // Scenario C: Multi-asset (3 signals fire concurrently, split sizing)
  // Worst case: 3 simultaneous positions, each sized at 1/3
  const multiSize = fixedSize / 3;
  let multiEquity = CAPITAL;
  let multiPeak = CAPITAL;
  let multiMaxDD = 0;
  const multiCurve = [CAPITAL];
  let multiBlown = false;

  // Simulate: each trade is independent, 3 at a time
  for (let i = 0; i < netReturns.length; i += 3) {
    let batchPnL = 0;
    for (let j = i; j < Math.min(i + 3, netReturns.length); j++) {
      batchPnL += multiSize * netReturns[j];
    }
    multiEquity += batchPnL;
    if (multiEquity > multiPeak) multiPeak = multiEquity;
    const dd = (multiPeak - multiEquity) / multiPeak;
    if (dd > multiMaxDD) multiMaxDD = dd;
    multiCurve.push(multiEquity);
    if (multiEquity <= 0) { multiBlown = true; break; }
  }

  // Monthly returns
  const monthlyReturns = {};
  for (const ev of events) {
    const key = `${ev.year}-${String(ev.month + 1).padStart(2, '0')}`;
    if (!monthlyReturns[key]) monthlyReturns[key] = [];
    monthlyReturns[key].push(ev.netReturn);
  }
  const monthlyStats = {};
  let monthsPos = 0, monthsTotal = 0;
  for (const [m, rets] of Object.entries(monthlyReturns)) {
    const ms = stats(rets);
    monthlyStats[m] = { mean: ms.mean * 100, n: ms.n, sum: rets.reduce((s, x) => s + x, 0) * 100 };
    monthsTotal++;
    if (rets.reduce((s, x) => s + x, 0) > 0) monthsPos++;
  }

  return {
    fixed: {
      finalEquity: fixedEquity.toFixed(2),
      totalReturn: ((fixedEquity - CAPITAL) / CAPITAL * 100).toFixed(2),
      maxDD: (fixedMaxDD * 100).toFixed(2),
      blown: fixedBlown,
      curve: fixedCurve,
    },
    compound: {
      finalEquity: compoundEquity.toFixed(2),
      totalReturn: ((compoundEquity - CAPITAL) / CAPITAL * 100).toFixed(2),
      maxDD: (compoundMaxDD * 100).toFixed(2),
      blown: compoundBlown,
      curve: compoundCurve,
    },
    multiAsset: {
      finalEquity: multiEquity.toFixed(2),
      totalReturn: ((multiEquity - CAPITAL) / CAPITAL * 100).toFixed(2),
      maxDD: (multiMaxDD * 100).toFixed(2),
      blown: multiBlown,
      curve: multiCurve,
    },
    monthly: {
      monthsPos,
      monthsTotal,
      profitablePct: monthsTotal > 0 ? (monthsPos / monthsTotal * 100).toFixed(1) : 0,
      stats: monthlyStats,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5 — FAILURE THRESHOLD
// ═══════════════════════════════════════════════════════════════════

function computeFailureThreshold(events) {
  const netReturns = events.map(e => e.netReturn);
  const maes = events.map(e => Math.abs(e.mae));

  // At what position size does a 20/30/50% drawdown become likely?
  // Monte Carlo: shuffle returns, simulate equity curves at different sizes
  const MC_RUNS = 5000;
  const thresholds = [0.10, 0.20, 0.30, 0.50];
  const riskLevels = [0.005, 0.01, 0.015, 0.02, 0.03, 0.05];

  const results = {};

  for (const riskLevel of riskLevels) {
    const posSize = (CAPITAL * riskLevel) / percentile(maes, 99);
    const ddCounts = {};
    for (const t of thresholds) ddCounts[t] = 0;

    for (let run = 0; run < MC_RUNS; run++) {
      // Shuffle returns
      const shuffled = [...netReturns];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      let equity = CAPITAL;
      let peak = CAPITAL;
      let maxDD = 0;

      for (const r of shuffled) {
        equity += posSize * r;
        if (equity > peak) peak = equity;
        const dd = (peak - equity) / peak;
        if (dd > maxDD) maxDD = dd;
        if (equity <= 0) { maxDD = 1.0; break; }
      }

      for (const t of thresholds) {
        if (maxDD >= t) ddCounts[t]++;
      }
    }

    results[`risk_${(riskLevel * 100).toFixed(1)}%`] = {
      positionSize: posSize.toFixed(2),
      positionSizePct: (posSize / CAPITAL * 100).toFixed(2),
      ddProbabilities: {},
    };

    for (const t of thresholds) {
      results[`risk_${(riskLevel * 100).toFixed(1)}%`].ddProbabilities[`${t * 100}%`] =
        (ddCounts[t] / MC_RUNS * 100).toFixed(1) + '%';
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let r = `# 🔒 FINAL ROBUSTNESS VALIDATION\n`;
  r += `**Generated:** ${new Date().toISOString()}\n`;
  r += `**Architecture:** Funding rate extremes → 48h time exit → NO stops\n`;
  r += `**Data:** Binance perpetual futures, ${START_DATE.slice(0, 10)} → ${END_DATE.slice(0, 10)}\n`;
  r += `**Question:** Can this architecture survive REAL capital conditions?\n\n---\n\n`;

  for (const [asset, data] of Object.entries(allResults)) {
    r += `## ${asset}\n\n`;

    // STEP 1: Loss Clusters
    r += `### Step 1 — Loss Cluster Stress Test\n\n`;
    const lc = data.lossClusters;
    r += `**Position size:** ${lc.positionSizePct}% of capital (${lc.positionSize} units on $${CAPITAL})\n`;
    r += `**Worst MAE (p99%):** ${lc.worstMAE.toFixed(1)}%\n\n`;

    r += `#### Historical Worst Sequences\n\n`;
    r += `| Sequence | Total Loss | Avg Loss | Sized DD |\n`;
    r += `|----------|------------|----------|----------|\n`;
    for (const [key, val] of Object.entries(lc.historicalSequences)) {
      r += `| ${key} | ${val.totalReturn.toFixed(2)}% | ${val.avgLoss.toFixed(2)}% | ${val.drawdownPct.toFixed(1)}% |\n`;
    }

    r += `\n#### Monte Carlo — 30 Consecutive Losses (10,000 runs)\n\n`;
    r += `| Percentile | Cumulative Loss | Drawdown |\n`;
    r += `|------------|----------------|----------|\n`;
    r += `| Median (p50) | ${lc.monteCarlo.p50.toFixed(2)}% | — |\n`;
    r += `| p10 | ${lc.monteCarlo.p10.toFixed(2)}% | — |\n`;
    r += `| p1 | ${lc.monteCarlo.p1.toFixed(2)}% | ${lc.monteCarlo.dd_p1.toFixed(1)}% |\n`;
    r += `| p0.1 | ${lc.monteCarlo.p0_1.toFixed(2)}% | ${lc.monteCarlo.dd_p0_1.toFixed(1)}% |\n`;
    r += `| Absolute worst | ${lc.monteCarlo.worst.toFixed(2)}% | — |\n`;

    r += `\n**Historical clusters:** max=${lc.maxHistoricalCluster}, top5=[${lc.top5Clusters.join(', ')}], mean=${lc.clusterDistribution.mean}\n\n`;

    // STEP 2: Tail Extremes
    r += `### Step 2 — Tail Extreme Simulation\n\n`;
    r += `| Scenario | MAE | Pos Size | Expectancy | PF | 3-Seq DD | Survives? |\n`;
    r += `|----------|-----|----------|------------|----|----|----------|\n`;
    for (const [label, val] of Object.entries(data.tailExtremes)) {
      r += `| ${label} | ${val.mae.toFixed(1)}% | ${val.positionSizePct}% | ${val.newExpectancy.toFixed(2)}% | ${val.newPF.toFixed(2)} | ${val.threeSeqDrawdown}% | ${val.survivesThreeSeq ? '✅' : '❌'} |\n`;
    }
    r += `\n`;

    // STEP 3: Exit Time Stability
    r += `### Step 3 — Exit Time Stability\n\n`;
    r += `| Hold | n | Expectancy (bps) | t-stat | %Win | PF | Years+ |\n`;
    r += `|------|---|------------------|--------|------|----|--------|\n`;
    for (const [hold, val] of Object.entries(data.exitTime)) {
      if (hold === 'sensitivity') continue;
      r += `| ${hold} | ${val.n} | ${val.expectancy.toFixed(1)} | ${val.tStat.toFixed(2)} | ${val.pctPositive.toFixed(1)}% | ${val.pf.toFixed(2)} | ${val.yearsPos}/${val.yearsTotal} |\n`;
    }

    const sens = data.exitTime.sensitivity;
    r += `\n**Sensitivity:** range=${sens.range_bps.toFixed(1)} bps | 48h optimal: ${sens.is_48h_optimal ? '✅' : '❌'} | monotonic: ${sens.is_monotonic ? '✅' : '❌'}\n`;
    r += `**36h→48h change:** ${sens.pct_change_36_to_48.toFixed(1)}% | **48h→60h change:** ${sens.pct_change_48_to_60.toFixed(1)}%\n\n`;

    // Year-by-year across hold periods
    r += `#### Year-by-Year Across Hold Periods\n\n`;
    r += `| Year | 36h (bps) | 48h (bps) | 60h (bps) |\n`;
    r += `|------|-----------|-----------|----------|\n`;
    const allYears = new Set();
    for (const hold of ['36h', '48h', '60h']) {
      if (data.exitTime[hold]?.yearStats) {
        for (const y of Object.keys(data.exitTime[hold].yearStats)) allYears.add(y);
      }
    }
    for (const y of [...allYears].sort()) {
      const r36 = data.exitTime['36h']?.yearStats[y]?.mean * 10000 || 0;
      const r48 = data.exitTime['48h']?.yearStats[y]?.mean * 10000 || 0;
      const r60 = data.exitTime['60h']?.yearStats[y]?.mean * 10000 || 0;
      r += `| ${y} | ${r36.toFixed(1)} | ${r48.toFixed(1)} | ${r60.toFixed(1)} |\n`;
    }
    r += `\n`;

    // STEP 4: Capital Path
    r += `### Step 4 — Capital Path Simulation ($${CAPITAL} initial)\n\n`;
    const cp = data.capitalPath;
    r += `| Scenario | Final Equity | Total Return | Max DD | Blown? |\n`;
    r += `|----------|-------------|-------------|--------|--------|\n`;
    r += `| Fixed sizing | $${cp.fixed.finalEquity} | ${cp.fixed.totalReturn}% | ${cp.fixed.maxDD}% | ${cp.fixed.blown ? '❌' : '✅'} |\n`;
    r += `| Compounding | $${cp.compound.finalEquity} | ${cp.compound.totalReturn}% | ${cp.compound.maxDD}% | ${cp.compound.blown ? '❌' : '✅'} |\n`;
    r += `| Multi-asset (3x) | $${cp.multiAsset.finalEquity} | ${cp.multiAsset.totalReturn}% | ${cp.multiAsset.maxDD}% | ${cp.multiAsset.blown ? '❌' : '✅'} |\n`;

    r += `\n**Profitable months:** ${cp.monthly.monthsPos}/${cp.monthly.monthsTotal} (${cp.monthly.profitablePct}%)\n\n`;

    // STEP 5: Failure Threshold
    r += `### Step 5 — Failure Threshold (Monte Carlo, 5,000 runs)\n\n`;
    r += `| Risk Level | Pos Size | DD ≥10% | DD ≥20% | DD ≥30% | DD ≥50% |\n`;
    r += `|------------|----------|---------|---------|---------|--------|\n`;
    for (const [level, val] of Object.entries(data.failureThreshold)) {
      r += `| ${level} | ${val.positionSizePct}% | ${val.ddProbabilities['10%']} | ${val.ddProbabilities['20%']} | ${val.ddProbabilities['30%']} | ${val.ddProbabilities['50%']} |\n`;
    }
    r += `\n---\n\n`;
  }

  // FINAL CLASSIFICATION
  r += `## FINAL CLASSIFICATION\n\n`;

  for (const [asset, data] of Object.entries(allResults)) {
    const lc = data.lossClusters;
    const cp = data.capitalPath;
    const sens = data.exitTime.sensitivity;

    const flags = [];
    let score = 0;

    // Check: no blowup under fixed sizing
    if (!cp.fixed.blown) score += 2; else flags.push('BLOWS UP under fixed sizing');

    // Check: max DD under 30%
    if (parseFloat(cp.fixed.maxDD) < 30) score += 2;
    else if (parseFloat(cp.fixed.maxDD) < 50) { score += 1; flags.push('Max DD > 30%'); }
    else flags.push('Max DD > 50%');

    // Check: multi-asset doesn't blow
    if (!cp.multiAsset.blown) score += 2; else flags.push('BLOWS UP multi-asset');

    // Check: exit time is stable (not fragile)
    if (sens.range_bps < 80) score += 1; else flags.push('Exit time fragile (range > 80 bps)');

    // Check: survives tail extremes at 30% MAE
    const tail30 = data.tailExtremes['30%'];
    if (tail30 && tail30.survivesThreeSeq) score += 1; else flags.push('Does not survive 30% MAE tail');

    // Check: Monte Carlo p1 DD under 50%
    if (lc.monteCarlo.dd_p1 < 50) score += 1; else flags.push('MC p1 DD > 50%');

    // Check: profitable months > 50%
    if (parseFloat(cp.monthly.profitablePct) > 50) score += 1; else flags.push('Less than 50% profitable months');

    let classification;
    if (score >= 8) classification = '🟢 PRODUCTION-READY';
    else if (score >= 5) classification = '🟡 CONDITIONAL / FRAGILE';
    else classification = '🔴 NOT SURVIVABLE';

    r += `### ${asset}: ${classification} (score: ${score}/10)\n\n`;
    if (flags.length > 0) {
      r += `**Flags:**\n`;
      for (const f of flags) r += `- ⚠️ ${f}\n`;
      r += `\n`;
    }
  }

  // Overall verdict
  const allScores = Object.entries(allResults).map(([asset, data]) => {
    const cp = data.capitalPath;
    return { asset, blown: cp.fixed.blown || cp.multiAsset.blown, dd: parseFloat(cp.fixed.maxDD) };
  });

  const anyBlown = allScores.some(s => s.blown);
  const allDDUnder30 = allScores.every(s => s.dd < 30);

  r += `## OVERALL VERDICT\n\n`;
  if (!anyBlown && allDDUnder30) {
    r += `### 🟢 CASE A — PRODUCTION-READY ARCHITECTURE\n\n`;
    r += `- Survives extreme stress (no blowups, DD < 30%)\n`;
    r += `- Stable across time and exit windows\n`;
    r += `- Acceptable drawdown profile\n`;
    r += `→ **PROCEED TO SYSTEM CONSTRUCTION**\n`;
  } else if (!anyBlown) {
    r += `### 🟡 CASE B — CONDITIONAL / FRAGILE\n\n`;
    r += `- Survives but drawdowns exceed comfort\n`;
    r += `- Requires further constraints before building\n`;
  } else {
    r += `### 🔴 CASE C — NOT SURVIVABLE\n\n`;
    r += `- Collapses under realistic stress\n`;
    r += `- Reject implementation\n`;
  }

  return r;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔒 FINAL ROBUSTNESS VALIDATION                                  ║
║  Can this architecture survive REAL capital conditions?          ║
║  Entry: funding extremes | Exit: 48h time | No stops            ║
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

    const fundingRates = await fetchFundingRates(asset.symbol);
    const candles = await fetchCandles(asset.symbol);
    const aligned = alignFundingToCandles(fundingRates, candles);
    console.log(`  Aligned: ${aligned.length} funding events`);

    const signals = detectSignals(aligned, candles, asset.label);
    console.log(`  📊 Signals: ${signals.length}`);

    // Extract events at 72h (we'll resample for different hold periods)
    const events = [];
    for (const sig of signals) {
      const ev = extractEvent(candles, sig.entryIdx, 72);
      if (ev && ev.pathReturns.length >= 60) {
        ev.signal = sig.signal;
        ev.year = sig.year;
        events.push(ev);
      }
    }
    console.log(`  📈 Valid events: ${events.length}`);

    // For the 48h-specific tests, re-extract at 48h
    const events48 = [];
    for (const sig of signals) {
      const ev = extractEvent(candles, sig.entryIdx, 48);
      if (ev) {
        ev.signal = sig.signal;
        ev.year = sig.year;
        events48.push(ev);
      }
    }

    // STEP 1: Loss cluster stress test
    console.log(`\n  Step 1: Loss cluster stress test...`);
    const lossClusters = stressTestLossClusters(events48);
    console.log(`    Position: ${lossClusters.positionSizePct}% | Worst MAE: ${lossClusters.worstMAE.toFixed(1)}% | Max cluster: ${lossClusters.maxHistoricalCluster}`);
    console.log(`    MC 30-loss p1: ${lossClusters.monteCarlo.p1.toFixed(2)}% (DD ${lossClusters.monteCarlo.dd_p1.toFixed(1)}%)`);

    // STEP 2: Tail extreme simulation
    console.log(`  Step 2: Tail extreme simulation...`);
    const tailExtremes = stressTestTailExtremes(events48);
    for (const [label, val] of Object.entries(tailExtremes)) {
      console.log(`    ${label}: MAE=${val.mae.toFixed(1)}% pos=${val.positionSizePct}% 3seqDD=${val.threeSeqDrawdown}% survive=${val.survivesThreeSeq}`);
    }

    // STEP 3: Exit time stability
    console.log(`  Step 3: Exit time stability (36h/48h/60h)...`);
    const exitTime = stressTestExitTime(signals, candles, asset.label);
    for (const hold of ['36h', '48h', '60h']) {
      const v = exitTime[hold];
      console.log(`    ${hold}: ${v.expectancy.toFixed(1)}bps t=${v.tStat.toFixed(2)} PF=${v.pf.toFixed(2)} years+=${v.yearsPos}/${v.yearsTotal}`);
    }
    console.log(`    Sensitivity: ${exitTime.sensitivity.range_bps.toFixed(1)} bps range | 48h optimal: ${exitTime.sensitivity.is_48h_optimal}`);

    // STEP 4: Capital path simulation
    console.log(`  Step 4: Capital path simulation...`);
    const capitalPath = simulateCapitalPath(events48, asset.label);
    console.log(`    Fixed: ${capitalPath.fixed.totalReturn}% DD=${capitalPath.fixed.maxDD}% blown=${capitalPath.fixed.blown}`);
    console.log(`    Compound: ${capitalPath.compound.totalReturn}% DD=${capitalPath.compound.maxDD}% blown=${capitalPath.compound.blown}`);
    console.log(`    Multi: ${capitalPath.multiAsset.totalReturn}% DD=${capitalPath.multiAsset.maxDD}% blown=${capitalPath.multiAsset.blown}`);
    console.log(`    Profitable months: ${capitalPath.monthly.profitablePct}%`);

    // STEP 5: Failure threshold
    console.log(`  Step 5: Failure threshold...`);
    const failureThreshold = computeFailureThreshold(events48);
    const risk1 = failureThreshold['risk_1.0%'];
    console.log(`    At 1% risk: DD≥20% prob=${risk1?.ddProbabilities['20%']} DD≥50% prob=${risk1?.ddProbabilities['50%']}`);

    allResults[asset.label] = { lossClusters, tailExtremes, exitTime, capitalPath, failureThreshold };
  }

  // Report
  const report = generateReport(allResults);
  const reportPath = path.join(__dirname, 'ROBUSTNESS_VALIDATION_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  const rawPath = path.join(__dirname, 'robustness-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw: ${rawPath}`);

  // Verdict
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  🏆 FINAL VERDICT`);
  console.log(`${'═'.repeat(60)}\n`);

  for (const [asset, data] of Object.entries(allResults)) {
    const cp = data.capitalPath;
    const blown = cp.fixed.blown || cp.multiAsset.blown;
    const dd = parseFloat(cp.fixed.maxDD);
    const status = blown ? '🔴 BLOWS UP' : dd > 30 ? '🟡 HIGH DD' : '🟢 SURVIVES';
    console.log(`  ${status} ${asset}: DD=${cp.fixed.maxDD}% return=${cp.fixed.totalReturn}% months=${cp.monthly.profitablePct}%`);
  }

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
