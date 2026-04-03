#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Data Expansion Engine — Unrestricted Signal Generator
// ═══════════════════════════════════════════════════════════════════
//
// PURPOSE: Generate MAXIMUM signals to validate whether entry has
// predictive power, isolated from exit logic.
//
// ALL FILTERS DISABLED:
//   - No portfolio risk blocking
//   - No exhaustion blocking
//   - No regime blocking
//   - No session/killzone filtering
//   - No weekend filtering
//   - No cooldown
//   - No threshold filtering
//   - No EMA alignment requirement
//
// For each signal, simulate MULTIPLE exit scenarios:
//   - Fixed RR 1:1, 1:2, 1:3
//   - Time-based: 4h, 12h, 24h, 48h
//   - Trailing stop (current system)
//   - Emergency stop (current system)
//   - Random exit baseline (coin flip)
//
// OUTPUT: Massive JSONL dataset for statistical analysis

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import {
  computeEMA, computeATR, computeADX, computeBollinger,
  computeDelta, computeVolumeMetrics,
  extractRegimes, extractFVGs, extractOrderBlocks,
  extractLiquiditySweeps, extractOTEs,
} from '../engine/Precompute.js';

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

const SYMBOLS = ['SOL/USDT:USDT', 'ETH/USDT:USDT', 'BTC/USDT:USDT', 'XRP/USDT:USDT'];
const START_DATE = '2022-01-01';
const END_DATE = '2026-03-31';
const EXCHANGE = 'binance';
const STARTING_BALANCE = 10000;

// ═══════════════════════════════════════════════════════════════════
// SIGNAL GENERATOR — No filters, extract features at every candle
// ═══════════════════════════════════════════════════════════════════

function extractFeatures(candles15m, candles1h, m15Idx, h1Idx, indicators1h, indicators15m, regimes) {
  if (h1Idx < 50 || m15Idx < 20) return null;

  const candle15m = candles15m[m15Idx];
  const candle1h = candles1h[h1Idx];
  const price = candle15m.close;
  const atr = indicators1h.atr[h1Idx];
  if (!atr || atr === 0) return null;

  // ── EMA ──
  const ema9 = indicators1h.ema9[h1Idx];
  const ema21 = indicators1h.ema21[h1Idx];
  const ema50 = indicators1h.ema50[h1Idx];
  const bullish = price > ema21 && price > ema50;
  const bearish = price < ema21 && price < ema50;
  const bullishStack = ema9 > ema21 && ema21 > ema50 && price > ema9;
  const bearishStack = ema9 < ema21 && ema21 < ema50 && price < ema9;

  // ── Regime ──
  const regimeData = regimes[h1Idx];
  const regime = regimeData?.regime || 'UNKNOWN';

  // ── Delta ──
  const deltaArr = indicators15m.delta.delta;
  const deltaHistory = [];
  for (let j = Math.max(0, m15Idx - 9); j <= m15Idx; j++) {
    deltaHistory.push(deltaArr[j] ?? 0);
  }
  const currentDelta = deltaHistory[deltaHistory.length - 1];
  const deltaSum = deltaHistory.reduce((a, b) => a + b, 0);
  const deltaTrend = deltaSum > 0 ? 'bullish' : deltaSum < 0 ? 'bearish' : 'neutral';

  // Stacked imbalance
  let maxStack = 1, currentStack = 1;
  let lastSign = Math.sign(deltaHistory[0]);
  for (let i = 1; i < deltaHistory.length; i++) {
    const sign = Math.sign(deltaHistory[i]);
    if (sign === lastSign && sign !== 0) {
      currentStack++;
      maxStack = Math.max(maxStack, currentStack);
    } else {
      currentStack = 1;
      lastSign = sign;
    }
  }

  // Delta divergence (price vs delta disagreement)
  const priceUp = candle15m.close > candles15m[Math.max(0, m15Idx - 5)].close;
  const priceDown = candle15m.close < candles15m[Math.max(0, m15Idx - 5)].close;
  const recentDelta = deltaHistory.slice(-3).reduce((a, b) => a + b, 0);
  const olderDelta = deltaHistory.slice(-6, -3).reduce((a, b) => a + b, 0);
  let divergence = 'none';
  if (priceDown && recentDelta > olderDelta && recentDelta > 0) divergence = 'bullish';
  if (priceUp && recentDelta < olderDelta && recentDelta < 0) divergence = 'bearish';

  // ── Momentum ──
  const mStart = Math.max(0, m15Idx - 5);
  const momentum = (candles15m[m15Idx].close - candles15m[mStart].close) / candles15m[mStart].close;
  const momentumDir = momentum > 0 ? 'bullish' : momentum < 0 ? 'bearish' : 'neutral';

  // ── Volatility ──
  const atrValues = [];
  for (let i = Math.max(1, h1Idx - 50); i <= h1Idx; i++) {
    const c = candles1h[i];
    const prev = candles1h[i - 1];
    atrValues.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const atrMean = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;
  const atrVariance = atrValues.reduce((s, v) => s + (v - atrMean) ** 2, 0) / atrValues.length;
  const atrStd = Math.sqrt(atrVariance);
  const atrZ = atrStd > 0 ? (atr - atrMean) / atrStd : 0;

  // ── Distance from mean ──
  let sum20 = 0;
  for (let i = h1Idx - 19; i <= h1Idx; i++) sum20 += candles1h[i].close;
  const sma20 = sum20 / 20;
  const distFromMean = atr > 0 ? Math.abs(price - sma20) / atr : 0;

  // ── Volume ──
  const volRatio = indicators1h.volumeMetrics?.volumeRatio?.[h1Idx] ?? 1.0;

  // ── Price position in range ──
  const rangeStart = Math.max(0, h1Idx - 20);
  let rangeHigh = -Infinity, rangeLow = Infinity;
  for (let i = rangeStart; i <= h1Idx; i++) {
    if (candles1h[i].high > rangeHigh) rangeHigh = candles1h[i].high;
    if (candles1h[i].low < rangeLow) rangeLow = candles1h[i].low;
  }
  const rangeSize = rangeHigh - rangeLow;
  const pricePosition = rangeSize > 0 ? (price - rangeLow) / rangeSize : 0.5;

  // ── ADX ──
  const adx = indicators1h.adx[h1Idx] ?? 0;

  // ── Bollinger ──
  const bbUpper = indicators1h.bollinger.upper[h1Idx];
  const bbLower = indicators1h.bollinger.lower[h1Idx];
  const bbMiddle = indicators1h.bollinger.middle[h1Idx];
  const bbWidth = bbMiddle > 0 ? (bbUpper - bbLower) / bbMiddle : 0;
  const bbPosition = (bbUpper - bbLower) > 0 ? (price - bbLower) / (bbUpper - bbLower) : 0.5;

  // ── ICT signals ──
  const regimeObj = regimes[h1Idx];

  // ── Time features ──
  const hour = new Date(candle15m.timestamp).getUTCHours();
  const dayOfWeek = new Date(candle15m.timestamp).getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // ── Direction signal (basic) ──
  let direction = 'neutral';
  if (bullish && deltaTrend === 'bullish') direction = 'long';
  else if (bearish && deltaTrend === 'bearish') direction = 'short';
  else if (bullish) direction = 'long';
  else if (bearish) direction = 'short';

  return {
    // Context
    timestamp: candle15m.timestamp,
    date: new Date(candle15m.timestamp).toISOString(),
    symbol: null, // set by caller
    price,
    atr,
    regime,

    // EMA
    ema9, ema21, ema50,
    bullish, bearish, bullishStack, bearishStack,
    emaAlignment: bullishStack ? 'bullish' : bearishStack ? 'bearish' : 'neutral',

    // Delta
    currentDelta, deltaSum, deltaTrend,
    stackedCount: maxStack,
    divergence,

    // Momentum
    momentum, momentumDir,

    // Volatility
    atrZ,
    distFromMean,
    volRatio,

    // Structure
    pricePosition,
    adx: adx || 0,
    bbWidth, bbPosition,

    // Time
    hour, dayOfWeek, isWeekend,

    // Direction
    direction,

    // Arrays for exit simulation
    _futureCandles15m: null, // populated by caller
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXIT SIMULATOR — Multiple exit scenarios per signal
// ═══════════════════════════════════════════════════════════════════

function simulateExits(entryPrice, atr, direction, futureCandles, entryTimestamp) {
  if (!futureCandles || futureCandles.length < 4) return null;

  const side = direction === 'long' ? 1 : -1;
  const exits = {};

  // Fixed RR exits
  const rrLevels = [1, 2, 3];
  for (const rr of rrLevels) {
    const target = direction === 'long'
      ? entryPrice + atr * rr
      : entryPrice - atr * rr;
    const stop = direction === 'long'
      ? entryPrice - atr * rr
      : entryPrice + atr * rr;

    let hit = null;
    for (let i = 0; i < futureCandles.length && i < 2880; i++) { // max 30 days
      const c = futureCandles[i];
      if (direction === 'long') {
        if (c.high >= target) { hit = { exit: target, bar: i, reason: 'tp' }; break; }
        if (c.low <= stop) { hit = { exit: stop, bar: i, reason: 'sl' }; break; }
      } else {
        if (c.low <= target) { hit = { exit: target, bar: i, reason: 'tp' }; break; }
        if (c.high >= stop) { hit = { exit: stop, bar: i, reason: 'sl' }; break; }
      }
    }
    exits[`rr_${rr}`] = hit || { exit: futureCandles[Math.min(2879, futureCandles.length - 1)].close, bar: Math.min(2879, futureCandles.length - 1), reason: 'timeout' };
  }

  // Time-based exits
  const timeExits = [
    { label: '4h', bars: 16 },
    { label: '8h', bars: 32 },
    { label: '12h', bars: 48 },
    { label: '24h', bars: 96 },
    { label: '48h', bars: 192 },
    { label: '7d', bars: 672 },
  ];

  for (const te of timeExits) {
    const barIdx = Math.min(te.bars, futureCandles.length) - 1;
    if (barIdx >= 0 && barIdx < futureCandles.length) {
      exits[`time_${te.label}`] = {
        exit: futureCandles[barIdx].close,
        bar: barIdx,
        reason: 'time',
      };
    }
  }

  // Trailing stop (simplified: activate at 1.0 ATR profit, trail at 0.5 ATR)
  {
    const trailActivation = atr * 1.0;
    const trailDist = atr * 0.5;
    let trailingActive = false;
    let trailStop = direction === 'long' ? entryPrice - atr * 8 : entryPrice + atr * 8;
    let bestPrice = entryPrice;
    let hit = null;

    for (let i = 0; i < futureCandles.length && i < 2880; i++) {
      const c = futureCandles[i];
      if (direction === 'long') {
        if (c.high > bestPrice) bestPrice = c.high;
        if (!trailingActive && c.high >= entryPrice + trailActivation) trailingActive = true;
        if (trailingActive) {
          trailStop = Math.max(trailStop, bestPrice - trailDist);
        }
        if (c.low <= trailStop) {
          hit = { exit: trailStop, bar: i, reason: trailingActive ? 'trailing' : 'emergency' };
          break;
        }
      } else {
        if (c.low < bestPrice) bestPrice = c.low;
        if (!trailingActive && c.low <= entryPrice - trailActivation) trailingActive = true;
        if (trailingActive) {
          trailStop = Math.min(trailStop, bestPrice + trailDist);
        }
        if (c.high >= trailStop) {
          hit = { exit: trailStop, bar: i, reason: trailingActive ? 'trailing' : 'emergency' };
          break;
        }
      }
    }
    exits['trailing'] = hit || { exit: futureCandles[Math.min(2879, futureCandles.length - 1)].close, bar: Math.min(2879, futureCandles.length - 1), reason: 'timeout' };
  }

  // Emergency stop only (8 ATR)
  {
    const emergencyDist = atr * 8;
    const emergencyStop = direction === 'long' ? entryPrice - emergencyDist : entryPrice + emergencyDist;
    let hit = null;
    for (let i = 0; i < futureCandles.length && i < 2880; i++) {
      const c = futureCandles[i];
      if (direction === 'long' && c.low <= emergencyStop) {
        hit = { exit: emergencyStop, bar: i, reason: 'emergency' };
        break;
      }
      if (direction === 'short' && c.high >= emergencyStop) {
        hit = { exit: emergencyStop, bar: i, reason: 'emergency' };
        break;
      }
    }
    exits['emergency_only'] = hit || { exit: futureCandles[Math.min(2879, futureCandles.length - 1)].close, bar: Math.min(2879, futureCandles.length - 1), reason: 'timeout' };
  }

  // Random exit baseline (random bar between 4-48h)
  {
    const minBars = 16, maxBars = 192;
    const randomBar = Math.floor(Math.random() * (maxBars - minBars)) + minBars;
    const barIdx = Math.min(randomBar, futureCandles.length - 1);
    exits['random'] = {
      exit: futureCandles[barIdx].close,
      bar: barIdx,
      reason: 'random',
    };
  }

  // Compute PnL for each exit
  const results = {};
  for (const [key, ex] of Object.entries(exits)) {
    if (!ex) continue;
    const pnl = (ex.exit - entryPrice) * side;
    const pnlATR = pnl / atr;
    const durationMin = ex.bar * 15;
    results[key] = {
      pnl,
      pnlATR,
      durationMin,
      reason: ex.reason,
      exitBar: ex.bar,
    };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   📊 DATA EXPANSION ENGINE v1.0                     ║');
  console.log('║   Unrestricted signal generation + exit isolation   ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const outputDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const datasetFile = path.join(outputDir, `expanded-dataset-${timestamp}.jsonl`);
  const summaryFile = path.join(outputDir, `expanded-summary-${timestamp}.json`);

  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const allSignals = [];
  const summary = { symbols: {}, total: 0 };

  for (const symbol of SYMBOLS) {
    console.log(`\n── Processing ${symbol} ─────────────────────────`);

    try {
      // ═══════════════════════════════════════════════════════════
      // FETCH DATA
      // ═══════════════════════════════════════════════════════════
      const t0 = Date.now();

      const candles15m = await fetchCandles(exchange, symbol, '15m', START_DATE, END_DATE);
      const candles1h = await fetchCandles(exchange, symbol, '1h', START_DATE, END_DATE);

      console.log(`  📥 Data: 15m=${candles15m.length} | 1h=${candles1h.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

      if (candles15m.length < 100 || candles1h.length < 50) {
        console.log(`  ⚠️  Not enough data, skipping`);
        continue;
      }

      // ═══════════════════════════════════════════════════════════
      // PRECOMPUTE
      // ═══════════════════════════════════════════════════════════
      const t1 = Date.now();

      const indicators1h = {
        ema9: computeEMA(candles1h, 9),
        ema21: computeEMA(candles1h, 21),
        ema50: computeEMA(candles1h, 50),
        atr: computeATR(candles1h, 14),
        adx: computeADX(candles1h, 14),
        bollinger: computeBollinger(candles1h, 20, 2),
        volumeMetrics: computeVolumeMetrics(candles1h, 20),
      };

      const indicators15m = {
        delta: computeDelta(candles15m),
      };

      const regimes = extractRegimes(candles1h, indicators1h);

      console.log(`  📐 Precompute: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

      // ═══════════════════════════════════════════════════════════
      // BUILD 15m → 1h INDEX MAP
      // ═══════════════════════════════════════════════════════════
      const m15toH1 = new Array(candles15m.length);
      let hCursor = 0;
      for (let i = 0; i < candles15m.length; i++) {
        while (hCursor < candles1h.length - 1 && candles1h[hCursor + 1].timestamp <= candles15m[i].timestamp) {
          hCursor++;
        }
        m15toH1[i] = hCursor;
      }

      // ═══════════════════════════════════════════════════════════
      // GENERATE SIGNALS AT EVERY CANDLE — NO FILTERS
      // ═══════════════════════════════════════════════════════════
      const t2 = Date.now();
      let signalCount = 0;

      // Start from candle 50 (need history for indicators)
      const startIdx = 50 * 4; // 50 1h candles = ~200 15m candles

      for (let i = startIdx; i < candles15m.length - 2880; i++) { // leave room for 30-day future
        const h1Idx = m15toH1[i];
        if (h1Idx < 50) continue;

        const features = extractFeatures(candles15m, candles1h, i, h1Idx, indicators1h, indicators15m, regimes);
        if (!features) continue;

        features.symbol = symbol;

        // Only generate signals for directional setups (not neutral)
        // This is the MINIMUM filter — just direction from EMA + delta
        if (features.direction === 'neutral') continue;

        // Get future candles for exit simulation
        const futureCandles = candles15m.slice(i + 1, i + 2881);

        // Simulate all exit scenarios
        const exitResults = simulateExits(features.price, features.atr, features.direction, futureCandles, features.timestamp);

        if (!exitResults) continue;

        const signal = {
          ...features,
          exits: exitResults,
          _idx: i,
        };

        allSignals.push(signal);
        signalCount++;
      }

      console.log(`  🔍 Signals generated: ${signalCount} (${((Date.now() - t2) / 1000).toFixed(1)}s)`);

      summary.symbols[symbol] = {
        candles15m: candles15m.length,
        candles1h: candles1h.length,
        signals: signalCount,
      };
      summary.total += signalCount;

    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // WRITE DATASET
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n── Writing Dataset ────────────────────────────────`);

  const ws = fs.createWriteStream(datasetFile);
  for (const signal of allSignals) {
    ws.write(JSON.stringify(signal) + '\n');
  }
  ws.end();

  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  console.log(`  📁 Dataset: ${datasetFile} (${allSignals.length.toLocaleString()} signals)`);
  console.log(`  📁 Summary: ${summaryFile}`);

  // ═══════════════════════════════════════════════════════════════
  // QUICK ANALYSIS
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n── Quick Analysis ─────────────────────────────────`);

  for (const symbol of SYMBOLS) {
    const sigs = allSignals.filter(s => s.symbol === symbol);
    if (sigs.length === 0) continue;

    console.log(`\n  ${symbol}:`);

    // By exit type
    const exitTypes = ['rr_1', 'rr_2', 'rr_3', 'time_4h', 'time_12h', 'time_24h', 'trailing', 'emergency_only', 'random'];
    for (const exitType of exitTypes) {
      const pnls = sigs.map(s => s.exits?.[exitType]?.pnl).filter(p => p !== undefined && p !== null);
      if (pnls.length === 0) continue;
      const totalPnL = pnls.reduce((a, b) => a + b, 0);
      const wins = pnls.filter(p => p > 0).length;
      const wr = ((wins / pnls.length) * 100).toFixed(0);
      const grossProfit = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
      const grossLoss = Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0));
      const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞';
      console.log(`    ${exitType.padEnd(16)} ${String(pnls.length).padStart(5)} trades | ${wr}% WR | PF=${pf.padStart(5)} | PnL=$${totalPnL.toFixed(2).padStart(10)}`);
    }

    // By regime
    console.log(`\n    By regime (trailing exit):`);
    const byRegime = {};
    for (const s of sigs) {
      const r = s.regime || 'UNKNOWN';
      const pnl = s.exits?.trailing?.pnl;
      if (pnl === undefined) continue;
      if (!byRegime[r]) byRegime[r] = { n: 0, pnl: 0, wins: 0 };
      byRegime[r].n++;
      byRegime[r].pnl += pnl;
      if (pnl > 0) byRegime[r].wins++;
    }
    for (const [r, d] of Object.entries(byRegime).sort((a, b) => b[1].pnl - a[1].pnl)) {
      const wr = ((d.wins / d.n) * 100).toFixed(0);
      console.log(`      ${r.padEnd(16)} ${String(d.n).padStart(5)} trades | ${wr}% WR | PnL=$${d.pnl.toFixed(2).padStart(10)}`);
    }

    // By stacked count
    console.log(`\n    By stacked count (trailing exit):`);
    const byStacked = {};
    for (const s of sigs) {
      const sc = s.stackedCount || 0;
      const bucket = sc <= 2 ? 'low(1-2)' : sc <= 4 ? 'med(3-4)' : 'high(5+)';
      const pnl = s.exits?.trailing?.pnl;
      if (pnl === undefined) continue;
      if (!byStacked[bucket]) byStacked[bucket] = { n: 0, pnl: 0, wins: 0 };
      byStacked[bucket].n++;
      byStacked[bucket].pnl += pnl;
      if (pnl > 0) byStacked[bucket].wins++;
    }
    for (const [b, d] of Object.entries(byStacked)) {
      const wr = ((d.wins / d.n) * 100).toFixed(0);
      console.log(`      ${b.padEnd(12)} ${String(d.n).padStart(5)} trades | ${wr}% WR | PnL=$${d.pnl.toFixed(2).padStart(10)}`);
    }
  }

  console.log(`\n  ✅ Data expansion complete.\n`);
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

async function fetchCandles(exchange, symbol, timeframe, startDate, endDate) {
  const allCandles = [];
  let since = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();
  const limit = 1000;

  while (true) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit);
      if (ohlcv.length === 0) break;

      const candles = ohlcv.map(c => ({
        timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
      }));

      allCandles.push(...candles);

      const lastTs = ohlcv[ohlcv.length - 1][0];
      if (lastTs >= endTime || ohlcv.length < limit) break;
      since = lastTs + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (err) {
      console.error(`  Fetch error (${timeframe}): ${err.message}`);
      break;
    }
  }

  return allCandles.filter(c => c.timestamp <= endTime);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
