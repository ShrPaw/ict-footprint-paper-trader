// ═══════════════════════════════════════════════════════════════════
// BTC-ONLY WALK-FORWARD VALIDATION — EDGE ISOLATION
// ═══════════════════════════════════════════════════════════════════
// Single-asset BTC validation. No ETH, no XRP, no slot competition.
// Entry: funding extremes (p10/p95/cumulative drain)
// Exit: Fixed 48h time exit, no stops
// Risk: 1% per trade, no concurrent limit (single asset)
// All BTC logic IDENTICAL to original system.
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── LOCKED BTC PARAMETERS (IDENTICAL TO ORIGINAL) ─────────────────
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
  worstMAE: 0.127,       // BTC locked from research
  signalTypes: ['extremeLow_p10', 'extremeHigh_p95', 'highCumDrain'],
};

// ── WALK-FORWARD WINDOWS ──────────────────────────────────────────
function generateWindows(dataStart, dataEnd) {
  const windows = [];
  const ms = {
    train: 365.25 * 24 * 3600 * 1000,
    test: 91.3125 * 24 * 3600 * 1000,
    step: 91.3125 * 24 * 3600 * 1000,
  };
  let testStart = new Date(dataStart).getTime() + ms.train;
  const end = new Date(dataEnd).getTime();
  while (testStart + ms.test <= end) {
    const testEnd = testStart + ms.test;
    const trainStart = testStart - ms.train;
    windows.push({
      id: windows.length + 1,
      trainStart: new Date(trainStart).toISOString().slice(0, 10),
      trainEnd: new Date(testStart - 1).toISOString().slice(0, 10),
      testStart: new Date(testStart).toISOString().slice(0, 10),
      testEnd: new Date(testEnd - 1).toISOString().slice(0, 10),
      _trainStartTs: trainStart,
      _trainEndTs: testStart - 1,
      _testStartTs: testStart,
      _testEndTs: testEnd - 1,
    });
    testStart += ms.step;
  }
  return windows;
}

// ── DATA FETCHING ─────────────────────────────────────────────────
async function fetchFundingRates(exchange, symbol, since, until) {
  const all = [];
  let cursor = since;
  process.stdout.write('  📥 Funding BTC...');
  while (cursor < until) {
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
  const filtered = unique.filter(r => r.timestamp >= since && r.timestamp <= until);
  console.log(` ${filtered.length} records ✅`);
  return filtered;
}

async function fetchCandles(exchange, symbol, since, until) {
  const all = [];
  let cursor = since;
  process.stdout.write('  📥 Candles BTC...');
  while (cursor < until) {
    try {
      const c = await exchange.fetchOHLCV(symbol, '1h', cursor, 1000);
      if (!c || !c.length) break;
      all.push(...c);
      cursor = c[c.length - 1][0] + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) {
      cursor += 3600 * 1000;
      await new Promise(r => setTimeout(r, exchange.rateLimit * 3));
    }
  }
  const seen = new Set(), unique = [];
  for (const c of all) {
    if (!seen.has(c[0])) {
      seen.add(c[0]);
      unique.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4] });
    }
  }
  const filtered = unique.filter(c => c.timestamp >= since && c.timestamp <= until);
  console.log(` ${filtered.length} candles ✅`);
  return filtered;
}

// ── PERCENTILE ────────────────────────────────────────────────────
function percentile(arr, p) {
  const sorted = [...arr].filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(p / 100 * sorted.length), sorted.length - 1)];
}

// ── FIND CANDLE INDEX ─────────────────────────────────────────────
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

// ── SINGLE-ASSET TRACKER (NO CONCURRENT LIMIT) ────────────────────
class BTCTracker {
  constructor(capital) {
    this.capital = capital;
    this.startingCapital = capital;
    this.inPosition = false;
    this.currentPos = null;
    this.trades = [];
    this.peak = capital;
    this.maxDD = 0;
    this.consecutiveLosses = 0;
    this.maxConsecutiveLosses = 0;
  }

  open(signal) {
    if (this.inPosition) return false;

    const entryPrice = signal.entryPrice;
    const riskAmount = this.capital * CONFIG.riskPerTrade;
    const positionValue = riskAmount / CONFIG.worstMAE;
    const size = positionValue / entryPrice;
    if (size <= 0) return false;

    const entryFee = size * entryPrice * CONFIG.takerFee;
    this.capital -= entryFee;

    this.currentPos = {
      signalType: signal.signalType,
      side: 'long',
      size,
      entryPrice,
      entryTime: signal.entryTimestamp,
      entryIdx: signal.entryIdx,
      entryFee,
      fundingRate: signal.fundingRate,
      fundingTimestamp: signal.fundingTimestamp,
    };
    this.inPosition = true;
    return true;
  }

  checkExit(currentTimestamp, candles) {
    if (!this.inPosition || !this.currentPos) return;

    const elapsed = currentTimestamp - this.currentPos.entryTime;
    const holdMs = CONFIG.holdHours * 3600000;

    if (elapsed >= holdMs) {
      let exitPrice = this.currentPos.entryPrice;
      const exitIdx = this.currentPos.entryIdx + CONFIG.holdHours;
      if (exitIdx < candles.length) exitPrice = candles[exitIdx].close;
      else exitPrice = candles[candles.length - 1].close;

      this._close(exitPrice, currentTimestamp);
    }
  }

  forceClose(candles) {
    if (!this.inPosition || !this.currentPos) return;
    const exitPrice = candles ? candles[candles.length - 1].close : this.currentPos.entryPrice;
    this._close(exitPrice, Date.now());
  }

  _close(exitPrice, exitTime) {
    const pos = this.currentPos;
    const exitFee = pos.size * exitPrice * CONFIG.takerFee;
    const pnl = (exitPrice - pos.entryPrice) * pos.size - pos.entryFee - exitFee;

    this.capital += pnl;
    if (this.capital > this.peak) this.peak = this.capital;
    const dd = (this.peak - this.capital) / this.peak;
    if (dd > this.maxDD) this.maxDD = dd;

    if (pnl < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses > this.maxConsecutiveLosses) this.maxConsecutiveLosses = this.consecutiveLosses;
    } else {
      this.consecutiveLosses = 0;
    }

    this.trades.push({
      label: 'BTC',
      signalType: pos.signalType,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice,
      size: pos.size,
      entryTime: pos.entryTime,
      exitTime,
      holdHours: CONFIG.holdHours,
      pnl,
      pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
      grossReturn: (exitPrice - pos.entryPrice) / pos.entryPrice,
      netReturn: pnl / (pos.size * pos.entryPrice),
      totalFees: pos.entryFee + exitFee,
      fundingRate: pos.fundingRate,
    });

    this.inPosition = false;
    this.currentPos = null;
  }
}

// ── WINDOW STATS ──────────────────────────────────────────────────
function computeStats(trades, startingCapital) {
  if (trades.length === 0) {
    return { trades: 0, pf: NaN, wr: 0, maxDD: 0, netReturn: 0, netReturnPct: 0, avgTrade: 0, stdDev: 0, grossProfit: 0, grossLoss: 0, avgWin: 0, avgLoss: 0 };
  }
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const netReturn = trades.reduce((s, t) => s + t.pnl, 0);
  const returns = trades.map(t => t.netReturn);
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length);

  let peak = startingCapital, maxDD = 0, eq = startingCapital;
  for (const t of trades) { eq += t.pnl; if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; }

  return {
    trades: trades.length, pf: isFinite(pf) ? pf : 99.99,
    wr: wins.length / trades.length * 100, maxDD: maxDD * 100,
    netReturn, netReturnPct: netReturn / startingCapital * 100,
    avgTrade: netReturn / trades.length, stdDev,
    grossProfit, grossLoss,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
  };
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔬 BTC-ONLY WALK-FORWARD — EDGE ISOLATION                      ║
║  Train: 12mo | Test: 3mo | Step: 3mo | No overlap              ║
║  BTC ONLY — No ETH, No XRP, No slot competition                ║
║  Entry: funding extremes | Exit: 48h time | No stops            ║
║  Capital: $${CONFIG.startingCapital} | Risk: 1% per trade                          ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const DATA_START = '2021-01-01T00:00:00Z';
  const DATA_END = '2026-04-01T00:00:00Z';

  // Generate windows
  const windows = generateWindows(DATA_START, DATA_END);
  console.log(`  📅 Generated ${windows.length} walk-forward windows:\n`);
  for (const w of windows) {
    console.log(`    W${w.id}: Train ${w.trainStart} → ${w.trainEnd} | Test ${w.testStart} → ${w.testEnd}`);
  }

  // Fetch BTC data once
  console.log(`\n  📥 Fetching BTC data (2021-01 to 2026-04)...\n`);
  const exchange = new ccxt.binance({ enableRateLimit: true });
  const funding = await fetchFundingRates(exchange, CONFIG.symbol, new Date(DATA_START).getTime(), new Date(DATA_END).getTime());
  const candles = await fetchCandles(exchange, CONFIG.symbol, new Date(DATA_START).getTime(), new Date(DATA_END).getTime());

  console.log(`\n  📊 Data: ${funding.length} funding records, ${candles.length} candles\n`);

  // ── Run each window ─────────────────────────────────────────────
  console.log(`${'═'.repeat(70)}`);
  console.log(`  🔄 RUNNING BTC-ONLY WALK-FORWARD`);
  console.log(`${'═'.repeat(70)}\n`);

  const windowResults = [];
  let rollingCapital = CONFIG.startingCapital;
  let oosEquity = [CONFIG.startingCapital];
  const allOosTrades = [];

  for (const w of windows) {
    console.log(`\n── Window ${w.id}: ${w.testStart} → ${w.testEnd} ──────────────────`);

    // Split: TRAIN
    const trainFunding = funding.filter(f => f.timestamp >= w._trainStartTs && f.timestamp <= w._trainEndTs);
    const trainCandles = candles.filter(c => c.timestamp >= w._trainStartTs && c.timestamp <= w._trainEndTs);

    // Split: TEST
    const testFunding = funding.filter(f => f.timestamp >= w._testStartTs && f.timestamp <= w._testEndTs);
    const testCandles = candles.filter(c => c.timestamp >= w._testStartTs && c.timestamp <= w._testEndTs);

    if (trainFunding.length < 50) {
      console.log(`  ⚠️ Insufficient train data (${trainFunding.length})`);
      continue;
    }
    if (testFunding.length < 10) {
      console.log(`  ⚠️ Insufficient test data (${testFunding.length})`);
      continue;
    }

    // Compute thresholds on TRAIN only
    const trainRates = trainFunding.map(f => f.fundingRate);
    const p10 = percentile(trainRates, CONFIG.extremeLowPct);
    const p95 = percentile(trainRates, CONFIG.extremeHighPct);
    const cumWindow = CONFIG.cumulativeWindow;
    const trainCumValues = [];
    for (let i = 0; i < trainRates.length; i++) {
      let sum = 0;
      for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) sum += trainRates[j];
      trainCumValues.push(sum);
    }
    const cumP90 = percentile(trainCumValues, CONFIG.cumulativeDrainPct);

    // Compute cumulative for TEST
    const testRates = testFunding.map(f => f.fundingRate);
    const testCumValues = [];
    for (let i = 0; i < testRates.length; i++) {
      let sum = 0;
      for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) sum += testRates[j];
      testCumValues.push(sum);
    }

    // Detect signals on TEST data using TRAIN thresholds
    const signals = [];
    for (let i = 0; i < testFunding.length; i++) {
      const fr = testFunding[i];
      let signalType = null;
      if (CONFIG.signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) signalType = 'extremeLow_p10';
      else if (CONFIG.signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) signalType = 'extremeHigh_p95';
      else if (CONFIG.signalTypes.includes('highCumDrain') && testCumValues[i] >= cumP90) signalType = 'highCumDrain';

      if (signalType) {
        const candleIdx = findCandleIndex(testCandles, fr.timestamp);
        if (candleIdx !== null && candleIdx + CONFIG.holdHours < testCandles.length) {
          signals.push({
            label: 'BTC', signalType,
            fundingRate: fr.fundingRate, fundingTimestamp: fr.timestamp,
            entryIdx: candleIdx, entryTimestamp: testCandles[candleIdx].timestamp,
            entryPrice: testCandles[candleIdx].close,
          });
        }
      }
    }

    // IN-SAMPLE stats
    const isTrades = [];
    for (let i = 0; i < trainFunding.length; i++) {
      const fr = trainFunding[i];
      let signalType = null;
      if (CONFIG.signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) signalType = 'extremeLow_p10';
      else if (CONFIG.signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) signalType = 'extremeHigh_p95';
      else if (CONFIG.signalTypes.includes('highCumDrain') && trainCumValues[i] >= cumP90) signalType = 'highCumDrain';

      if (signalType) {
        const candleIdx = findCandleIndex(trainCandles, fr.timestamp);
        if (candleIdx !== null && candleIdx + CONFIG.holdHours < trainCandles.length) {
          const entryPrice = trainCandles[candleIdx].close;
          const exitPrice = trainCandles[candleIdx + CONFIG.holdHours].close;
          const grossReturn = (exitPrice - entryPrice) / entryPrice;
          const netReturn = grossReturn - CONFIG.roundTripFee;
          isTrades.push({ pnl: netReturn * entryPrice, netReturn });
        }
      }
    }

    signals.sort((a, b) => a.entryTimestamp - b.entryTimestamp);

    // Execute trades (single asset, no concurrent limit)
    const tracker = new BTCTracker(rollingCapital);
    for (const signal of signals) {
      tracker.checkExit(signal.entryTimestamp, testCandles);
      tracker.open(signal);
    }
    tracker.forceClose(testCandles);

    const oosStats = computeStats(tracker.trades, rollingCapital);
    const isStats = computeStats(isTrades, rollingCapital);

    // Update equity
    for (const t of tracker.trades) {
      oosEquity.push(oosEquity[oosEquity.length - 1] + t.pnl);
    }
    allOosTrades.push(...tracker.trades);
    rollingCapital = tracker.capital;

    windowResults.push({
      window: w.id,
      trainPeriod: `${w.trainStart} → ${w.trainEnd}`,
      testPeriod: `${w.testStart} → ${w.testEnd}`,
      oos: oosStats,
      is: isStats,
      thresholds: { p10, p95, cumP90, trainN: trainFunding.length, testN: testFunding.length },
      capital: tracker.capital,
    });

    console.log(`  OOS: ${oosStats.trades} trades | PF=${isFinite(oosStats.pf) ? oosStats.pf.toFixed(2) : '∞'} | WR=${oosStats.wr.toFixed(1)}% | DD=${oosStats.maxDD.toFixed(2)}% | PnL=$${oosStats.netReturn.toFixed(2)} (${oosStats.netReturnPct.toFixed(2)}%)`);
    console.log(`  IS:  ${isStats.trades} signals | PF=${isFinite(isStats.pf) ? isStats.pf.toFixed(2) : 'N/A'} | WR=${isStats.wr.toFixed(1)}%`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // AGGREGATE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  📊 BTC-ONLY AGGREGATE RESULTS`);
  console.log(`${'═'.repeat(70)}\n`);

  const oosStats = windowResults.map(wr => wr.oos).filter(s => s.trades > 0);
  const pfs = oosStats.map(s => s.pf).filter(pf => isFinite(pf));
  const wrs = oosStats.map(s => s.wr);
  const returns = oosStats.map(s => s.netReturnPct);

  const meanPF = pfs.reduce((s, x) => s + x, 0) / pfs.length;
  const sortedPF = [...pfs].sort((a, b) => a - b);
  const medianPF = sortedPF[Math.floor(sortedPF.length / 2)];
  const pfStdDev = Math.sqrt(pfs.reduce((s, x) => s + (x - meanPF) ** 2, 0) / pfs.length);
  const minPF = sortedPF[0];
  const maxPF = sortedPF[sortedPF.length - 1];
  const windowsAbove1 = pfs.filter(pf => pf > 1.0).length;
  const profitableWindows = returns.filter(r => r > 0).length;
  const profitableWindowsPct = (profitableWindows / returns.length * 100);
  const windowsAbove1Pct = (windowsAbove1 / pfs.length * 100);

  let maxConsecLoss = 0, currentConsecLoss = 0;
  for (const r of returns) {
    if (r <= 0) { currentConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, currentConsecLoss); }
    else currentConsecLoss = 0;
  }

  // IS vs OOS
  const isPFs = windowResults.map(wr => wr.is.pf).filter(pf => isFinite(pf) && pf > 0);
  const meanISPF = isPFs.length ? isPFs.reduce((s, x) => s + x, 0) / isPFs.length : NaN;
  const degradation = !isNaN(meanISPF) && meanISPF > 0 ? (1 - meanPF / meanISPF) * 100 : NaN;

  const totalOosStats = computeStats(allOosTrades, CONFIG.startingCapital);

  // ── Per-Window Table ────────────────────────────────────────────
  console.log(`  1. PER-WINDOW OOS METRICS`);
  console.log(`  ${'─'.repeat(80)}`);
  console.log(`  ${'W'.padStart(2)} | ${'Test Period'.padEnd(22)} | ${'Trades'.padStart(6)} | ${'PF'.padStart(6)} | ${'WR'.padStart(6)} | ${'DD%'.padStart(6)} | ${'Ret%'.padStart(7)} | ${'Catastrophic'.padStart(13)}`);
  console.log(`  ${'─'.repeat(80)}`);

  for (const wr of windowResults) {
    const s = wr.oos;
    const pfStr = isFinite(s.pf) ? s.pf.toFixed(2) : '  ∞';
    const catastrophic = isFinite(s.pf) && s.pf < 0.6 ? '💀 YES' : '';
    console.log(`  ${String(wr.window).padStart(2)} | ${wr.testPeriod.padEnd(22)} | ${String(s.trades).padStart(6)} | ${pfStr.padStart(6)} | ${s.wr.toFixed(1).padStart(5)}% | ${s.maxDD.toFixed(2).padStart(5)}% | ${s.netReturnPct.toFixed(2).padStart(6)}% | ${catastrophic}`);
  }

  // ── Aggregate Stats ─────────────────────────────────────────────
  console.log(`\n  2. AGGREGATE STATISTICS`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Mean PF:              ${meanPF.toFixed(3)}`);
  console.log(`  Median PF:            ${medianPF.toFixed(3)}`);
  console.log(`  PF Std Dev:           ${pfStdDev.toFixed(3)}`);
  console.log(`  Min PF:               ${minPF.toFixed(3)}`);
  console.log(`  Max PF:               ${maxPF.toFixed(3)}`);
  console.log(`  % windows PF > 1:     ${windowsAbove1Pct.toFixed(1)}% (${windowsAbove1}/${pfs.length})`);
  console.log(`  % profitable windows: ${profitableWindowsPct.toFixed(1)}% (${profitableWindows}/${returns.length})`);
  console.log(`  Max consec losses:    ${maxConsecLoss} windows`);
  console.log(`  Mean WR:              ${(wrs.reduce((s, x) => s + x, 0) / wrs.length).toFixed(1)}%`);
  console.log(`  Mean IS PF:           ${isNaN(meanISPF) ? 'N/A' : meanISPF.toFixed(3)}`);
  console.log(`  IS→OOS degradation:   ${isNaN(degradation) ? 'N/A' : degradation.toFixed(1)}%`);

  console.log(`\n  3. OOS EQUITY CURVE`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Start:    $${CONFIG.startingCapital.toFixed(2)}`);
  console.log(`  End:      $${oosEquity[oosEquity.length - 1].toFixed(2)}`);
  console.log(`  Return:   ${((oosEquity[oosEquity.length - 1] / CONFIG.startingCapital - 1) * 100).toFixed(2)}%`);
  console.log(`  Trades:   ${allOosTrades.length}`);

  // Catastrophic windows
  const catastrophicWindows = windowResults.filter(wr => isFinite(wr.oos.pf) && wr.oos.pf < 0.6);
  console.log(`\n  4. CATASTROPHIC WINDOWS (PF < 0.6)`);
  if (catastrophicWindows.length === 0) {
    console.log(`  None ✅`);
  } else {
    for (const cw of catastrophicWindows) {
      console.log(`  💀 W${cw.window}: PF ${cw.oos.pf.toFixed(2)} | ${cw.testPeriod} | DD ${cw.oos.maxDD.toFixed(2)}%`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVALUATION — STRICT PASS CRITERIA
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🧪 STRICT EVALUATION`);
  console.log(`${'═'.repeat(70)}\n`);

  const passConditions = [
    { name: 'Mean PF > 1.3', pass: meanPF > 1.3, value: meanPF.toFixed(3), threshold: '> 1.3' },
    { name: '≥ 70% profitable windows', pass: profitableWindowsPct >= 70, value: `${profitableWindowsPct.toFixed(1)}%`, threshold: '≥ 70%' },
    { name: 'No catastrophic windows (PF < 0.6)', pass: catastrophicWindows.length === 0, value: `${catastrophicWindows.length}`, threshold: '0' },
    { name: 'Stable distribution (std dev)', pass: pfStdDev < 0.5, value: pfStdDev.toFixed(3), threshold: '< 0.5' },
    { name: 'No long dead zones (consec < 4)', pass: maxConsecLoss < 4, value: `${maxConsecLoss}`, threshold: '< 4' },
  ];

  const failConditions = [
    { name: 'PF collapses near 1.0', fail: meanPF <= 1.05, value: meanPF.toFixed(3) },
    { name: 'Performance concentrated (< 50% win windows)', fail: windowsAbove1Pct < 50, value: `${windowsAbove1Pct.toFixed(1)}%` },
    { name: 'Large DDs without recovery', fail: maxConsecLoss >= 4, value: `${maxConsecLoss}` },
    { name: 'Equity flat/declining', fail: oosEquity[oosEquity.length - 1] <= CONFIG.startingCapital, value: `$${oosEquity[oosEquity.length - 1].toFixed(2)}` },
  ];

  let passCount = 0;
  console.log(`  PASS CONDITIONS:`);
  for (const c of passConditions) {
    const status = c.pass ? '✅ PASS' : '❌ FAIL';
    if (c.pass) passCount++;
    console.log(`    ${status} — ${c.name}: ${c.value} (need ${c.threshold})`);
  }

  let failCount = 0;
  console.log(`\n  FAILURE CONDITIONS:`);
  for (const c of failConditions) {
    const status = c.fail ? '❌ FAIL' : '✅ OK';
    if (c.fail) failCount++;
    console.log(`    ${status} — ${c.name}: ${c.value}`);
  }

  // ── CRITICAL ANALYSIS ───────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🧠 CRITICAL ANALYSIS`);
  console.log(`${'═'.repeat(70)}\n`);

  // Compare to multi-asset BTC results
  console.log(`  1. Multi-asset vs Isolated BTC:`);
  console.log(`     Multi-asset BTC: PF 1.26, 327 trades, 51.1% WR`);
  console.log(`     Isolated BTC:    PF ${meanPF.toFixed(2)}, ${allOosTrades.length} trades, ${totalOosStats.wr.toFixed(1)}% WR`);
  const improved = meanPF > 1.26;
  console.log(`     PF change: ${improved ? '🟢 IMPROVED' : meanPF < 1.2 ? '🔴 DEGRADED' : '🟡 SIMILAR'} (${(meanPF - 1.26).toFixed(3)})`);

  console.log(`\n  2. Terra/Luna window analysis:`);
  // W2 was Apr-Jul 2022 in multi-asset
  const terraWindow = windowResults.find(wr => wr.testPeriod.includes('2022-04') || wr.testPeriod.includes('2022-05') || wr.testPeriod.includes('2022-07'));
  if (terraWindow) {
    console.log(`     W${terraWindow.window} (${terraWindow.testPeriod}): PF ${isFinite(terraWindow.oos.pf) ? terraWindow.oos.pf.toFixed(2) : '∞'}, DD ${terraWindow.oos.maxDD.toFixed(2)}%`);
    console.log(`     ${terraWindow.oos.pf < 0.6 ? '💀 STILL CATASTROPHIC' : terraWindow.oos.pf < 1.0 ? '⚠️ WEAK' : '✅ SURVIVES'}`);
  } else {
    console.log(`     No direct Terra/Luna window in test range`);
  }

  console.log(`\n  3. Edge consistency across time:`);
  const windowPFs = windowResults.map(wr => ({ w: wr.window, pf: wr.oos.pf, period: wr.testPeriod }));
  const earlyHalf = windowPFs.slice(0, Math.floor(windowPFs.length / 2));
  const lateHalf = windowPFs.slice(Math.floor(windowPFs.length / 2));
  const earlyPF = earlyHalf.filter(w => isFinite(w.pf)).reduce((s, w) => s + w.pf, 0) / earlyHalf.filter(w => isFinite(w.pf)).length;
  const latePF = lateHalf.filter(w => isFinite(w.pf)).reduce((s, w) => s + w.pf, 0) / lateHalf.filter(w => isFinite(w.pf)).length;
  console.log(`     Early windows mean PF: ${isNaN(earlyPF) ? 'N/A' : earlyPF.toFixed(3)}`);
  console.log(`     Late windows mean PF:  ${isNaN(latePF) ? 'N/A' : latePF.toFixed(3)}`);
  console.log(`     ${!isNaN(earlyPF) && !isNaN(latePF) && Math.abs(earlyPF - latePF) < 0.3 ? '✅ STABLE' : '⚠️ DRIFTING'}`);

  // ── FINAL CLASSIFICATION ────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🏛️ FINAL CLASSIFICATION`);
  console.log(`${'═'.repeat(70)}\n`);

  let classification;
  if (failCount > 0) {
    classification = '🔴 NO EDGE';
    console.log(`  ${classification}`);
    console.log(`\n  BTC fails independently. The entire project is invalid.`);
    console.log(`  No further research is justified.`);
  } else if (passCount === passConditions.length) {
    classification = '🟢 ISOLATED EDGE CONFIRMED';
    console.log(`  ${classification}`);
    console.log(`\n  BTC alone is robust and deployable.`);
    console.log(`  Edge is consistent, stable, and survives isolation.`);
  } else if (passCount >= 3 && meanPF > 1.2) {
    classification = '🟡 WEAK EDGE';
    console.log(`  ${classification}`);
    console.log(`\n  BTC has edge but still shows fragility.`);
    console.log(`  Passes: ${passCount}/${passConditions.length} | Mean PF: ${meanPF.toFixed(3)}`);
    console.log(`  Catastrophic windows prevent production deployment.`);
    console.log(`  Edge exists but is not yet deployable.`);
  } else {
    classification = '🔴 NO EDGE';
    console.log(`  ${classification}`);
    console.log(`\n  Insufficient evidence of standalone BTC edge.`);
  }

  // ── WRITE REPORT ────────────────────────────────────────────────
  let report = `# 🔬 BTC-ONLY WALK-FORWARD REPORT — EDGE ISOLATION\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Method:** Rolling 12-month train / 3-month test / 3-month step\n`;
  report += `**Asset:** BTC ONLY (no ETH, no XRP, no slot competition)\n`;
  report += `**Entry:** Funding extremes (p10/p95/cumulative drain) — IDENTICAL to original\n`;
  report += `**Exit:** Fixed 48h time exit, no stops — IDENTICAL to original\n`;
  report += `**Risk:** 1% per trade, no concurrent limit — single asset\n`;
  report += `**Classification:** ${classification}\n\n---\n\n`;

  report += `## 1. Per-Window OOS Metrics\n\n`;
  report += `| Window | Test Period | Trades | PF | WR | DD% | Return% | Catastrophic |\n`;
  report += `|--------|-------------|--------|-----|-----|-----|---------|-------------|\n`;
  for (const wr of windowResults) {
    const s = wr.oos;
    const pfStr = isFinite(s.pf) ? s.pf.toFixed(2) : '∞';
    const cat = isFinite(s.pf) && s.pf < 0.6 ? '💀' : '';
    report += `| ${wr.window} | ${wr.testPeriod} | ${s.trades} | ${pfStr} | ${s.wr.toFixed(1)}% | ${s.maxDD.toFixed(2)}% | ${s.netReturnPct.toFixed(2)}% | ${cat} |\n`;
  }
  report += `\n`;

  report += `## 2. Aggregate Statistics\n\n`;
  report += `| Metric | Value | Threshold | Status |\n`;
  report += `|--------|-------|-----------|--------|\n`;
  report += `| Mean PF | ${meanPF.toFixed(3)} | > 1.3 | ${meanPF > 1.3 ? '✅' : '❌'} |\n`;
  report += `| Median PF | ${medianPF.toFixed(3)} | — | — |\n`;
  report += `| PF Std Dev | ${pfStdDev.toFixed(3)} | < 0.5 | ${pfStdDev < 0.5 ? '✅' : '❌'} |\n`;
  report += `| Min PF | ${minPF.toFixed(3)} | > 0.6 | ${minPF > 0.6 ? '✅' : '❌'} |\n`;
  report += `| % Profitable Windows | ${profitableWindowsPct.toFixed(1)}% | ≥ 70% | ${profitableWindowsPct >= 70 ? '✅' : '❌'} |\n`;
  report += `| Max Consec Losses | ${maxConsecLoss} | < 4 | ${maxConsecLoss < 4 ? '✅' : '❌'} |\n`;
  report += `| Catastrophic Windows | ${catastrophicWindows.length} | 0 | ${catastrophicWindows.length === 0 ? '✅' : '❌'} |\n`;
  report += `| IS→OOS Degradation | ${isNaN(degradation) ? 'N/A' : degradation.toFixed(1)}% | — | — |\n`;
  report += `\n`;

  report += `## 3. OOS Equity Curve\n\n`;
  report += `| Point | Equity |\n`;
  report += `|-------|--------|\n`;
  report += `| Start | $${CONFIG.startingCapital.toFixed(2)} |\n`;
  for (let i = 0; i < oosEquity.length; i += Math.max(1, Math.floor(oosEquity.length / 20))) {
    report += `| ${i} | $${oosEquity[i].toFixed(2)} |\n`;
  }
  report += `| End | $${oosEquity[oosEquity.length - 1].toFixed(2)} |\n`;
  report += `\n**Total OOS return:** ${((oosEquity[oosEquity.length - 1] / CONFIG.startingCapital - 1) * 100).toFixed(2)}%\n`;
  report += `**Total OOS trades:** ${allOosTrades.length}\n\n`;

  report += `## 4. Comparison: Multi-Asset BTC vs Isolated BTC\n\n`;
  report += `| Metric | Multi-Asset BTC | Isolated BTC | Delta |\n`;
  report += `|--------|-----------------|--------------|-------|\n`;
  report += `| PF | 1.26 | ${meanPF.toFixed(3)} | ${(meanPF - 1.26).toFixed(3)} |\n`;
  report += `| Trades | 327 | ${allOosTrades.length} | ${allOosTrades.length - 327} |\n`;
  report += `| WR | 51.1% | ${totalOosStats.wr.toFixed(1)}% | ${(totalOosStats.wr - 51.1).toFixed(1)}% |\n`;
  report += `\n`;

  report += `## 5. Critical Analysis\n\n`;

  report += `### Q1: Did removing ETH/XRP improve performance stability?\n`;
  report += `**${improved ? 'YES' : 'NO'}** — Isolated PF ${meanPF.toFixed(3)} vs Multi-asset PF 1.26 (${improved ? '+' : ''}${(meanPF - 1.26).toFixed(3)})\n\n`;

  report += `### Q2: Is BTC edge consistent across time or still regime-fragile?\n`;
  report += `Early windows PF: ${isNaN(earlyPF) ? 'N/A' : earlyPF.toFixed(3)} | Late windows PF: ${isNaN(latePF) ? 'N/A' : latePF.toFixed(3)}\n`;
  report += `${!isNaN(earlyPF) && !isNaN(latePF) && Math.abs(earlyPF - latePF) < 0.3 ? 'Stable across time.' : 'Shows temporal drift.'}\n\n`;

  report += `### Q3: Does the Terra/Luna window still break the system?\n`;
  if (terraWindow) {
    report += `W${terraWindow.window} (${terraWindow.testPeriod}): PF ${isFinite(terraWindow.oos.pf) ? terraWindow.oos.pf.toFixed(2) : '∞'}\n`;
    report += `${terraWindow.oos.pf < 0.6 ? 'YES — still catastrophic.' : terraWindow.oos.pf < 1.0 ? 'Weak but survived.' : 'NO — survives in isolation.'}\n\n`;
  } else {
    report += `No direct Terra/Luna window found in test periods.\n\n`;
  }

  report += `### Q4: Is the edge strong enough to justify capital?\n`;
  report += `Mean PF ${meanPF.toFixed(3)} with ${profitableWindowsPct.toFixed(1)}% profitable windows. `;
  report += `${meanPF >= 1.3 && profitableWindowsPct >= 70 ? 'Sufficient for deployment consideration.' : 'Marginal — requires further scrutiny.'}\n\n`;

  report += `## 6. Final Classification\n\n`;
  report += `### ${classification}\n\n`;
  if (classification.includes('CONFIRMED')) {
    report += `BTC alone demonstrates a robust, consistent funding rate edge that survives walk-forward validation with no ETH/XRP dependency. The edge is deployable under the validated parameters.\n`;
  } else if (classification.includes('WEAK')) {
    report += `BTC shows some standalone edge but with residual fragility. Not immediately deployable without further stabilization.\n`;
  } else {
    report += `BTC fails to demonstrate a standalone edge. The multi-asset results were masking BTC's true (lack of) performance. The entire project is invalid.\n`;
  }

  report += `\n---\n*Pure validation. No parameters modified. No improvements attempted.*\n`;

  // Write files
  const outDir = path.join(__dirname);
  fs.writeFileSync(path.join(outDir, 'BTC_WALK_FORWARD_REPORT.md'), report);
  console.log(`\n  ✅ Report: validation/BTC_WALK_FORWARD_REPORT.md`);
  fs.writeFileSync(path.join(outDir, 'btc-wf-equity.json'), JSON.stringify(oosEquity));
  console.log(`  ✅ Equity: validation/btc-wf-equity.json`);
  fs.writeFileSync(path.join(outDir, 'btc-wf-trades.jsonl'), allOosTrades.map(t => JSON.stringify(t)).join('\n'));
  console.log(`  ✅ Trades: validation/btc-wf-trades.jsonl`);
  fs.writeFileSync(path.join(outDir, 'btc-wf-windows.json'), JSON.stringify(windowResults, null, 2));
  console.log(`  ✅ Windows: validation/btc-wf-windows.json`);

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
