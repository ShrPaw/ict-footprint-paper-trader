// ═══════════════════════════════════════════════════════════════════
// Walk-Forward Validation Engine
// ═══════════════════════════════════════════════════════════════════
// Rolling 12-month train / 3-month test / 3-month step
// Thresholds recomputed per train window ONLY
// No lookahead, no leakage, no parameter changes
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── LOCKED SYSTEM PARAMETERS ──────────────────────────────────────
const ASSETS = [
  { label: 'BTC', symbol: 'BTC/USDT:USDT' },
  { label: 'ETH', symbol: 'ETH/USDT:USDT' },
  { label: 'XRP', symbol: 'XRP/USDT:USDT' },
];

const CONFIG = {
  extremeLowPct: 10,
  extremeHighPct: 95,
  cumulativeDrainPct: 90,
  cumulativeWindow: 10,
  holdHours: 48,
  riskPerTrade: 0.01,
  maxConcurrent: 3,
  takerFee: 0.0005,
  roundTripFee: 0.0014,
  startingCapital: 10000,
  // Per-asset worst MAE (locked from research)
  assetRisk: {
    BTC: { worstMAE: 0.127 },
    ETH: { worstMAE: 0.206 },
    XRP: { worstMAE: 0.240 },
  },
  // Signal types per asset (locked)
  signalTypes: {
    BTC: ['extremeLow_p10', 'extremeHigh_p95', 'highCumDrain'],
    ETH: ['highCumDrain', 'extremeLow_p10'],
    XRP: ['highCumDrain', 'extremeLow_p10'],
  },
};

// ── WALK-FORWARD WINDOWS ──────────────────────────────────────────
// Train: 12 months, Test: 3 months, Step: 3 months
function generateWindows(dataStart, dataEnd) {
  const windows = [];
  const ms = {
    train: 365.25 * 24 * 3600 * 1000,     // ~12 months
    test: 91.3125 * 24 * 3600 * 1000,      // ~3 months
    step: 91.3125 * 24 * 3600 * 1000,      // ~3 months
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

async function fetchFundingRates(exchange, symbol, since, until, label) {
  const all = [];
  let cursor = since;
  process.stdout.write(`  📥 Funding ${label}...`);
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

async function fetchCandles(exchange, symbol, since, until, label) {
  const all = [];
  let cursor = since;
  process.stdout.write(`  📥 Candles ${label}...`);
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

// ── THRESHOLD COMPUTATION (TRAIN ONLY) ────────────────────────────

function computeThresholds(fundingData, config) {
  const rates = fundingData.map(f => f.fundingRate);
  if (rates.length < 50) return null;

  const p10 = percentile(rates, config.extremeLowPct);
  const p95 = percentile(rates, config.extremeHighPct);

  // Cumulative drain
  const window = config.cumulativeWindow;
  const cumValues = [];
  for (let i = 0; i < rates.length; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) sum += rates[j];
    cumValues.push(sum);
  }
  const cumP90 = percentile(cumValues, config.cumulativeDrainPct);

  return { p10, p95, cumP90, cumValues };
}

// ── SIGNAL DETECTION (TEST DATA, TRAIN THRESHOLDS) ────────────────

function detectSignals(fundingData, candleData, thresholds, label, config) {
  if (!thresholds || !fundingData.length || !candleData.length) return [];

  const { p10, p95, cumP90, cumValues } = thresholds;
  const signalTypes = config.signalTypes[label] || [];
  const signals = [];

  for (let i = 0; i < fundingData.length; i++) {
    const fr = fundingData[i];
    let signalType = null;

    if (signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) {
      signalType = 'extremeLow_p10';
    } else if (signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) {
      signalType = 'extremeHigh_p95';
    } else if (signalTypes.includes('highCumDrain') && cumValues[i] >= cumP90) {
      signalType = 'highCumDrain';
    }

    if (signalType) {
      const candleIdx = findCandleIndex(candleData, fr.timestamp);
      if (candleIdx !== null && candleIdx + config.holdHours < candleData.length) {
        signals.push({
          label,
          signalType,
          fundingRate: fr.fundingRate,
          fundingTimestamp: fr.timestamp,
          entryIdx: candleIdx,
          entryTimestamp: candleData[candleIdx].timestamp,
          entryPrice: candleData[candleIdx].close,
        });
      }
    }
  }

  return signals;
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

// ── SIMPLE POSITION TRACKER ───────────────────────────────────────

class SimpleTracker {
  constructor(capital) {
    this.capital = capital;
    this.startingCapital = capital;
    this.positions = new Map();
    this.trades = [];
    this.peak = capital;
    this.maxDD = 0;
  }

  canOpen() {
    return this.positions.size < CONFIG.maxConcurrent;
  }

  open(signal) {
    const key = signal.label;
    if (this.positions.has(key)) return false;
    if (!this.canOpen()) return false;

    const entryPrice = signal.entryPrice;
    const worstMAE = CONFIG.assetRisk[key]?.worstMAE || 0.2;
    const riskAmount = this.capital * CONFIG.riskPerTrade;
    const positionValue = riskAmount / worstMAE;
    const size = positionValue / entryPrice;
    if (size <= 0) return false;

    const entryFee = size * entryPrice * CONFIG.takerFee;
    this.capital -= entryFee;

    this.positions.set(key, {
      label: key,
      signalType: signal.signalType,
      side: 'long',
      size,
      entryPrice,
      entryTime: signal.entryTimestamp,
      entryIdx: signal.entryIdx,
      entryFee,
      fundingRate: signal.fundingRate,
    });
    return true;
  }

  checkExits(currentTimestamp, candleData) {
    const holdMs = CONFIG.holdHours * 3600000;
    const exited = [];

    for (const [label, pos] of this.positions) {
      const elapsed = currentTimestamp - pos.entryTime;
      if (elapsed >= holdMs) {
        const candles = candleData.get(label);
        let exitPrice = pos.entryPrice;
        if (candles) {
          const exitIdx = pos.entryIdx + CONFIG.holdHours;
          if (exitIdx < candles.length) exitPrice = candles[exitIdx].close;
          else exitPrice = candles[candles.length - 1].close;
        }

        const exitFee = pos.size * exitPrice * CONFIG.takerFee;
        const pnl = (exitPrice - pos.entryPrice) * pos.size - pos.entryFee - exitFee;
        this.capital += pnl;

        if (this.capital > this.peak) this.peak = this.capital;
        const dd = (this.peak - this.capital) / this.peak;
        if (dd > this.maxDD) this.maxDD = dd;

        this.trades.push({
          label: pos.label,
          signalType: pos.signalType,
          side: pos.side,
          entryPrice: pos.entryPrice,
          exitPrice,
          size: pos.size,
          entryTime: pos.entryTime,
          exitTime: currentTimestamp,
          holdHours: CONFIG.holdHours,
          pnl,
          pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
          grossReturn: (exitPrice - pos.entryPrice) / pos.entryPrice,
          netReturn: pnl / (pos.size * pos.entryPrice),
          totalFees: pos.entryFee + exitFee,
        });

        exited.push(label);
      }
    }

    for (const label of exited) this.positions.delete(label);
  }

  forceCloseAll(candleData) {
    const now = Date.now();
    for (const [label, pos] of this.positions) {
      const candles = candleData.get(label);
      const exitPrice = candles ? candles[candles.length - 1].close : pos.entryPrice;
      const exitFee = pos.size * exitPrice * CONFIG.takerFee;
      const pnl = (exitPrice - pos.entryPrice) * pos.size - pos.entryFee - exitFee;
      this.capital += pnl;

      if (this.capital > this.peak) this.peak = this.capital;
      const dd = (this.peak - this.capital) / this.peak;
      if (dd > this.maxDD) this.maxDD = dd;

      this.trades.push({
        label: pos.label,
        signalType: pos.signalType,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice,
        size: pos.size,
        entryTime: pos.entryTime,
        exitTime: now,
        holdHours: CONFIG.holdHours,
        pnl,
        pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
        grossReturn: (exitPrice - pos.entryPrice) / pos.entryPrice,
        netReturn: pnl / (pos.size * pos.entryPrice),
        totalFees: pos.entryFee + exitFee,
      });
    }
    this.positions.clear();
  }
}

// ── WINDOW STATS ──────────────────────────────────────────────────

function computeWindowStats(trades, startingCapital) {
  if (trades.length === 0) {
    return {
      trades: 0, pf: NaN, wr: 0, maxDD: 0, netReturn: 0,
      avgTrade: 0, stdDev: 0, grossProfit: 0, grossLoss: 0,
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const netReturn = trades.reduce((s, t) => s + t.pnl, 0);
  const avgTrade = netReturn / trades.length;
  const returns = trades.map(t => t.netReturn);
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length);

  // Max DD within this window
  let peak = startingCapital, maxDD = 0, eq = startingCapital;
  for (const t of trades) {
    eq += t.pnl;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    trades: trades.length,
    pf: isFinite(pf) ? pf : 99.99,
    wr: (wins.length / trades.length * 100),
    maxDD: maxDD * 100,
    netReturn,
    netReturnPct: netReturn / startingCapital * 100,
    avgTrade,
    stdDev,
    grossProfit,
    grossLoss,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
  };
}

// ── MAIN WALK-FORWARD ─────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔬 WALK-FORWARD VALIDATION ENGINE                              ║
║  Train: 12mo | Test: 3mo | Step: 3mo | No overlap              ║
║  Entry: funding extremes | Exit: 48h time | No stops            ║
║  Capital: $${CONFIG.startingCapital} | Risk: 1% | Max 3 concurrent                      ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const DATA_START = '2021-01-01T00:00:00Z';  // Extra buffer for first train window
  const DATA_END = '2026-04-01T00:00:00Z';

  // Generate windows
  const windows = generateWindows(DATA_START, DATA_END);
  console.log(`  📅 Generated ${windows.length} walk-forward windows:\n`);
  for (const w of windows) {
    console.log(`    W${w.id}: Train ${w.trainStart} → ${w.trainEnd} | Test ${w.testStart} → ${w.testEnd}`);
  }

  // Fetch all data once
  console.log(`\n  📥 Fetching data (2021-01 to 2026-04)...\n`);
  const exchange = new ccxt.binance({ enableRateLimit: true });
  const allData = {};

  for (const asset of ASSETS) {
    console.log(`\n  ── ${asset.label} ──`);
    const funding = await fetchFundingRates(
      exchange, asset.symbol,
      new Date(DATA_START).getTime(),
      new Date(DATA_END).getTime(),
      asset.label
    );
    const candles = await fetchCandles(
      exchange, asset.symbol,
      new Date(DATA_START).getTime(),
      new Date(DATA_END).getTime(),
      asset.label
    );
    allData[asset.label] = { funding, candles };
  }

  // ── Run each window ─────────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🔄 RUNNING WALK-FORWARD VALIDATION`);
  console.log(`${'═'.repeat(70)}\n`);

  const windowResults = [];
  let oosEquity = [CONFIG.startingCapital];
  let oosTimestamps = [new Date(windows[0]._testStartTs).getTime()];
  let rollingCapital = CONFIG.startingCapital;
  const allOosTrades = [];

  for (const w of windows) {
    console.log(`\n── Window ${w.id}: ${w.testStart} → ${w.testEnd} ──────────────────`);

    const windowSignals = [];
    const windowCandleData = new Map();
    let inSampleTrades = [];

    for (const asset of ASSETS) {
      const { funding, candles } = allData[asset.label];

      // Split data: TRAIN only
      const trainFunding = funding.filter(f =>
        f.timestamp >= w._trainStartTs && f.timestamp <= w._trainEndTs
      );
      const trainCandles = candles.filter(c =>
        c.timestamp >= w._trainStartTs && c.timestamp <= w._trainEndTs
      );

      // Split data: TEST only
      const testFunding = funding.filter(f =>
        f.timestamp >= w._testStartTs && f.timestamp <= w._testEndTs
      );
      const testCandles = candles.filter(c =>
        c.timestamp >= w._testStartTs && c.timestamp <= w._testEndTs
      );

      // Store test candles for exit price lookup
      windowCandleData.set(asset.label, testCandles);

      // Compute thresholds on TRAIN data only
      // Need cumulative values for train data too
      const trainRates = trainFunding.map(f => f.fundingRate);
      if (trainRates.length < 50) {
        console.log(`  ⚠️ ${asset.label}: insufficient train data (${trainRates.length} records)`);
        continue;
      }

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

      const thresholds = { p10, p95, cumP90 };

      // Compute cumulative values for TEST data
      // CRITICAL: cumulative uses only test data context, not train
      const testRates = testFunding.map(f => f.fundingRate);
      const testCumValues = [];
      for (let i = 0; i < testRates.length; i++) {
        let sum = 0;
        for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) sum += testRates[j];
        testCumValues.push(sum);
      }

      // Detect signals on TEST data using TRAIN thresholds
      const signalTypes = CONFIG.signalTypes[asset.label] || [];
      let assetSignals = 0;

      for (let i = 0; i < testFunding.length; i++) {
        const fr = testFunding[i];
        let signalType = null;

        if (signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) {
          signalType = 'extremeLow_p10';
        } else if (signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) {
          signalType = 'extremeHigh_p95';
        } else if (signalTypes.includes('highCumDrain') && testCumValues[i] >= cumP90) {
          signalType = 'highCumDrain';
        }

        if (signalType) {
          const candleIdx = findCandleIndex(testCandles, fr.timestamp);
          if (candleIdx !== null && candleIdx + CONFIG.holdHours < testCandles.length) {
            windowSignals.push({
              label: asset.label,
              signalType,
              fundingRate: fr.fundingRate,
              fundingTimestamp: fr.timestamp,
              entryIdx: candleIdx,
              entryTimestamp: testCandles[candleIdx].timestamp,
              entryPrice: testCandles[candleIdx].close,
            });
            assetSignals++;
          }
        }
      }

      console.log(`  ${asset.label}: train=${trainFunding.length} test=${testFunding.length} signals=${assetSignals} | p10=${(p10 * 100).toFixed(5)}% p95=${(p95 * 100).toFixed(5)}% cumP90=${(cumP90 * 100).toFixed(5)}%`);

      // ── IN-SAMPLE validation (train period) ─────────────────────
      const trainCumForSignals = [];
      for (let i = 0; i < trainRates.length; i++) {
        let sum = 0;
        for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) sum += trainRates[j];
        trainCumForSignals.push(sum);
      }

      for (let i = 0; i < trainFunding.length; i++) {
        const fr = trainFunding[i];
        let signalType = null;
        if (signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) {
          signalType = 'extremeLow_p10';
        } else if (signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) {
          signalType = 'extremeHigh_p95';
        } else if (signalTypes.includes('highCumDrain') && trainCumForSignals[i] >= cumP90) {
          signalType = 'highCumDrain';
        }
        if (signalType) {
          const candleIdx = findCandleIndex(trainCandles, fr.timestamp);
          if (candleIdx !== null && candleIdx + CONFIG.holdHours < trainCandles.length) {
            const entryPrice = trainCandles[candleIdx].close;
            const exitPrice = trainCandles[candleIdx + CONFIG.holdHours].close;
            const grossReturn = (exitPrice - entryPrice) / entryPrice;
            const fees = CONFIG.roundTripFee;
            const netReturn = grossReturn - fees;
            inSampleTrades.push({ label: asset.label, netReturn, grossReturn, pnl: netReturn * entryPrice });
          }
        }
      }
    }

    // Sort signals chronologically
    windowSignals.sort((a, b) => a.entryTimestamp - b.entryTimestamp);

    // Execute trades
    const tracker = new SimpleTracker(rollingCapital);
    for (const signal of windowSignals) {
      // Check exits before opening new
      tracker.checkExits(signal.entryTimestamp, windowCandleData);
      tracker.open(signal);
    }
    // Close remaining at end of window
    tracker.forceCloseAll(windowCandleData);

    // Compute OOS stats
    const oosStats = computeWindowStats(tracker.trades, rollingCapital);
    const isStats = computeWindowStats(
      inSampleTrades.map(t => ({
        pnl: t.pnl,
        netReturn: t.netReturn,
      })),
      rollingCapital
    );

    // Update OOS equity
    for (const t of tracker.trades) {
      oosEquity.push(oosEquity[oosEquity.length - 1] + t.pnl);
      oosTimestamps.push(t.exitTime);
    }
    allOosTrades.push(...tracker.trades);
    rollingCapital = tracker.capital;

    const result = {
      window: w.id,
      trainPeriod: `${w.trainStart} → ${w.trainEnd}`,
      testPeriod: `${w.testStart} → ${w.testEnd}`,
      oos: oosStats,
      is: isStats,
      thresholdDetails: {},
      capital: tracker.capital,
    };

    // Store thresholds per asset for this window
    for (const asset of ASSETS) {
      const { funding } = allData[asset.label];
      const trainFunding = funding.filter(f =>
        f.timestamp >= w._trainStartTs && f.timestamp <= w._trainEndTs
      );
      const trainRates = trainFunding.map(f => f.fundingRate);
      if (trainRates.length >= 50) {
        result.thresholdDetails[asset.label] = {
          p10: percentile(trainRates, CONFIG.extremeLowPct),
          p95: percentile(trainRates, CONFIG.extremeHighPct),
          trainN: trainFunding.length,
        };
      }
    }

    windowResults.push(result);

    console.log(`  OOS: ${oosStats.trades} trades | PF=${isFinite(oosStats.pf) ? oosStats.pf.toFixed(2) : '∞'} | WR=${oosStats.wr.toFixed(1)}% | DD=${oosStats.maxDD.toFixed(2)}% | PnL=$${oosStats.netReturn.toFixed(2)} (${oosStats.netReturnPct.toFixed(2)}%)`);
    console.log(`  IS:  ${isStats.trades.length || 0} signals | PF=${isFinite(isStats.pf) ? isStats.pf.toFixed(2) : 'N/A'} | WR=${isStats.wr.toFixed(1)}%`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // AGGREGATE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════

  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  📊 AGGREGATE WALK-FORWARD RESULTS`);
  console.log(`${'═'.repeat(70)}\n`);

  const oosWindowStats = windowResults.map(wr => wr.oos).filter(s => s.trades > 0);
  const pfs = oosWindowStats.map(s => s.pf).filter(pf => isFinite(pf));
  const wrs = oosWindowStats.map(s => s.wr);
  const returns = oosWindowStats.map(s => s.netReturnPct);

  const meanPF = pfs.reduce((s, x) => s + x, 0) / pfs.length;
  const sortedPF = [...pfs].sort((a, b) => a - b);
  const medianPF = sortedPF[Math.floor(sortedPF.length / 2)];
  const pfStdDev = Math.sqrt(pfs.reduce((s, x) => s + (x - meanPF) ** 2, 0) / pfs.length);
  const windowsAbove1 = pfs.filter(pf => pf > 1.0).length;
  const windowsAbove1Pct = (windowsAbove1 / pfs.length * 100);
  const profitableWindows = returns.filter(r => r > 0).length;
  const profitableWindowsPct = (profitableWindows / returns.length * 100);

  // Consecutive losing windows
  let maxConsecLoss = 0, currentConsecLoss = 0;
  for (const r of returns) {
    if (r <= 0) { currentConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, currentConsecLoss); }
    else { currentConsecLoss = 0; }
  }

  // Mean WR
  const meanWR = wrs.reduce((s, x) => s + x, 0) / wrs.length;

  // Total OOS stats
  const totalOosStats = computeWindowStats(allOosTrades, CONFIG.startingCapital);

  // IS vs OOS comparison
  const isTradesAll = windowResults.flatMap(wr => {
    const isStats = wr.is;
    return isStats.trades > 0 ? [isStats] : [];
  });
  const isPFs = isTradesAll.map(s => s.pf).filter(pf => isFinite(pf));
  const meanISPF = isPFs.length ? isPFs.reduce((s, x) => s + x, 0) / isPFs.length : NaN;

  // ── Print Results ───────────────────────────────────────────────

  console.log(`  1. PER-WINDOW METRICS TABLE`);
  console.log(`  ${'─'.repeat(68)}`);
  console.log(`  ${'W'.padStart(2)} | ${'Test Period'.padEnd(22)} | ${'Trades'.padStart(6)} | ${'PF'.padStart(6)} | ${'WR'.padStart(6)} | ${'DD%'.padStart(6)} | ${'Ret%'.padStart(7)} | ${'Avg'.padStart(7)} | ${'StdDev'.padStart(7)}`);
  console.log(`  ${'─'.repeat(68)}`);

  for (const wr of windowResults) {
    const s = wr.oos;
    const pfStr = isFinite(s.pf) ? s.pf.toFixed(2) : '  ∞';
    console.log(`  ${String(wr.window).padStart(2)} | ${wr.testPeriod.padEnd(22)} | ${String(s.trades).padStart(6)} | ${pfStr.padStart(6)} | ${s.wr.toFixed(1).padStart(5)}% | ${s.maxDD.toFixed(2).padStart(5)}% | ${s.netReturnPct.toFixed(2).padStart(6)}% | ${s.avgTrade.toFixed(4).padStart(7)} | ${s.stdDev.toFixed(4).padStart(7)}`);
  }

  console.log(`\n  2. AGGREGATE STATISTICS`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Mean PF:              ${meanPF.toFixed(3)}`);
  console.log(`  Median PF:            ${medianPF.toFixed(3)}`);
  console.log(`  PF Std Dev:           ${pfStdDev.toFixed(3)}`);
  console.log(`  % windows PF > 1:     ${windowsAbove1Pct.toFixed(1)}% (${windowsAbove1}/${pfs.length})`);
  console.log(`  % profitable windows: ${profitableWindowsPct.toFixed(1)}% (${profitableWindows}/${returns.length})`);
  console.log(`  Max consec losses:    ${maxConsecLoss} windows`);
  console.log(`  Mean WR:              ${meanWR.toFixed(1)}%`);
  console.log(`  Mean IS PF:           ${isNaN(meanISPF) ? 'N/A' : meanISPF.toFixed(3)}`);
  console.log(`  PF degradation:       ${isNaN(meanISPF) || meanISPF === 0 ? 'N/A' : ((1 - meanPF / meanISPF) * 100).toFixed(1)}%`);

  console.log(`\n  3. OOS EQUITY CURVE`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Start:    $${CONFIG.startingCapital.toFixed(2)}`);
  console.log(`  End:      $${oosEquity[oosEquity.length - 1].toFixed(2)}`);
  console.log(`  Total:    ${((oosEquity[oosEquity.length - 1] / CONFIG.startingCapital - 1) * 100).toFixed(2)}%`);
  console.log(`  Trades:   ${allOosTrades.length}`);

  // Print equity curve milestones
  const eqLen = oosEquity.length;
  const milestones = [0, Math.floor(eqLen * 0.25), Math.floor(eqLen * 0.5), Math.floor(eqLen * 0.75), eqLen - 1];
  console.log(`\n  Equity milestones:`);
  for (const m of milestones) {
    if (m < eqLen) {
      console.log(`    [${m}] $${oosEquity[m].toFixed(2)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVALUATION
  // ═══════════════════════════════════════════════════════════════════

  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🧪 EVALUATION`);
  console.log(`${'═'.repeat(70)}\n`);

  const passConditions = [
    { name: 'Mean PF > 1.2', pass: meanPF > 1.2, value: meanPF.toFixed(3) },
    { name: '≥ 65% profitable windows', pass: profitableWindowsPct >= 65, value: `${profitableWindowsPct.toFixed(1)}%` },
    { name: 'No ≥ 4 consecutive losing windows', pass: maxConsecLoss < 4, value: `${maxConsecLoss}` },
    { name: 'PF degradation < 40% vs IS', pass: isNaN(meanISPF) || (1 - meanPF / meanISPF) < 0.4, value: isNaN(meanISPF) ? 'N/A' : `${((1 - meanPF / meanISPF) * 100).toFixed(1)}%` },
  ];

  const failureConditions = [
    { name: 'PF ≤ 1.0', fail: meanPF <= 1.0, value: meanPF.toFixed(3) },
    { name: 'Flat/declining equity', fail: oosEquity[eqLen - 1] <= CONFIG.startingCapital, value: `$${oosEquity[eqLen - 1].toFixed(2)}` },
    { name: 'Performance in few windows', fail: windowsAbove1Pct < 50, value: `${windowsAbove1Pct.toFixed(1)}%` },
  ];

  let passCount = 0;
  console.log(`  PASS CONDITIONS:`);
  for (const c of passConditions) {
    const status = c.pass ? '✅ PASS' : '❌ FAIL';
    if (c.pass) passCount++;
    console.log(`    ${status} — ${c.name} (${c.value})`);
  }

  let failCount = 0;
  console.log(`\n  FAILURE CONDITIONS:`);
  for (const c of failureConditions) {
    const status = c.fail ? '❌ FAIL' : '✅ OK';
    if (c.fail) failCount++;
    console.log(`    ${status} — ${c.name} (${c.value})`);
  }

  // ── FINAL CLASSIFICATION ────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🏛️ FINAL CLASSIFICATION`);
  console.log(`${'═'.repeat(70)}\n`);

  let classification;
  if (failCount > 0 || meanPF <= 1.0) {
    classification = '🔴 CASE C — OVERFIT / NON-ROBUST';
    console.log(`  ${classification}`);
    console.log(`\n  Edge does NOT survive out-of-sample validation.`);
  } else if (passCount === passConditions.length && meanPF >= 1.3 && profitableWindowsPct >= 70) {
    classification = '🟢 CASE A — PRODUCTION READY';
    console.log(`  ${classification}`);
    console.log(`\n  Stable, consistent OOS performance confirmed.`);
  } else if (passCount >= 2 && meanPF > 1.0) {
    classification = '🟡 CASE B — FRAGILE EDGE';
    console.log(`  ${classification}`);
    console.log(`\n  Edge exists but shows instability across windows.`);
  } else {
    classification = '🔴 CASE C — OVERFIT / NON-ROBUST';
    console.log(`  ${classification}`);
    console.log(`\n  Insufficient evidence of out-of-sample edge.`);
  }

  // ── Write full report ───────────────────────────────────────────
  let report = `# 🔬 WALK-FORWARD VALIDATION REPORT\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Method:** Rolling 12-month train / 3-month test / 3-month step\n`;
  report += `**Assets:** BTC, ETH, XRP\n`;
  report += `**Entry:** Funding extremes (p10/p95/cumulative drain)\n`;
  report += `**Exit:** Fixed 48h time exit, no stops\n`;
  report += `**Risk:** 1% per trade, max 3 concurrent\n`;
  report += `**Classification:** ${classification}\n\n---\n\n`;

  report += `## 1. Per-Window Metrics\n\n`;
  report += `| Window | Test Period | Trades | PF | WR | DD% | Net Return% | Avg Trade | Std Dev |\n`;
  report += `|--------|-------------|--------|-----|-----|-----|-------------|-----------|----------|\n`;
  for (const wr of windowResults) {
    const s = wr.oos;
    const pfStr = isFinite(s.pf) ? s.pf.toFixed(2) : '∞';
    report += `| ${wr.window} | ${wr.testPeriod} | ${s.trades} | ${pfStr} | ${s.wr.toFixed(1)}% | ${s.maxDD.toFixed(2)}% | ${s.netReturnPct.toFixed(2)}% | ${s.avgTrade.toFixed(4)} | ${s.stdDev.toFixed(4)} |\n`;
  }
  report += `\n`;

  report += `## 2. Aggregate Statistics\n\n`;
  report += `| Metric | Value |\n`;
  report += `|--------|-------|\n`;
  report += `| Mean PF | ${meanPF.toFixed(3)} |\n`;
  report += `| Median PF | ${medianPF.toFixed(3)} |\n`;
  report += `| PF Std Dev | ${pfStdDev.toFixed(3)} |\n`;
  report += `| % windows PF > 1 | ${windowsAbove1Pct.toFixed(1)}% (${windowsAbove1}/${pfs.length}) |\n`;
  report += `| % profitable windows | ${profitableWindowsPct.toFixed(1)}% (${profitableWindows}/${returns.length}) |\n`;
  report += `| Max consecutive losing windows | ${maxConsecLoss} |\n`;
  report += `| Mean Win Rate | ${meanWR.toFixed(1)}% |\n`;
  report += `| Mean IS PF | ${isNaN(meanISPF) ? 'N/A' : meanISPF.toFixed(3)} |\n`;
  report += `| PF Degradation (IS→OOS) | ${isNaN(meanISPF) || meanISPF === 0 ? 'N/A' : ((1 - meanPF / meanISPF) * 100).toFixed(1)}% |\n`;
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

  report += `## 4. Per-Asset OOS Breakdown\n\n`;
  report += `| Asset | Trades | PnL | WR | PF |\n`;
  report += `|-------|--------|-----|----|----|\n`;
  for (const asset of ASSETS) {
    const assetTrades = allOosTrades.filter(t => t.label === asset.label);
    const aStats = computeWindowStats(assetTrades, CONFIG.startingCapital);
    report += `| ${asset.label} | ${aStats.trades} | $${aStats.netReturn.toFixed(2)} | ${aStats.wr.toFixed(1)}% | ${isFinite(aStats.pf) ? aStats.pf.toFixed(2) : '∞'} |\n`;
  }
  report += `\n`;

  report += `## 5. Evaluation\n\n`;
  report += `### Pass Conditions\n\n`;
  report += `| Condition | Status | Value |\n`;
  report += `|-----------|--------|-------|\n`;
  for (const c of passConditions) {
    report += `| ${c.name} | ${c.pass ? '✅ PASS' : '❌ FAIL'} | ${c.value} |\n`;
  }
  report += `\n### Failure Conditions\n\n`;
  report += `| Condition | Status | Value |\n`;
  report += `|-----------|--------|-------|\n`;
  for (const c of failureConditions) {
    report += `| ${c.name} | ${c.fail ? '❌ FAIL' : '✅ OK'} | ${c.value} |\n`;
  }

  report += `\n## 6. Final Classification\n\n`;
  report += `### ${classification}\n\n`;

  if (classification.includes('CASE A')) {
    report += `The funding rate edge demonstrates stable, consistent out-of-sample performance across walk-forward windows. The system is suitable for production deployment under the validated parameters.\n`;
  } else if (classification.includes('CASE B')) {
    report += `The funding rate edge shows some out-of-sample viability but with notable instability across windows. The edge exists but is fragile and may not reliably produce returns in live conditions.\n`;
  } else {
    report += `The funding rate edge does not survive out-of-sample validation. Performance degrades significantly when tested on unseen data, suggesting the in-sample results were substantially influenced by overfitting or regime-specific luck.\n`;
  }

  report += `\n---\n\n*No parameters were modified. No improvements suggested. This is a pure validation result.*\n`;

  // Write files
  const reportPath = path.join(__dirname, 'WALK_FORWARD_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  const equityPath = path.join(__dirname, 'wf-oos-equity.json');
  fs.writeFileSync(equityPath, JSON.stringify(oosEquity));
  console.log(`  ✅ OOS Equity: ${equityPath}`);

  const tradesPath = path.join(__dirname, 'wf-oos-trades.jsonl');
  fs.writeFileSync(tradesPath, allOosTrades.map(t => JSON.stringify(t)).join('\n'));
  console.log(`  ✅ OOS Trades: ${tradesPath}`);

  const windowsPath = path.join(__dirname, 'wf-windows.json');
  fs.writeFileSync(windowsPath, JSON.stringify(windowResults, null, 2));
  console.log(`  ✅ Windows: ${windowsPath}`);

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
