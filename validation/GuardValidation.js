// ═══════════════════════════════════════════════════════════════════
// PHASE 2B — GUARD VALIDATION (ANTI-OVERFITTING PROTOCOL)
// ═══════════════════════════════════════════════════════════════════
// Each guard tested INDEPENDENTLY. No optimization. No tuning.
// Thresholds locked from Phase 2A forensics.
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── LOCKED PARAMETERS ─────────────────────────────────────────────
const CONFIG = {
  label: 'BTC',
  symbol: 'BTC/USDT:USDT',
  extremeLowPct: 10,
  extremeHighPct: 95,
  cumulativeDrainPct: 90,
  cumulativeWindow: 10,
  holdHours: 48,
  riskPerTrade: 0.01,
  takerFee: 0.0005,
  roundTripFee: 0.0014,
  startingCapital: 10000,
  worstMAE: 0.127,
  signalTypes: ['extremeLow_p10', 'extremeHigh_p95', 'highCumDrain'],
};

// ── GUARD DEFINITIONS (LOCKED FROM PHASE 2A) ─────────────────────
// NO threshold tuning. These are from forensics.
const GUARDS = {
  guard1_30dPriceTrend: {
    name: '30d Price Trend',
    description: 'Block when 30d price change < -8% (deleveraging) OR > +10% (trending up)',
    block: (signal) => {
      if (signal.priceChange30d === undefined) return false;
      return signal.priceChange30d < -0.08 || signal.priceChange30d > 0.10;
    },
  },
  guard2_ATRZScore: {
    name: 'ATR Z-Score',
    description: 'Block when ATR z-score < -1.0 (compressed/volatility-dead regime)',
    block: (signal) => {
      if (signal.atrZScore === undefined) return false;
      return signal.atrZScore < -1.0;
    },
  },
  guard3_CumDrainConcentration: {
    name: 'CumDrain Concentration',
    description: 'Block when single-event contribution > 60% of cumulative drain',
    block: (signal) => {
      if (signal.cumDrainContribution === undefined) return false;
      return signal.cumDrainContribution > 0.60;
    },
  },
  guard4_FundingAcceleration: {
    name: 'Funding Acceleration',
    description: 'Block extremeLow_p10 when 72h funding slope < -0.005% (accelerating down)',
    block: (signal) => {
      if (signal.signalType !== 'extremeLow_p10') return false;
      if (signal.fundingSlope72h === undefined) return false;
      return signal.fundingSlope72h < -0.00005;
    },
  },
  guard5_CombinedRegime: {
    name: 'Combined Regime Check',
    description: 'Block if (30d < -5% AND ATR high) OR (30d > +8% AND ATR low)',
    block: (signal) => {
      if (signal.priceChange30d === undefined || signal.atrZScore === undefined) return false;
      const crash = signal.priceChange30d < -0.05 && signal.atrZScore > 0.5;
      const bull = signal.priceChange30d > 0.08 && signal.atrZScore < -0.5;
      return crash || bull;
    },
  },
};

// ── CATASTROPHIC WINDOW IDS ───────────────────────────────────────
const CATASTROPHIC_IDS = ['W2', 'W4', 'W7', 'W15'];

// ── HELPERS ───────────────────────────────────────────────────────
function percentile(arr, p) {
  const sorted = [...arr].filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(p / 100 * sorted.length), sorted.length - 1)];
}
function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

function findCandleIndex(candles, ts) {
  let lo = 0, hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].timestamp < ts) lo = mid + 1;
    else hi = mid - 1;
  }
  if (lo < candles.length && Math.abs(candles[lo].timestamp - ts) <= 3600000) return lo;
  if (lo > 0 && Math.abs(candles[lo - 1].timestamp - ts) <= 3600000) return lo - 1;
  return null;
}

// ── WALK-FORWARD WINDOWS ──────────────────────────────────────────
function generateWindows(dataStart, dataEnd) {
  const windows = [];
  const ms = { train: 365.25 * 24 * 3600 * 1000, test: 91.3125 * 24 * 3600 * 1000, step: 91.3125 * 24 * 3600 * 1000 };
  let testStart = new Date(dataStart).getTime() + ms.train;
  const end = new Date(dataEnd).getTime();
  while (testStart + ms.test <= end) {
    const testEnd = testStart + ms.test;
    windows.push({
      id: windows.length + 1,
      label: `W${windows.length + 1}`,
      trainStart: new Date(testStart - ms.train).toISOString().slice(0, 10),
      trainEnd: new Date(testStart - 1).toISOString().slice(0, 10),
      testStart: new Date(testStart).toISOString().slice(0, 10),
      testEnd: new Date(testEnd - 1).toISOString().slice(0, 10),
      _trainStartTs: testStart - ms.train,
      _trainEndTs: testStart - 1,
      _testStartTs: testStart,
      _testEndTs: testEnd - 1,
    });
    testStart += ms.step;
  }
  return windows;
}

// ── DATA FETCHING ─────────────────────────────────────────────────
async function fetchData(exchange, symbol, since, until) {
  const allF = []; let cursor = since;
  process.stdout.write('  📥 Funding...');
  while (cursor < until) {
    try {
      const r = await exchange.fetchFundingRateHistory(symbol, cursor, 1000);
      if (!r || r.length === 0) break;
      allF.push(...r); cursor = r[r.length - 1].timestamp + 1;
      if (r.length < 1000) break;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) { cursor += 8 * 3600 * 1000; await new Promise(r => setTimeout(r, exchange.rateLimit * 3)); }
  }
  const seenF = new Set(), uniqueF = [];
  for (const r of allF) { if (!seenF.has(r.timestamp)) { seenF.add(r.timestamp); uniqueF.push({ timestamp: r.timestamp, fundingRate: r.fundingRate }); } }

  const allC = []; cursor = since;
  process.stdout.write(' Candles...');
  while (cursor < until) {
    try {
      const c = await exchange.fetchOHLCV(symbol, '1h', cursor, 1000);
      if (!c || !c.length) break;
      allC.push(...c); cursor = c[c[c.length - 1] ? c.length - 1 : 0][0] + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) { cursor += 3600 * 1000; await new Promise(r => setTimeout(r, exchange.rateLimit * 3)); }
  }
  const seenC = new Set(), uniqueC = [];
  for (const c of allC) { if (!seenC.has(c[0])) { seenC.add(c[0]); uniqueC.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }); } }

  console.log(`${uniqueF.length} funding, ${uniqueC.length} candles ✅`);
  return { funding: uniqueF, candles: uniqueC };
}

// ── COMPUTE SIGNAL FEATURES ───────────────────────────────────────
function computeSignalFeatures(funding, candles, trainFunding, candleOffset) {
  const trainRates = trainFunding.map(f => f.fundingRate);
  const trainMean = mean(trainRates);
  const trainStddev = stddev(trainRates);

  // ATR distribution from train candles
  const trainATRs = [];
  for (let i = 14; i < candleOffset; i++) {
    const trs = [];
    for (let j = i - 13; j <= i; j++) {
      if (candles[j]) trs.push((candles[j].high - candles[j].low) / candles[j].close);
    }
    if (trs.length === 14) trainATRs.push(mean(trs));
  }
  const trainATRMean = mean(trainATRs);
  const trainATRStddev = stddev(trainATRs);

  return { trainMean, trainStddev, trainATRMean, trainATRStddev };
}

function enrichSignal(signal, funding, candles, idx, features) {
  const { trainMean, trainStddev, trainATRMean, trainATRStddev } = features;

  // 72h funding slope
  const lookback9 = [];
  for (let j = Math.max(0, idx - 9); j < idx; j++) lookback9.push(funding[j].fundingRate);
  signal.fundingSlope72h = lookback9.length >= 2 ? lookback9[lookback9.length - 1] - lookback9[0] : 0;
  signal.fundingAccelerating = Math.abs(funding[idx].fundingRate) > Math.abs(mean(lookback9));

  // Cumulative drain contribution
  const cumWindow = CONFIG.cumulativeWindow;
  let cumSum = 0; const cumRates = [];
  for (let j = Math.max(0, idx - cumWindow + 1); j <= idx; j++) {
    cumSum += funding[j].fundingRate;
    cumRates.push(funding[j].fundingRate);
  }
  signal.cumulativeDrain = cumSum;
  signal.cumDrainContribution = Math.max(...cumRates.map(Math.abs)) / (Math.abs(cumSum) || 1);

  // Price features (if candle available)
  if (signal.entryIdx !== null && signal.entryIdx !== undefined) {
    const ci = signal.entryIdx;
    if (ci >= 720) {
      const p30d = [];
      for (let j = ci - 720; j <= ci; j++) if (candles[j]) p30d.push(candles[j].close);
      if (p30d.length > 1) signal.priceChange30d = (p30d[p30d.length - 1] - p30d[0]) / p30d[0];
    }
    if (ci >= 168) {
      const p7d = [];
      for (let j = ci - 168; j <= ci; j++) if (candles[j]) p7d.push(candles[j].close);
      if (p7d.length > 1) signal.priceChange7d = (p7d[p7d.length - 1] - p7d[0]) / p7d[0];
    }
    if (ci >= 14) {
      const trs = [];
      for (let j = ci - 13; j <= ci; j++) if (candles[j]) trs.push((candles[j].high - candles[j].low) / candles[j].close);
      signal.atr14 = mean(trs);
      if (trainATRStddev > 0) signal.atrZScore = (signal.atr14 - trainATRMean) / trainATRStddev;
    }
  }

  // Signal type
  signal.signalType = 'unknown';
  if (funding[idx].fundingRate <= signal._p10) signal.signalType = 'extremeLow_p10';
  else if (funding[idx].fundingRate >= signal._p95) signal.signalType = 'extremeHigh_p95';
  else signal.signalType = 'highCumDrain';

  return signal;
}

// ── WINDOW RUNNER ─────────────────────────────────────────────────
function runWindowWithGuard(allFunding, allCandles, window, guardFn) {
  const trainFunding = allFunding.filter(f => f.timestamp >= window._trainStartTs && f.timestamp <= window._trainEndTs);
  const testFunding = allFunding.filter(f => f.timestamp >= window._testStartTs && f.timestamp <= window._testEndTs);
  const testCandles = allCandles.filter(c => c.timestamp >= window._testStartTs && c.timestamp <= window._testEndTs);
  const trainCandles = allCandles.filter(c => c.timestamp >= window._trainStartTs && c.timestamp <= window._trainEndTs);

  if (trainFunding.length < 50 || testFunding.length < 10) return null;

  // Train thresholds
  const trainRates = trainFunding.map(f => f.fundingRate);
  const p10 = percentile(trainRates, CONFIG.extremeLowPct);
  const p95 = percentile(trainRates, CONFIG.extremeHighPct);
  const cumWindow = CONFIG.cumulativeWindow;

  const trainCumValues = [];
  for (let i = 0; i < trainRates.length; i++) {
    let s = 0; for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) s += trainRates[j];
    trainCumValues.push(s);
  }
  const cumP90 = percentile(trainCumValues, CONFIG.cumulativeDrainPct);

  // Test cumulative
  const testRates = testFunding.map(f => f.fundingRate);
  const testCumValues = [];
  for (let i = 0; i < testRates.length; i++) {
    let s = 0; for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) s += testRates[j];
    testCumValues.push(s);
  }

  // Signal features for enrichment
  const features = computeSignalFeatures(allFunding, allCandles, trainFunding,
    allCandles.findIndex(c => c.timestamp >= window._testStartTs));

  // Detect signals
  const signals = [];
  // Map test funding indices to allFunding indices
  const testStartIdx = allFunding.findIndex(f => f.timestamp >= window._testStartTs);

  for (let i = 0; i < testFunding.length; i++) {
    const fr = testFunding[i];
    let signalType = null;
    if (CONFIG.signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) signalType = 'extremeLow_p10';
    else if (CONFIG.signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) signalType = 'extremeHigh_p95';
    else if (CONFIG.signalTypes.includes('highCumDrain') && testCumValues[i] >= cumP90) signalType = 'highCumDrain';

    if (signalType) {
      const candleIdx = findCandleIndex(testCandles, fr.timestamp);
      if (candleIdx !== null && candleIdx + CONFIG.holdHours < testCandles.length) {
        const globalIdx = testStartIdx + i;
        let signal = {
          signalType,
          fundingRate: fr.fundingRate,
          entryIdx: candleIdx,
          entryTimestamp: testCandles[candleIdx].timestamp,
          entryPrice: testCandles[candleIdx].close,
          _p10: p10, _p95: p95,
        };
        signal = enrichSignal(signal, allFunding, allCandles, globalIdx, features);
        signals.push(signal);
      }
    }
  }

  signals.sort((a, b) => a.entryTimestamp - b.entryTimestamp);

  // Execute trades WITH guard
  let capital = CONFIG.startingCapital;
  let inPosition = false;
  let currentPos = null;
  const trades = [];
  let peak = capital, maxDD = 0;
  let totalBlocked = 0, totalSignals = signals.length;

  for (const signal of signals) {
    // Check exit
    if (inPosition && currentPos) {
      const elapsed = signal.entryTimestamp - currentPos.entryTime;
      if (elapsed >= CONFIG.holdHours * 3600000) {
        const exitIdx = currentPos.entryIdx + CONFIG.holdHours;
        const exitPrice = exitIdx < testCandles.length ? testCandles[exitIdx].close : testCandles[testCandles.length - 1].close;
        const exitFee = currentPos.size * exitPrice * CONFIG.takerFee;
        const pnl = (exitPrice - currentPos.entryPrice) * currentPos.size - currentPos.entryFee - exitFee;
        capital += pnl;
        if (capital > peak) peak = capital;
        const dd = (peak - capital) / peak; if (dd > maxDD) maxDD = dd;
        trades.push({ pnl, netReturn: pnl / (currentPos.size * currentPos.entryPrice) });
        inPosition = false; currentPos = null;
      }
    }

    // Apply guard
    if (guardFn && guardFn(signal)) {
      totalBlocked++;
      continue;
    }

    // Open
    if (!inPosition) {
      const size = (capital * CONFIG.riskPerTrade / CONFIG.worstMAE) / signal.entryPrice;
      if (size > 0) {
        const entryFee = size * signal.entryPrice * CONFIG.takerFee;
        capital -= entryFee;
        currentPos = { entryPrice: signal.entryPrice, size, entryTime: signal.entryTimestamp, entryIdx: signal.entryIdx, entryFee };
        inPosition = true;
      }
    }
  }

  // Close remaining
  if (inPosition && currentPos) {
    const exitIdx = currentPos.entryIdx + CONFIG.holdHours;
    const exitPrice = exitIdx < testCandles.length ? testCandles[exitIdx].close : testCandles[testCandles.length - 1].close;
    const exitFee = currentPos.size * exitPrice * CONFIG.takerFee;
    const pnl = (exitPrice - currentPos.entryPrice) * currentPos.size - currentPos.entryFee - exitFee;
    capital += pnl;
    if (capital > peak) peak = capital;
    const dd = (peak - capital) / peak; if (dd > maxDD) maxDD = dd;
    trades.push({ pnl, netReturn: pnl / (currentPos.size * currentPos.entryPrice) });
  }

  // Stats
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const gp = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf = gl > 0 ? gp / gl : (gp > 0 ? 99.99 : 0);
  const netReturn = trades.reduce((s, t) => s + t.pnl, 0);

  return {
    trades: trades.length,
    blocked: totalBlocked,
    totalSignals,
    pf: isFinite(pf) ? pf : 99.99,
    wr: trades.length ? wins.length / trades.length * 100 : 0,
    maxDD: maxDD * 100,
    netReturn,
    netReturnPct: netReturn / CONFIG.startingCapital * 100,
    capital,
  };
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🧪 PHASE 2B — GUARD VALIDATION                                 ║
║  Anti-overfitting protocol                                      ║
║  Each guard tested INDEPENDENTLY                                ║
║  Thresholds LOCKED from forensics                               ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const DATA_START = '2021-01-01T00:00:00Z';
  const DATA_END = '2026-04-01T00:00:00Z';
  const windows = generateWindows(DATA_START, DATA_END);

  // Fetch data
  console.log('  📥 Fetching BTC data...\n');
  const exchange = new ccxt.binance({ enableRateLimit: true });
  const { funding, candles } = await fetchData(exchange, CONFIG.symbol,
    new Date(DATA_START).getTime(), new Date(DATA_END).getTime());

  // ── BASELINE (no guard) ─────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log('  📊 BASELINE (No Guard)');
  console.log(`${'═'.repeat(70)}\n`);

  const baselineResults = {};
  for (const w of windows) {
    const result = runWindowWithGuard(funding, candles, w, null);
    if (result) {
      baselineResults[w.label] = result;
      const cat = CATASTROPHIC_IDS.includes(w.label) ? '💀' : '  ';
      console.log(`  ${cat} ${w.label}: ${result.trades} trades | PF=${result.pf.toFixed(2)} | WR=${result.wr.toFixed(1)}% | Ret=${result.netReturnPct.toFixed(2)}%`);
    }
  }

  const baselineTrades = Object.values(baselineResults).reduce((s, r) => s + r.trades, 0);
  const baselineGP = Object.values(baselineResults).reduce((s, r) => s + (r.netReturn > 0 ? r.netReturn : 0), 0);
  const baselineGL = Math.abs(Object.values(baselineResults).reduce((s, r) => s + (r.netReturn < 0 ? r.netReturn : 0), 0));
  const baselinePF = baselineGL > 0 ? baselineGP / baselineGL : 99.99;
  console.log(`\n  Baseline: ${baselineTrades} trades | PF=${baselinePF.toFixed(3)} | Return=${Object.values(baselineResults).reduce((s, r) => s + r.netReturnPct, 0).toFixed(2)}%`);

  // ── TEST EACH GUARD ─────────────────────────────────────────────
  const guardResults = {};

  for (const [guardKey, guard] of Object.entries(GUARDS)) {
    console.log(`\n\n${'═'.repeat(70)}`);
    console.log(`  🛡️ GUARD: ${guard.name}`);
    console.log(`  ${guard.description}`);
    console.log(`${'═'.repeat(70)}\n`);

    const results = {};
    for (const w of windows) {
      const result = runWindowWithGuard(funding, candles, w, guard.block);
      if (result) {
        results[w.label] = result;
      }
    }

    // Per-window results
    for (const w of windows) {
      const r = results[w.label];
      if (!r) continue;
      const base = baselineResults[w.label];
      const cat = CATASTROPHIC_IDS.includes(w.label) ? '💀' : '  ';
      const blockedInfo = r.blocked > 0 ? `[${r.blocked}/${r.totalSignals} blocked]` : '';
      console.log(`  ${cat} ${w.label}: ${r.trades} trades | PF=${r.pf.toFixed(2)} | Ret=${r.netReturnPct.toFixed(2)}% ${blockedInfo}`);
    }

    // Compute guard metrics
    const catBlocked = CATASTROPHIC_IDS.filter(id => {
      const base = baselineResults[id];
      const guarded = results[id];
      if (!base || !guarded) return false;
      // A catastrophic window is "blocked" if its PF improves above 0.6 OR it has 0 trades
      return guarded.pf > 0.6 || guarded.trades === 0 || guarded.pf > base.pf * 1.5;
    });

    const goodFiltered = Object.keys(results).filter(id => {
      if (CATASTROPHIC_IDS.includes(id)) return false;
      const base = baselineResults[id];
      const guarded = results[id];
      if (!base || !guarded) return false;
      // Good window is "filtered" if it lost >30% of its trades
      return guarded.trades < base.trades * 0.7;
    });

    const guardTrades = Object.values(results).reduce((s, r) => s + r.trades, 0);
    const guardGP = Object.values(results).reduce((s, r) => s + (r.netReturn > 0 ? r.netReturn : 0), 0);
    const guardGL = Math.abs(Object.values(results).reduce((s, r) => s + (r.netReturn < 0 ? r.netReturn : 0), 0));
    const guardPF = guardGL > 0 ? guardGP / guardGL : 99.99;
    const tradeRetention = baselineTrades > 0 ? guardTrades / baselineTrades * 100 : 0;
    const pfDegradation = baselinePF > 0 ? (1 - guardPF / baselinePF) * 100 : 0;

    // Check catastrophic windows PF improvement
    const catWindowsImproved = CATASTROPHIC_IDS.filter(id => {
      const guarded = results[id];
      const base = baselineResults[id];
      if (!guarded || !base) return false;
      return guarded.pf > base.pf && guarded.pf >= 0.6;
    });

    // Verdict
    const meets3of4 = catWindowsImproved.length >= 3;
    const meetsGoodFilter = goodFiltered.length <= 2;
    const meetsRetention = tradeRetention >= 80;
    const meetsPF = pfDegradation <= 10;
    const pass = meets3of4 && meetsGoodFilter && meetsRetention && meetsPF;

    console.log(`\n  ── VERDICT ──────────────────────────`);
    console.log(`  Catastrophic windows improved: ${catWindowsImproved.length}/4 ${meets3of4 ? '✅' : '❌'}`);
    console.log(`  Good windows filtered: ${goodFiltered.length}/12 ${meetsGoodFilter ? '✅' : '❌'} ${goodFiltered.length > 0 ? '(' + goodFiltered.join(', ') + ')' : ''}`);
    console.log(`  Trade retention: ${tradeRetention.toFixed(1)}% ${meetsRetention ? '✅' : '❌'}`);
    console.log(`  PF: ${baselinePF.toFixed(3)} → ${guardPF.toFixed(3)} (${pfDegradation > 0 ? '+' : ''}${pfDegradation.toFixed(1)}%) ${meetsPF ? '✅' : '❌'}`);
    console.log(`\n  Result: ${pass ? '🟢 PASS' : '🔴 FAIL'}`);

    guardResults[guardKey] = {
      name: guard.name,
      results,
      catWindowsImproved: catWindowsImproved.length,
      goodFiltered: goodFiltered.length,
      goodFilteredWindows: goodFiltered,
      tradeRetention,
      baselinePF,
      guardPF,
      pfDegradation,
      pass,
    };
  }

  // ── FINAL SUMMARY ───────────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  📊 FINAL SUMMARY`);
  console.log(`${'═'.repeat(70)}\n`);

  const passingGuards = Object.entries(guardResults).filter(([, r]) => r.pass);
  const failingGuards = Object.entries(guardResults).filter(([, r]) => !r.pass);

  console.log(`  ${'Guard'.padEnd(35)} | ${'Cat Fix'.padStart(7)} | ${'Good Cut'.padStart(9)} | ${'Retain%'.padStart(8)} | ${'PF'.padStart(6)} | Verdict`);
  console.log(`  ${'─'.repeat(85)}`);
  for (const [key, r] of Object.entries(guardResults)) {
    console.log(`  ${r.name.padEnd(35)} | ${String(r.catWindowsImproved + '/4').padStart(7)} | ${String(r.goodFiltered + '/12').padStart(9)} | ${r.tradeRetention.toFixed(1).padStart(6)}% | ${r.guardPF.toFixed(3).padStart(6)} | ${r.pass ? '🟢 PASS' : '🔴 FAIL'}`);
  }

  console.log(`\n  Passing guards: ${passingGuards.length}/5`);
  console.log(`  Failing guards: ${failingGuards.length}/5`);

  if (passingGuards.length === 0) {
    console.log(`\n  ╔══════════════════════════════════════════════════════════╗`);
    console.log(`  ║  🔴 ALL GUARDS FAILED                                   ║`);
    console.log(`  ║  Project is TERMINATED.                                 ║`);
    console.log(`  ║  No Phase 2C allowed.                                   ║`);
    console.log(`  ╚══════════════════════════════════════════════════════════╝`);
  } else {
    console.log(`\n  ╔══════════════════════════════════════════════════════════╗`);
    console.log(`  ║  🟢 ${passingGuards.length} GUARD(S) PASSED — PROCEED TO PHASE 2C            ║`);
    console.log(`  ╚══════════════════════════════════════════════════════════╝`);
    console.log(`\n  Passing guards:`);
    for (const [key, r] of passingGuards) {
      console.log(`    ✅ ${r.name}`);
    }
  }

  // Write results
  fs.writeFileSync(path.join(__dirname, 'guard-validation-results.json'),
    JSON.stringify({ baseline: { trades: baselineTrades, pf: baselinePF }, guards: guardResults }, null, 2));
  console.log(`\n  ✅ Results: validation/guard-validation-results.json`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
