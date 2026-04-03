// ═══════════════════════════════════════════════════════════════
// gate_tracer.js — Trace EXACTLY why signals are rejected
// ═══════════════════════════════════════════════════════════════
//
// This script instruments the backtest loop to count rejections
// at each gate, then runs through the data to see what happens
// after 2022.
//
// Run: node audit/gate_tracer.js

import ccxt from 'ccxt';
import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';
import {
  computeEMA, computeATR, computeADX, computeBollinger,
  computeDelta, computeVolumeMetrics,
  extractRegimes, extractFVGs, extractOrderBlocks,
  extractLiquiditySweeps, extractOTEs,
} from '../engine/Precompute.js';
import ExhaustionDetector from '../engine/ExhaustionDetector.js';
import ModelRouter from '../models/ModelRouter.js';

const SYMBOL = process.argv[2] || 'SOL/USDT:USDT';
const START = process.argv[3] || '2022-01-01';
const END = process.argv[4] || '2026-03-31';

// Gate rejection counters
const gates = {
  dataReady: 0,        // h1Idx >= 50
  regimeNull: 0,       // regimeData is null
  killzoneBlocked: 0,  // killzone not allowed
  sessionBlocked: 0,   // profile.allowedSessions
  weekendBlocked: 0,   // Saturday/Sunday
  regimeBlocked: 0,    // profile.blockedRegimes
  emaBlocked: 0,       // price not above/below EMAs
  cooldownBlocked: 0,  // signal cooldown
  modelNull: 0,        // model returned null
  legacyNull: 0,       // legacy also returned null
  exhaustionBlocked: 0,
  portfolioBlocked: 0,
  signalGenerated: 0,
  totalIterations: 0,
};

// Track by year
const gatesByYear = {};
function trackYear(year) {
  if (!gatesByYear[year]) {
    gatesByYear[year] = { ...Object.fromEntries(Object.keys(gates).map(k => [k, 0])) };
  }
}

// Sample rejections (first N per gate)
const samples = {};
const MAX_SAMPLES = 5;
function sample(gate, data) {
  if (!samples[gate]) samples[gate] = [];
  if (samples[gate].length < MAX_SAMPLES) samples[gate].push(data);
}

async function main() {
  console.log(`\n🔍 Gate Tracer: ${SYMBOL} ${START} → ${END}\n`);

  const exchange = new ccxt.binance({ enableRateLimit: true });

  // Fetch data
  console.log('  Fetching candles...');
  const candles15m = await fetchCandles(exchange, SYMBOL, '15m');
  const candles1h = await fetchCandles(exchange, SYMBOL, '1h');
  console.log(`  15m: ${candles15m.length}, 1h: ${candles1h.length}`);

  // Precompute
  console.log('  Precomputing...');
  const indicators1h = {
    ema9: computeEMA(candles1h, 9),
    ema21: computeEMA(candles1h, 21),
    ema50: computeEMA(candles1h, 50),
    atr: computeATR(candles1h, config.regime.atrPeriod),
    adx: computeADX(candles1h, config.regime.adxPeriod),
    bollinger: computeBollinger(candles1h, 20, 2),
    volumeMetrics: computeVolumeMetrics(candles1h, 20),
  };
  const indicators15m = { delta: computeDelta(candles15m) };
  const regimes = extractRegimes(candles1h, indicators1h);
  const fvgSignals = extractFVGs(candles1h);
  const obSignals = extractOrderBlocks(candles1h);
  const sweepSignals = extractLiquiditySweeps(candles1h);
  const oteSignals = extractOTEs(candles1h);

  const modelRouter = new ModelRouter();
  const exhaustion = new ExhaustionDetector();
  const profile = getProfile(SYMBOL);

  // Build 15m→1h mapping
  const m15toH1 = new Array(candles15m.length);
  let hCursor = 0;
  for (let i = 0; i < candles15m.length; i++) {
    while (hCursor < candles1h.length - 1 && candles1h[hCursor + 1].timestamp <= candles15m[i].timestamp) {
      hCursor++;
    }
    m15toH1[i] = hCursor;
  }

  // Track last signal time
  let lastSignalTime = 0;

  console.log('  Running gate trace...\n');

  for (let i = 50; i < candles15m.length; i++) {
    const candle15m = candles15m[i];
    const timestamp = candle15m.timestamp;
    const h1Idx = m15toH1[i];
    const year = new Date(timestamp).getUTCFullYear();

    gates.totalIterations++;
    trackYear(year);
    gatesByYear[year].totalIterations++;

    // GATE 0: data ready
    if (h1Idx < 50) {
      gates.dataReady++;
      gatesByYear[year].dataReady++;
      continue;
    }

    // GATE 1: regime data
    const regimeData = regimes[h1Idx];
    if (!regimeData) {
      gates.regimeNull++;
      gatesByYear[year].regimeNull++;
      sample('regimeNull', { timestamp, h1Idx });
      continue;
    }
    const regime = regimeData.regime;

    // GATE 2: killzone
    const kzResult = checkKillzone(timestamp);
    if (!kzResult.allowed) {
      gates.killzoneBlocked++;
      gatesByYear[year].killzoneBlocked++;
      sample('killzoneBlocked', { timestamp, session: kzResult.session });
      continue;
    }

    // GATE 3: session gate
    if (profile.allowedSessions && !profile.allowedSessions.includes(kzResult.session)) {
      gates.sessionBlocked++;
      gatesByYear[year].sessionBlocked++;
      sample('sessionBlocked', { timestamp, session: kzResult.session, allowed: profile.allowedSessions });
      continue;
    }

    // GATE 4: weekend
    const day = new Date(timestamp).getUTCDay();
    if (day === 0 || day === 6) {
      gates.weekendBlocked++;
      gatesByYear[year].weekendBlocked++;
      continue;
    }

    // GATE 5: regime blocking
    if (profile.blockedRegimes?.includes(regime)) {
      gates.regimeBlocked++;
      gatesByYear[year].regimeBlocked++;
      sample('regimeBlocked', { timestamp, regime, blocked: profile.blockedRegimes });
      continue;
    }

    // GATE 6: EMA alignment
    const price = candles1h[h1Idx].close;
    const ema21 = indicators1h.ema21[h1Idx];
    const ema50 = indicators1h.ema50[h1Idx];
    const bullish = price > ema21 && price > ema50;
    const bearish = price < ema21 && price < ema50;
    if (!bullish && !bearish) {
      gates.emaBlocked++;
      gatesByYear[year].emaBlocked++;
      sample('emaBlocked', { timestamp, price, ema21, ema50 });
      continue;
    }

    // GATE 7: cooldown
    const cooldown = profile.daytrade.signalCooldown || config.strategy.signalCooldown;
    if (lastSignalTime && timestamp - lastSignalTime < cooldown) {
      gates.cooldownBlocked++;
      gatesByYear[year].cooldownBlocked++;
      continue;
    }

    // BUILD CONTEXT (same as backtest.js)
    const ctx = {
      symbol: SYMBOL, price, timestamp, m15Idx: i, h1Idx,
      regime, regimeData, profile, killzone: kzResult,
      bullish, bearish,
      ema9: indicators1h.ema9[h1Idx], ema21, ema50,
      atr: indicators1h.atr[h1Idx],
      adx: indicators1h.adx[h1Idx],
      bb: {
        upper: indicators1h.bollinger.upper[h1Idx],
        middle: indicators1h.bollinger.middle[h1Idx],
        lower: indicators1h.bollinger.lower[h1Idx],
      },
      volumeRatio: indicators1h.volumeMetrics.volumeRatio[h1Idx],
      delta: indicators15m.delta.delta[i],
      deltaPercent: indicators15m.delta.deltaPercent[i],
      _allDeltas: indicators15m.delta.delta,
      _allPrices: candles15m,
      fvgSignals: fvgSignals[h1Idx],
      obSignals: obSignals[h1Idx],
      sweepSignals: sweepSignals[h1Idx],
      oteSignals: oteSignals[h1Idx],
      candles1h, candles15m, indicators1h,
      index1h: h1Idx, index15m: i,
      deltaArr: indicators15m.delta.delta,
    };

    // MODEL EVALUATION
    const modelCtx = {
      ...ctx,
      index1h: h1Idx,
      index15m: i,
      regimeResult: regimeData,
    };
    let signal = modelRouter.evaluate(SYMBOL, modelCtx);

    if (!signal) {
      gates.modelNull++;
      gatesByYear[year].modelNull++;
      sample('modelNull', { timestamp, regime, bullish, bearish });
      continue;
    }

    // EXHAUSTION
    const exhaustionResult = exhaustion.check({
      ...ctx, ...modelCtx,
      atrZ: computeATRz(indicators1h.atr, h1Idx),
    });

    if (exhaustionResult.blocked) {
      gates.exhaustionBlocked++;
      gatesByYear[year].exhaustionBlocked++;
      sample('exhaustionBlocked', { timestamp, regime, reason: exhaustionResult.reason });
      continue;
    }

    // Portfolio risk (simplified — just count)
    gates.portfolioBlocked++; // placeholder
    gatesByYear[year].portfolioBlocked++;

    // SIGNAL!
    gates.signalGenerated++;
    gatesByYear[year].signalGenerated++;
    lastSignalTime = timestamp;
    sample('signalGenerated', { timestamp, regime, signalType: signal.type });
  }

  // PRINT RESULTS
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   🔬 GATE TRACE RESULTS                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('── Overall Gate Counts ─────────────────────────────────');
  const total = gates.totalIterations;
  for (const [gate, count] of Object.entries(gates)) {
    if (gate === 'totalIterations') continue;
    if (count === 0) continue;
    const pct = ((count / total) * 100).toFixed(4);
    const bar = '█'.repeat(Math.min(30, Math.round(parseFloat(pct) / 2)));
    console.log(`  ${gate.padEnd(25)} ${String(count).padStart(10)} (${pct}%) ${bar}`);
  }
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  ${'TOTAL'.padEnd(25)} ${String(total).padStart(10)}`);

  // By year
  console.log('\n── Gate Counts by Year ────────────────────────────────');
  const yearKeys = Object.keys(gatesByYear).sort();
  console.log('  Gate                    ' + yearKeys.map(y => y.padStart(8)).join(''));
  console.log('  ' + '─'.repeat(24 + yearKeys.length * 8));
  for (const gate of ['killzoneBlocked', 'sessionBlocked', 'weekendBlocked', 'regimeBlocked', 'emaBlocked', 'cooldownBlocked', 'modelNull', 'exhaustionBlocked', 'signalGenerated']) {
    let row = `  ${gate.padEnd(22)}`;
    for (const year of yearKeys) {
      row += String(gatesByYear[year]?.[gate] || 0).padStart(8);
    }
    console.log(row);
  }
  // Total per year
  let totalRow = `  ${'TOTAL'.padEnd(22)}`;
  for (const year of yearKeys) {
    totalRow += String(gatesByYear[year]?.totalIterations || 0).padStart(8);
  }
  console.log(totalRow);

  // Samples
  console.log('\n── Rejection Samples ─────────────────────────────────');
  for (const [gate, samps] of Object.entries(samples)) {
    console.log(`\n  ${gate}:`);
    for (const s of samps) {
      const date = new Date(s.timestamp).toISOString().slice(0, 16);
      const details = Object.entries(s).filter(([k]) => k !== 'timestamp').map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(', ');
      console.log(`    ${date} — ${details}`);
    }
  }

  // KEY INSIGHT
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('KEY INSIGHT: What happened after 2022?');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const y2022 = gatesByYear['2022'];
  const yLater = {};
  for (const year of yearKeys) {
    if (parseInt(year) > 2022) {
      for (const [k, v] of Object.entries(gatesByYear[year])) {
        yLater[k] = (yLater[k] || 0) + v;
      }
    }
  }

  if (y2022 && yLater.totalIterations) {
    console.log('  Gate                  2022        Later       Delta');
    console.log('  ' + '─'.repeat(55));
    for (const gate of ['killzoneBlocked', 'sessionBlocked', 'weekendBlocked', 'regimeBlocked', 'emaBlocked', 'cooldownBlocked', 'modelNull', 'exhaustionBlocked', 'signalGenerated']) {
      const v22 = y2022[gate] || 0;
      const vLater = yLater[gate] || 0;
      const total22 = y2022.totalIterations || 1;
      const totalLater = yLater.totalIterations || 1;
      const pct22 = ((v22 / total22) * 100).toFixed(2);
      const pctLater = ((vLater / totalLater) * 100).toFixed(2);
      const diff = (parseFloat(pctLater) - parseFloat(pct22)).toFixed(2);
      const arrow = parseFloat(diff) > 5 ? '📈' : parseFloat(diff) < -5 ? '📉' : '  ';
      console.log(`  ${gate.padEnd(22)} ${pct22.padStart(6)}%     ${pctLater.padStart(6)}%     ${diff.padStart(7)}% ${arrow}`);
    }
  }
}

function checkKillzone(timestamp) {
  const now = new Date(timestamp);
  const time = now.getUTCHours() + now.getUTCMinutes() / 60;
  const kz = config.killzones;
  if (kz.deadzones.some(dz => time >= dz.start && time < dz.end)) return { allowed: false, session: 'dead' };
  const inLondon = time >= kz.london.start && time < kz.london.end;
  const inNY = time >= kz.ny.start && time < kz.ny.end;
  const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
  const inAsia = (time >= kz.asia.start || time < kz.asia.end);
  const session = inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session';
  if (session === 'off-session') return { allowed: false, session };
  return { allowed: true, overlap: inOverlap, session };
}

function computeATRz(atrArray, index, lookback = 50) {
  if (!atrArray || index == null || index < lookback) return 0;
  const currentATR = atrArray[index];
  if (!currentATR || currentATR === 0) return 0;
  let sum = 0, sumSq = 0;
  const start = Math.max(0, index - lookback);
  const count = index - start + 1;
  for (let j = start; j <= index; j++) {
    const v = atrArray[j] || 0;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const std = Math.sqrt(variance);
  return std > 0 ? (currentATR - mean) / std : 0;
}

async function fetchCandles(exchange, symbol, timeframe) {
  const allCandles = [];
  let since = new Date(START).getTime();
  const endTime = new Date(END).getTime();
  const limit = 1000;
  while (true) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit);
      if (ohlcv.length === 0) break;
      allCandles.push(...ohlcv.map(c => ({
        timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
      })));
      const lastTs = ohlcv[ohlcv.length - 1][0];
      if (lastTs >= endTime || ohlcv.length < limit) break;
      since = lastTs + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (err) {
      console.error(`  Fetch error: ${err.message}`);
      break;
    }
  }
  return allCandles.filter(c => c.timestamp <= endTime);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
