// ═══════════════════════════════════════════════════════════════════
// EDGE EXTRACTABILITY ENGINE v2.7
// ═══════════════════════════════════════════════════════════════════
//
// Objective: Determine if candidate edges survive realistic conditions.
// NOT optimizing. NOT curve-fitting. ONLY judging extractability.
//
// Tests:
//   T1 — Friction Sensitivity (fees + slippage)
//   T2 — Position Timing Flexibility (+0/+1/+2 candle delay)
//   T3 — Holding Period Optimization (fixed exits + MFE distribution)
//   T4 — Regime Dependency Quantification (year + regime breakdown)
//   T5 — Capital Efficiency (return/trade, lock-up, frequency)
//   T6 — Risk Structure (MAE, tail risk, recovery)
//
// Final: Classify each edge as ROBUST & EXTRACTABLE / REAL BUT FRAGILE /
//        STATISTICAL BUT NOT TRADEABLE / REJECTED
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

const EXCHANGE = 'binance';
const TIMEFRAME = '1h';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:00Z';

const ASSETS = [
  { symbol: 'SOL/USDT:USDT', label: 'SOL' },
  { symbol: 'BTC/USDT:USDT', label: 'BTC' },
  { symbol: 'ETH/USDT:USDT', label: 'ETH' },
  { symbol: 'XRP/USDT:USDT', label: 'XRP' },
];

// Friction scenarios (per side)
const FRICTION_SCENARIOS = [
  { name: 'Low friction',  feeRate: 0.0004, slippagePct: 0.00005 },
  { name: 'Medium friction', feeRate: 0.0007, slippagePct: 0.00010 },
  { name: 'High friction',  feeRate: 0.0010, slippagePct: 0.00015 },
];

// ═══════════════════════════════════════════════════════════════════
// INDICATORS (standalone, same as edge-discovery scripts)
// ═══════════════════════════════════════════════════════════════════

function computeATR(candles, period) {
  const n = candles.length;
  const tr = new Array(n);
  const atr = new Array(n).fill(null);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low - candles[i-1].close)
    );
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i-period];
    if (i >= period-1) atr[i] = sum / period;
  }
  return atr;
}

function computeEMA(data, period) {
  const r = new Array(data.length);
  const k = 2/(period+1);
  r[0] = data[0];
  for (let i = 1; i < data.length; i++) r[i] = data[i]*k + r[i-1]*(1-k);
  return r;
}

function computeSMA(data, period) {
  const r = new Array(data.length).fill(null);
  let s = 0;
  for (let i = 0; i < data.length; i++) {
    s += data[i];
    if (i >= period) s -= data[i-period];
    if (i >= period-1) r[i] = s/period;
  }
  return r;
}

function computeStdDev(data, period) {
  const r = new Array(data.length).fill(null);
  for (let i = period-1; i < data.length; i++) {
    let s = 0;
    for (let j = i-period+1; j <= i; j++) s += data[j];
    const m = s/period;
    let sq = 0;
    for (let j = i-period+1; j <= i; j++) sq += (data[j]-m)**2;
    r[i] = Math.sqrt(sq/period);
  }
  return r;
}

function computeADX(candles, period) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n);
  const adx = new Array(n).fill(null);

  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i-1].high;
    const dn = candles[i-1].low - candles[i].low;
    plusDM[i] = up>dn&&up>0 ? up : 0;
    minusDM[i] = dn>up&&dn>0 ? dn : 0;
    tr[i] = Math.max(candles[i].high-candles[i].low, Math.abs(candles[i].high-candles[i-1].close), Math.abs(candles[i].low-candles[i-1].close));
  }
  const sTR = new Array(n).fill(0);
  const sP = new Array(n).fill(0);
  const sM = new Array(n).fill(0);
  let sumTR=0, sumP=0, sumM=0;
  for (let i = 0; i < period; i++) { sumTR+=tr[i]; sumP+=plusDM[i]; sumM+=minusDM[i]; }
  sTR[period-1]=sumTR; sP[period-1]=sumP; sM[period-1]=sumM;
  for (let i = period; i < n; i++) {
    sTR[i]=sTR[i-1]-sTR[i-1]/period+tr[i];
    sP[i]=sP[i-1]-sP[i-1]/period+plusDM[i];
    sM[i]=sM[i-1]-sM[i-1]/period+minusDM[i];
  }
  const dx = new Array(n).fill(0);
  for (let i = period-1; i < n; i++) {
    if (sTR[i]===0) continue;
    const pdi=100*sP[i]/sTR[i], mdi=100*sM[i]/sTR[i], ds=pdi+mdi;
    dx[i]=ds===0?0:100*Math.abs(pdi-mdi)/ds;
  }
  let s=0;
  for (let i = 0; i < n; i++) {
    s+=dx[i];
    if (i>=period+period-2) { s-=dx[i-period]; adx[i]=s/period; }
  }
  return adx;
}

// ═══════════════════════════════════════════════════════════════════
// REGIME DETECTION (same as edge-discovery-deep.js)
// ═══════════════════════════════════════════════════════════════════

function detectRegimes(candles, atr, adx) {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const regimes = new Array(n).fill('UNKNOWN');

  const atrZ = new Array(n).fill(null);
  for (let i = 200; i < n; i++) {
    if (atr[i]===null) continue;
    let s=0, sq=0, c=0;
    for (let j = i-199; j <= i; j++) { if (atr[j]!==null) { s+=atr[j]; sq+=atr[j]**2; c++; } }
    const m=s/c; const std=Math.sqrt(Math.max(0, sq/c - m*m));
    atrZ[i] = std>0 ? (atr[i]-m)/std : 0;
  }

  const bbSma = computeSMA(closes, 20);
  const bbStd = computeStdDev(closes, 20);
  const bbWidth = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (bbSma[i]!==null && bbStd[i]!==null && closes[i]>0) bbWidth[i] = (2*2*bbStd[i])/closes[i];
  }

  const ema20 = computeEMA(closes, 20);

  for (let i = 200; i < n; i++) {
    if (atrZ[i]===null || adx[i]===null || bbWidth[i]===null) continue;
    let bbBelow=0, bbCount=0;
    for (let j = i-199; j <= i; j++) { if (bbWidth[j]!==null) { bbCount++; if (bbWidth[j]<bbWidth[i]) bbBelow++; } }
    const bbPct = bbCount>0 ? bbBelow/bbCount : 0.5;

    if (bbPct<0.2 && atrZ[i]<-0.5) regimes[i]='LOW_VOL';
    else if (bbPct<0.35) regimes[i]='RANGING';
    else if (adx[i]>25 && atrZ[i]>0.3) regimes[i]=closes[i]>ema20[i]?'TRENDING_UP':'TRENDING_DOWN';
    else if (atrZ[i]>1.0) regimes[i]='VOL_EXPANSION';
    else regimes[i]='RANGING';
  }
  return { regimes, atrZ, bbWidth };
}

// ═══════════════════════════════════════════════════════════════════
// STATS HELPERS
// ═══════════════════════════════════════════════════════════════════

function stats(arr) {
  const v = arr.filter(x => x!==null && !isNaN(x) && isFinite(x));
  if (v.length < 5) return { n: v.length, mean: 0, median: 0, std: 0, pctPositive: 0, tStat: 0, significant: false, skew: 0, min: 0, max: 0 };
  const n = v.length;
  const mean = v.reduce((s,x)=>s+x,0)/n;
  const sorted = [...v].sort((a,b)=>a-b);
  const median = sorted[Math.floor(n/2)];
  const pos = v.filter(r=>r>0).length;
  let m2=0, m3=0;
  for (const x of v) { const d=x-mean; m2+=d*d; m3+=d*d*d; }
  m2/=n; m3/=n;
  const std = Math.sqrt(m2);
  const skew = std>0 ? m3/(std**3) : 0;
  const t = std>0 ? mean/(std/Math.sqrt(n)) : 0;
  return { n, mean, median, std, pctPositive: pos/n, tStat: t, significant: Math.abs(t)>1.96, skew, min: sorted[0], max: sorted[n-1] };
}

function percentile(arr, p) {
  const sorted = [...arr].filter(x=>x!==null && isFinite(x)).sort((a,b)=>a-b);
  if (sorted.length===0) return 0;
  const idx = Math.floor(p/100 * sorted.length);
  return sorted[Math.min(idx, sorted.length-1)];
}

// ═══════════════════════════════════════════════════════════════════
// EDGE DETECTORS (exact replicas from edge-discovery scripts)
// ═══════════════════════════════════════════════════════════════════

function detectHigherLow(candles, atr, ema50) {
  const n = candles.length;
  const events = [];
  for (let i = 10; i < n-1; i++) {
    if (atr[i]===null || ema50[i]===null) continue;
    const lows = candles.map(c => c.low);
    const isLocalLow = lows[i] <= lows[i-1] && lows[i] <= lows[i+1] &&
                       lows[i] <= lows[i-2] && lows[i] <= lows[i-3];
    if (!isLocalLow) continue;
    for (let j = i-3; j >= i-20 && j >= 4; j--) {
      const wasLocalLow = lows[j]<=lows[j-1] && lows[j]<=lows[j+1] && lows[j]<=lows[j-2] && lows[j]<=lows[j+2];
      if (wasLocalLow && lows[i] > lows[j] && candles[i].close > ema50[i]) {
        events.push(i);
        break;
      }
    }
  }
  return events;
}

function detectDisplacementBullish(candles, atr) {
  const n = candles.length;
  const events = [];
  for (let i = 5; i < n-1; i++) {
    if (atr[i]===null) continue;
    const body = Math.abs(candles[i].close - candles[i].open);
    const range = candles[i].high - candles[i].low;
    if (range===0) continue;
    const bodyRatio = body/range;
    if (bodyRatio > 0.7 && body > atr[i]*1.5) {
      const dir = candles[i].close > candles[i].open ? 1 : -1;
      const nextBody = candles[i+1].close - candles[i+1].open;
      const notReverted = (dir>0 && nextBody > -body*0.5) || (dir<0 && nextBody < body*0.5);
      if (dir>0 && notReverted) events.push(i);
    }
  }
  return events;
}

function detectStopRunTrendingUp(candles, atr, regimes) {
  const n = candles.length;
  const events = [];
  for (let i = 2; i < n-2; i++) {
    if (atr[i]===null || regimes[i+1]!=='TRENDING_UP') continue;
    const wickUp = candles[i].high - Math.max(candles[i].open, candles[i].close);
    const body = Math.abs(candles[i].close - candles[i].open);
    if (wickUp > body*2 && wickUp > atr[i]*0.5) {
      if (candles[i+1].close > candles[i+1].open) events.push(i+1);
    }
  }
  return events;
}

function detectPostBearVolumeSurge(candles, volSMA, volStd) {
  const n = candles.length;
  const events = [];
  for (let i = 25; i < n-1; i++) {
    if (volSMA[i]===null || volStd[i]===null || volStd[i]===0) continue;
    const volZ = (candles[i].volume - volSMA[i])/volStd[i];
    if (volZ > 2.0 && candles[i].close < candles[i].open) {
      events.push(i);
    }
  }
  return events;
}

// ═══════════════════════════════════════════════════════════════════
// CORE ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute forward return from event index to entry index + holding horizon.
 * entryPrice = candles[entryIdx].close (or open of next candle for real execution)
 */
function forwardReturn(candles, eventIdx, entryOffset, horizonCandles) {
  const entryIdx = eventIdx + entryOffset;
  const exitIdx = entryIdx + horizonCandles;
  if (exitIdx >= candles.length || entryIdx >= candles.length) return null;
  const entryPrice = candles[entryIdx].close;
  const exitPrice = candles[exitIdx].close;
  if (entryPrice <= 0) return null;
  return (exitPrice - entryPrice) / entryPrice;
}

/**
 * Compute MAE/MFE for a trade from entryIdx over maxHorizon candles.
 */
function computeMAE_MFE(candles, entryIdx, maxHorizon, direction='long') {
  const exitIdx = Math.min(entryIdx + maxHorizon, candles.length - 1);
  const entryPrice = candles[entryIdx].close;
  if (entryPrice <= 0) return { mae: 0, mfe: 0, maeIdx: entryIdx, mfeIdx: entryIdx };

  let mae = 0, mfe = 0;
  let maeIdx = entryIdx, mfeIdx = entryIdx;

  for (let j = entryIdx; j <= exitIdx; j++) {
    if (direction === 'long') {
      const adversePct = (candles[j].low - entryPrice) / entryPrice;
      const favorablePct = (candles[j].high - entryPrice) / entryPrice;
      if (adversePct < mae) { mae = adversePct; maeIdx = j; }
      if (favorablePct > mfe) { mfe = favorablePct; mfeIdx = j; }
    } else {
      const adversePct = (candles[j].high - entryPrice) / entryPrice;
      const favorablePct = (candles[j].low - entryPrice) / entryPrice;
      if (adversePct > mae) { mae = adversePct; maeIdx = j; }
      if (favorablePct < mfe) { mfe = favorablePct; mfeIdx = j; }
    }
  }
  return { mae, mfe, maeIdx, mfeIdx };
}

/**
 * Time to MFE: how many candles until max favorable excursion is first reached
 */
function timeToMFE(candles, entryIdx, maxHorizon, direction='long') {
  const exitIdx = Math.min(entryIdx + maxHorizon, candles.length - 1);
  const entryPrice = candles[entryIdx].close;
  if (entryPrice <= 0) return maxHorizon;

  let bestMFE = 0;
  let firstHitTime = maxHorizon;

  for (let j = entryIdx; j <= exitIdx; j++) {
    const favorable = direction === 'long'
      ? (candles[j].high - entryPrice) / entryPrice
      : (entryPrice - candles[j].low) / entryPrice;
    if (favorable > bestMFE) {
      bestMFE = favorable;
      firstHitTime = j - entryIdx;
    }
  }
  return firstHitTime;
}

// ═══════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════

function runFullAnalysis(candles, eventIndices, label, assetLabel) {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const results = {};

  if (eventIndices.length < 30) {
    return { status: 'REJECTED', reason: `Too few events: ${eventIndices.length}`, rawEvents: eventIndices.length };
  }

  // ── BASELINE (no friction, entry at signal candle close) ─────
  const baselineReturns = eventIndices.map(i => forwardReturn(candles, i, 0, 24)).filter(r => r !== null);
  const baseline = stats(baselineReturns);
  results.baseline = baseline;

  // ════════════════════════════════════════════════════════════════
  // T1: FRICTION SENSITIVITY
  // ════════════════════════════════════════════════════════════════
  results.friction = {};
  for (const sc of FRICTION_SCENARIOS) {
    // Total round-trip friction: entry fee + exit fee + entry slippage + exit slippage
    const roundTripFriction = 2 * sc.feeRate + 2 * sc.slippagePct;
    const frictionReturns = baselineReturns.map(r => r - roundTripFriction);
    results.friction[sc.name] = {
      roundTripCost: roundTripFriction,
      netStats: stats(frictionReturns),
      breakevenFee: baseline.mean > 0 ? baseline.mean / 2 : null, // fee per side that kills edge
    };
  }

  // ════════════════════════════════════════════════════════════════
  // T2: POSITION TIMING FLEXIBILITY
  // ════════════════════════════════════════════════════════════════
  results.timing = {};
  for (const delay of [0, 1, 2]) {
    const delayReturns = eventIndices.map(i => forwardReturn(candles, i, delay, 24)).filter(r => r !== null);
    const s = stats(delayReturns);
    results.timing[`+${delay}candle`] = s;
  }
  // Degradation ratio: (delayed mean) / (on-time mean)
  const onTimeMean = results.timing['+0candle'].mean;
  const delayed1Mean = results.timing['+1candle'].mean;
  const delayed2Mean = results.timing['+2candle'].mean;
  results.timing.degradation = {
    ratio1: onTimeMean !== 0 ? delayed1Mean / onTimeMean : 0,
    ratio2: onTimeMean !== 0 ? delayed2Mean / onTimeMean : 0,
    graceful: (onTimeMean > 0 && delayed1Mean > 0 && delayed2Mean > 0) ||
              (onTimeMean < 0 && delayed1Mean < 0 && delayed2Mean < 0),
  };

  // ════════════════════════════════════════════════════════════════
  // T3: HOLDING PERIOD OPTIMIZATION
  // ════════════════════════════════════════════════════════════════
  results.holdingPeriod = {};
  for (const horizon of [1, 4, 8, 12, 24]) {
    const rets = eventIndices.map(i => forwardReturn(candles, i, 0, horizon)).filter(r => r !== null);
    results.holdingPeriod[`${horizon}h`] = stats(rets);
  }

  // Time-to-MFE distribution
  const ttmfeValues = eventIndices.map(i => timeToMFE(candles, i, 48)).filter(v => v !== null);
  const ttmfeStats = stats(ttmfeValues);
  results.timeToMFE = {
    mean: ttmfeStats.mean,
    median: ttmfeStats.median,
    p25: percentile(ttmfeValues, 25),
    p75: percentile(ttmfeValues, 75),
    p90: percentile(ttmfeValues, 90),
    pctWithin4h: ttmfeValues.filter(v => v <= 4).length / ttmfeValues.length,
    pctWithin12h: ttmfeValues.filter(v => v <= 12).length / ttmfeValues.length,
    pctWithin24h: ttmfeValues.filter(v => v <= 24).length / ttmfeValues.length,
  };

  // Optimal horizon (highest expectancy)
  let bestHorizon = null;
  let bestMean = -Infinity;
  for (const [key, s] of Object.entries(results.holdingPeriod)) {
    if (s.mean > bestMean) { bestMean = s.mean; bestHorizon = key; }
  }
  results.optimalHorizon = { horizon: bestHorizon, mean: bestMean };

  // ════════════════════════════════════════════════════════════════
  // T4: REGIME DEPENDENCY QUANTIFICATION
  // ════════════════════════════════════════════════════════════════

  // Compute regime and ATR for breakdowns
  const atr = computeATR(candles, 14);
  const adx = computeADX(candles, 14);
  const { regimes } = detectRegimes(candles, atr, adx);

  // By year
  const years = {};
  for (const idx of eventIndices) {
    const year = new Date(candles[idx].timestamp).getUTCFullYear();
    if (!years[year]) years[year] = [];
    const r = forwardReturn(candles, idx, 0, 24);
    if (r !== null) years[year].push(r);
  }
  results.byYear = {};
  let yearsPositive = 0, yearsTotal = 0;
  for (const [y, rets] of Object.entries(years)) {
    const s = stats(rets);
    results.byYear[y] = s;
    yearsTotal++;
    if (s.mean > 0) yearsPositive++;
  }
  results.yearConsistency = yearsPositive / yearsTotal;

  // By regime
  const byRegime = {};
  for (const idx of eventIndices) {
    const reg = regimes[idx] || 'UNKNOWN';
    if (!byRegime[reg]) byRegime[reg] = [];
    const r = forwardReturn(candles, idx, 0, 24);
    if (r !== null) byRegime[reg].push(r);
  }
  results.byRegime = {};
  let regimesPositive = 0, regimesTotal = 0;
  for (const [reg, rets] of Object.entries(byRegime)) {
    if (rets.length >= 8) {
      const s = stats(rets);
      results.byRegime[reg] = s;
      regimesTotal++;
      if (s.mean > 0) regimesPositive++;
    }
  }
  results.regimeDependency = {
    regimesPositive,
    regimesTotal,
    ratio: regimesTotal > 0 ? regimesPositive / regimesTotal : 0,
    singleRegimeDependent: regimesTotal > 0 && regimesPositive === 1,
    dominantRegime: null,
  };
  // Find dominant regime
  let maxEvents = 0;
  for (const [reg, s] of Object.entries(results.byRegime)) {
    if (s.n > maxEvents) { maxEvents = s.n; results.regimeDependency.dominantRegime = reg; }
  }

  // ════════════════════════════════════════════════════════════════
  // T5: CAPITAL EFFICIENCY
  // ════════════════════════════════════════════════════════════════

  // Events per month
  const firstTs = candles[0].timestamp;
  const lastTs = candles[candles.length-1].timestamp;
  const monthsElapsed = (lastTs - firstTs) / (30.44 * 24 * 3600 * 1000);
  const eventsPerMonth = eventIndices.length / monthsElapsed;

  // Avg return per trade (24h horizon, with medium friction)
  const rtCost = 2 * 0.0007 + 2 * 0.0001;
  const netReturns = baselineReturns.map(r => r - rtCost);
  const netStats = stats(netReturns);

  // Capital lock-up: assuming 24h hold
  const avgLockupHours = results.timeToMFE.p75; // 75th percentile time to MFE

  results.capitalEfficiency = {
    eventsPerMonth: eventsPerMonth.toFixed(1),
    netExpectancyPerTrade: (netStats.mean * 100).toFixed(4) + '%',
    annualizedReturnEstimate: (netStats.mean * eventsPerMonth * 12 * 100).toFixed(2) + '%',
    avgLockupHours: avgLockupHours.toFixed(1),
    sharpeEstimate: netStats.std > 0 ? (netStats.mean / netStats.std * Math.sqrt(eventsPerMonth * 12)).toFixed(2) : 'N/A',
  };

  // ════════════════════════════════════════════════════════════════
  // T6: RISK STRUCTURE
  // ════════════════════════════════════════════════════════════════

  const maeValues = [];
  const mfeValues = [];
  const maeDistribution = [];
  for (const idx of eventIndices) {
    const { mae, mfe } = computeMAE_MFE(candles, idx, 48);
    maeValues.push(mae);
    mfeValues.push(mfe);
    maeDistribution.push({ mae, mfe, result: forwardReturn(candles, idx, 0, 24) });
  }

  const maeStats = stats(maeValues);
  const mfeStats = stats(mfeValues);

  // Tail risk: worst 1% and 5% MAE
  const worst1pctMAE = percentile(maeValues.map(v => Math.abs(v)), 99);
  const worst5pctMAE = percentile(maeValues.map(v => Math.abs(v)), 95);

  // Recovery probability: given MAE > X, what % eventually reach positive return?
  let recoveryAfterDeepDD = 0;
  let deepDDCount = 0;
  let recoveryAfterModDD = 0;
  let modDDCount = 0;
  for (const d of maeDistribution) {
    if (d.mae < -0.03) { deepDDCount++; if (d.result > 0) recoveryAfterDeepDD++; }
    if (d.mae < -0.015) { modDDCount++; if (d.result > 0) recoveryAfterModDD++; }
  }

  // Risk-reward ratio
  const avgWin = baselineReturns.filter(r => r > 0);
  const avgLoss = baselineReturns.filter(r => r <= 0);
  const avgWinMean = avgWin.length > 0 ? avgWin.reduce((s,v)=>s+v,0)/avgWin.length : 0;
  const avgLossMean = avgLoss.length > 0 ? Math.abs(avgLoss.reduce((s,v)=>s+v,0)/avgLoss.length) : 1;

  results.risk = {
    avgMAE: (maeStats.mean * 100).toFixed(2) + '%',
    avgMFE: (mfeStats.mean * 100).toFixed(2) + '%',
    worst1pctMAE: (worst1pctMAE * 100).toFixed(2) + '%',
    worst5pctMAE: (worst5pctMAE * 100).toFixed(2) + '%',
    riskRewardRatio: avgLossMean > 0 ? (avgWinMean / avgLossMean).toFixed(2) : 'N/A',
    recoveryFrom3pctDD: deepDDCount > 0 ? (recoveryAfterDeepDD/deepDDCount*100).toFixed(1)+'%' : 'N/A (no deep DD)',
    recoveryFromModDD: modDDCount > 0 ? (recoveryAfterModDD/modDDCount*100).toFixed(1)+'%' : 'N/A',
    deepDDCount,
    modDDCount,
    boundedRisk: worst1pctMAE < 0.10, // tail risk < 10%
  };

  // ════════════════════════════════════════════════════════════════
  // FINAL CLASSIFICATION
  // ════════════════════════════════════════════════════════════════

  const classification = classify(results, eventIndices.length, baseline);
  results.classification = classification;
  results.rawEvents = eventIndices.length;

  return results;
}

function classify(r, nEvents, baseline) {
  const flags = [];
  let score = 0;

  // 1. Baseline significance
  if (baseline.significant && baseline.mean > 0) { score += 2; }
  else { flags.push('Baseline not significant or negative'); }

  // 2. Friction survival (medium friction)
  const mediumFriction = r.friction['Medium friction'];
  if (mediumFriction.netStats.mean > 0 && mediumFriction.netStats.significant) { score += 2; }
  else if (mediumFriction.netStats.mean > 0) { score += 1; flags.push('Survives friction but not significant after friction'); }
  else { flags.push('Killed by medium friction'); }

  // 3. Timing flexibility
  if (r.timing.degradation.graceful && r.timing.degradation.ratio1 > 0.5) { score += 1; }
  else if (!r.timing.degradation.graceful) { flags.push('Timing inflexible: edge reverses with delay'); }
  else { flags.push('Edge degrades >50% with 1-candle delay'); }

  // 4. Regime independence
  if (r.regimeDependency.ratio >= 0.5) { score += 1; }
  else if (r.regimeDependency.singleRegimeDependent) { flags.push('Single-regime dependent'); }

  // 5. Year consistency
  if (r.yearConsistency >= 0.6) { score += 1; }
  else if (r.yearConsistency < 0.4) { flags.push('Negative in majority of years'); }

  // 6. Risk bounded
  if (r.risk.boundedRisk) { score += 1; }
  else { flags.push('Unbounded tail risk (>10% worst MAE)'); }

  // 7. Sample size
  if (nEvents >= 400) { score += 1; }
  else if (nEvents < 100) { flags.push('Very small sample'); score -= 1; }

  // Classification logic
  let classification;
  if (score >= 6) classification = 'ROBUST & EXTRACTABLE';
  else if (score >= 4) classification = 'REAL BUT FRAGILE';
  else if (score >= 2) classification = 'STATISTICAL BUT NOT TRADEABLE';
  else classification = 'REJECTED';

  return { classification, score, maxScore: 7, flags };
}

// ═══════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let report = `# 🔬 PHASE 2.7 — EDGE EXTRACTABILITY REPORT\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Method:** 6-test extractability analysis under realistic conditions\n`;
  report += `**Data:** Binance 1h candles, ${START_DATE.slice(0,10)} → ${END_DATE.slice(0,10)}\n\n`;
  report += `---\n\n`;

  // Summary table
  report += `## CLASSIFICATION SUMMARY\n\n`;
  report += `| Candidate | Events | Baseline 24h | Net (Med Friction) | Timing | Regimes+ | Years+ | Classification |\n`;
  report += `|-----------|--------|--------------|-------------------|--------|----------|--------|----------------|\n`;

  for (const { asset, edge, results: r } of allResults) {
    if (r.status === 'REJECTED') {
      report += `| ${asset} / ${edge} | ${r.rawEvents || 0} | — | — | — | — | — | ❌ REJECTED (${r.reason}) |\n`;
      continue;
    }
    const b = r.baseline;
    const mf = r.friction['Medium friction'].netStats;
    const tg = r.timing.degradation.graceful ? '✅' : '❌';
    const rr = r.regimeDependency.ratio;
    const yc = r.yearConsistency;
    const icon = r.classification.classification === 'ROBUST & EXTRACTABLE' ? '🟢' :
                 r.classification.classification === 'REAL BUT FRAGILE' ? '🟡' :
                 r.classification.classification === 'STATISTICAL BUT NOT TRADEABLE' ? '🟠' : '🔴';
    report += `| ${asset} / ${edge} | ${r.rawEvents} | ${(b.mean*100).toFixed(3)}% | ${(mf.mean*100).toFixed(3)}% | ${tg} | ${(rr*100).toFixed(0)}% | ${(yc*100).toFixed(0)}% | ${icon} ${r.classification.classification} |\n`;
  }

  report += `\n---\n\n`;

  // Detailed per-candidate
  for (const { asset, edge, results: r } of allResults) {
    if (r.status === 'REJECTED') continue;

    report += `## ${asset} — ${edge}\n\n`;
    report += `**Classification:** ${r.classification.classification} (score: ${r.classification.score}/${r.classification.maxScore})\n`;
    report += `**Events:** ${r.rawEvents}\n\n`;

    if (r.classification.flags.length > 0) {
      report += `**⚠️ Flags:**\n`;
      for (const f of r.classification.flags) report += `- ${f}\n`;
      report += `\n`;
    }

    // T1 Friction
    report += `### T1 — Friction Sensitivity\n\n`;
    report += `| Scenario | Round-trip Cost | Net Mean | Net t-stat | Breakeven Fee/side |\n`;
    report += `|----------|----------------|----------|------------|--------------------|\n`;
    for (const [name, f] of Object.entries(r.friction)) {
      const be = f.breakevenFee ? (f.breakevenFee*100).toFixed(4)+'%' : 'N/A';
      report += `| ${name} | ${(f.roundTripCost*100).toFixed(4)}% | ${(f.netStats.mean*100).toFixed(4)}% | ${f.netStats.tStat.toFixed(2)} | ${be} |\n`;
    }
    report += `\n`;

    // T2 Timing
    report += `### T2 — Position Timing Flexibility\n\n`;
    report += `| Delay | Mean Return | t-stat | Win Rate |\n`;
    report += `|-------|-------------|--------|----------|\n`;
    for (const [key, s] of Object.entries(r.timing)) {
      if (key === 'degradation') continue;
      report += `| ${key} | ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}% |\n`;
    }
    report += `\n`;
    report += `Degradation: +1 candle = ${(r.timing.degradation.ratio1*100).toFixed(0)}% of on-time | +2 candles = ${(r.timing.degradation.ratio2*100).toFixed(0)}% | Graceful: ${r.timing.degradation.graceful ? 'YES' : 'NO'}\n\n`;

    // T3 Holding
    report += `### T3 — Holding Period\n\n`;
    report += `| Horizon | Mean | t-stat | Win Rate |\n`;
    report += `|---------|------|--------|----------|\n`;
    for (const [key, s] of Object.entries(r.holdingPeriod)) {
      report += `| ${key} | ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}% |\n`;
    }
    report += `\nOptimal: ${r.optimalHorizon.horizon} (${(r.optimalHorizon.mean*100).toFixed(4)}%)\n\n`;
    report += `Time-to-MFE: mean=${r.timeToMFE.mean.toFixed(1)}h, median=${r.timeToMFE.median.toFixed(1)}h, p75=${r.timeToMFE.p75.toFixed(1)}h, p90=${r.timeToMFE.p90.toFixed(1)}h\n`;
    report += `MFE within 4h: ${(r.timeToMFE.pctWithin4h*100).toFixed(1)}% | 12h: ${(r.timeToMFE.pctWithin12h*100).toFixed(1)}% | 24h: ${(r.timeToMFE.pctWithin24h*100).toFixed(1)}%\n\n`;

    // T4 Regime
    report += `### T4 — Regime & Year Dependency\n\n`;
    report += `**By Year:**\n`;
    report += `| Year | Mean | t-stat | n | Win Rate |\n`;
    report += `|------|------|--------|---|----------|\n`;
    for (const [y, s] of Object.entries(r.byYear)) {
      report += `| ${y} | ${(s.mean*100).toFixed(3)}% | ${s.tStat.toFixed(2)} | ${s.n} | ${(s.pctPositive*100).toFixed(1)}% |\n`;
    }
    report += `\nYear consistency: ${(r.yearConsistency*100).toFixed(0)}% of years positive\n\n`;
    report += `**By Regime:**\n`;
    report += `| Regime | Mean | t-stat | n | Win Rate |\n`;
    report += `|--------|------|--------|---|----------|\n`;
    for (const [reg, s] of Object.entries(r.byRegime)) {
      report += `| ${reg} | ${(s.mean*100).toFixed(3)}% | ${s.tStat.toFixed(2)} | ${s.n} | ${(s.pctPositive*100).toFixed(1)}% |\n`;
    }
    report += `\nRegime independence: ${(r.regimeDependency.ratio*100).toFixed(0)}% of regimes positive`;
    if (r.regimeDependency.singleRegimeDependent) report += ` ⚠️ SINGLE REGIME DEPENDENT`;
    report += `\n\n`;

    // T5 Capital
    report += `### T5 — Capital Efficiency\n\n`;
    report += `- Events/month: ${r.capitalEfficiency.eventsPerMonth}\n`;
    report += `- Net expectancy/trade (med friction): ${r.capitalEfficiency.netExpectancyPerTrade}\n`;
    report += `- Annualized return estimate: ${r.capitalEfficiency.annualizedReturnEstimate}\n`;
    report += `- Avg lock-up (75th pct MFE): ${r.capitalEfficiency.avgLockupHours}h\n`;
    report += `- Sharpe estimate: ${r.capitalEfficiency.sharpeEstimate}\n\n`;

    // T6 Risk
    report += `### T6 — Risk Structure\n\n`;
    report += `- Avg MAE: ${r.risk.avgMAE} | Avg MFE: ${r.risk.avgMFE}\n`;
    report += `- Worst 1% MAE: ${r.risk.worst1pctMAE} | Worst 5% MAE: ${r.risk.worst5pctMAE}\n`;
    report += `- Risk/Reward ratio: ${r.risk.riskRewardRatio}\n`;
    report += `- Recovery after >3% DD: ${r.risk.recoveryFrom3pctDD} (${r.risk.deepDDCount} events)\n`;
    report += `- Recovery after >1.5% DD: ${r.risk.recoveryFromModDD} (${r.risk.modDDCount} events)\n`;
    report += `- Bounded risk: ${r.risk.boundedRisk ? 'YES' : 'NO'}\n\n`;

    report += `---\n\n`;
  }

  // Final verdict
  report += `## FINAL VERDICT\n\n`;
  const extractable = allResults.filter(a => a.results.classification?.classification === 'ROBUST & EXTRACTABLE');
  const fragile = allResults.filter(a => a.results.classification?.classification === 'REAL BUT FRAGILE');
  const notTradeable = allResults.filter(a => a.results.classification?.classification === 'STATISTICAL BUT NOT TRADEABLE');
  const rejected = allResults.filter(a => a.results.classification?.classification === 'REJECTED' || a.results.status === 'REJECTED');

  report += `### 🟢 ROBUST & EXTRACTABLE (${extractable.length})\n`;
  for (const a of extractable) report += `- **${a.asset} / ${a.edge}** — deployable under realistic conditions\n`;
  if (extractable.length === 0) report += `- None\n`;

  report += `\n### 🟡 REAL BUT FRAGILE (${fragile.length})\n`;
  for (const a of fragile) report += `- **${a.asset} / ${a.edge}** — real edge but fragile to conditions\n`;
  if (fragile.length === 0) report += `- None\n`;

  report += `\n### 🟠 STATISTICAL BUT NOT TRADEABLE (${notTradeable.length})\n`;
  for (const a of notTradeable) report += `- **${a.asset} / ${a.edge}** — statistically present but not extractable\n`;
  if (notTradeable.length === 0) report += `- None\n`;

  report += `\n### 🔴 REJECTED (${rejected.length})\n`;
  for (const a of rejected) report += `- **${a.asset} / ${a.edge}** — ${a.results.reason || a.results.classification?.flags?.join('; ') || 'failed tests'}\n`;
  if (rejected.length === 0) report += `- None\n`;

  return report;
}

// ═══════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════

async function fetchCandles(symbol) {
  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const since = new Date(START_DATE).getTime();
  const end = new Date(END_DATE).getTime();
  const all = [];
  let cursor = since;

  process.stdout.write(`  📥 Fetching ${symbol} ${TIMEFRAME}...`);
  while (cursor < end) {
    const candles = await exchange.fetchOHLCV(symbol, TIMEFRAME, cursor, 1000);
    if (!candles || !candles.length) break;
    all.push(...candles);
    cursor = candles[candles.length-1][0] + 1;
    await new Promise(r => setTimeout(r, exchange.rateLimit));
  }

  // Deduplicate + normalize
  const seen = new Set();
  const unique = [];
  for (const c of all) {
    if (!seen.has(c[0])) {
      seen.add(c[0]);
      unique.push({
        timestamp: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
      });
    }
  }
  const filtered = unique.filter(c => c.timestamp >= since && c.timestamp <= end);
  console.log(` ${filtered.length} candles ✅`);
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔬 PHASE 2.7 — EDGE EXTRACTABILITY ENGINE                      ║
║  6-test analysis: friction, timing, holding, regime, capital,   ║
║  risk structure → classify: extractable / fragile / rejected    ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults = [];

  // Edge definitions: { asset, edge name, detector fn, detector args selector }
  const edgeDefinitions = [
    { asset: 'SOL', edge: 'Higher-Low Uptrend', detector: 'higherLow', needs: ['atr', 'ema50'] },
    { asset: 'BTC', edge: 'Bullish Displacement', detector: 'displacementBull', needs: ['atr'] },
    { asset: 'ETH', edge: 'Bullish Displacement', detector: 'displacementBull', needs: ['atr'] },
    { asset: 'SOL', edge: 'Stop-Run Continuation', detector: 'stopRunTrendUp', needs: ['atr', 'regimes'] },
    { asset: 'XRP', edge: 'Post-Bear Volume Surge', detector: 'postBearVolSurge', needs: ['volSMA', 'volStd'] },
  ];

  // Pre-load all data
  const dataCache = {};
  const assetSymbols = {
    'SOL': 'SOL/USDT:USDT',
    'BTC': 'BTC/USDT:USDT',
    'ETH': 'ETH/USDT:USDT',
    'XRP': 'XRP/USDT:USDT',
  };

  for (const label of Object.keys(assetSymbols)) {
    if (!dataCache[label]) {
      const candles = await fetchCandles(assetSymbols[label]);
      const closes = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume);

      const atr = computeATR(candles, 14);
      const adx = computeADX(candles, 14);
      const ema50 = computeEMA(closes, 50);
      const { regimes } = detectRegimes(candles, atr, adx);
      const volSMA = computeSMA(volumes, 20);
      const volStd = computeStdDev(volumes, 20);

      dataCache[label] = { candles, atr, adx, ema50, regimes, volSMA, volStd };
    }
  }

  // Run each edge
  for (const def of edgeDefinitions) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔍 ${def.asset} — ${def.edge}`);
    console.log(`${'═'.repeat(60)}`);

    const data = dataCache[def.asset];
    let events;

    try {
      switch (def.detector) {
        case 'higherLow':
          events = detectHigherLow(data.candles, data.atr, data.ema50);
          break;
        case 'displacementBull':
          events = detectDisplacementBullish(data.candles, data.atr);
          break;
        case 'stopRunTrendUp':
          events = detectStopRunTrendingUp(data.candles, data.atr, data.regimes);
          break;
        case 'postBearVolSurge':
          events = detectPostBearVolumeSurge(data.candles, data.volSMA, data.volStd);
          break;
      }

      console.log(`  Events detected: ${events.length}`);

      if (events.length < 30) {
        console.log(`  ❌ REJECTED — too few events (${events.length})`);
        allResults.push({ asset: def.asset, edge: def.edge, results: { status: 'REJECTED', reason: `Too few events: ${events.length}`, rawEvents: events.length } });
        continue;
      }

      const results = runFullAnalysis(data.candles, events, def.edge, def.asset);
      allResults.push({ asset: def.asset, edge: def.edge, results });

      // Print summary
      console.log(`  📊 Baseline 24h: mean=${(results.baseline.mean*100).toFixed(4)}% t=${results.baseline.tStat.toFixed(2)} +rate=${(results.baseline.pctPositive*100).toFixed(1)}%`);
      console.log(`  💰 Net (med friction): ${(results.friction['Medium friction'].netStats.mean*100).toFixed(4)}%`);
      console.log(`  ⏱️  Timing: +1c=${(results.timing['+1candle'].mean*100).toFixed(4)}% +2c=${(results.timing['+2candle'].mean*100).toFixed(4)}% graceful=${results.timing.degradation.graceful}`);
      console.log(`  🌍 Regimes+: ${(results.regimeDependency.ratio*100).toFixed(0)}% | Years+: ${(results.yearConsistency*100).toFixed(0)}%`);
      console.log(`  📈 Capital: ${results.capitalEfficiency.eventsPerMonth}/mo | annualized: ${results.capitalEfficiency.annualizedReturnEstimate}`);
      console.log(`  ⚠️  Risk: worst1%=${results.risk.worst1pctMAE} R:R=${results.risk.riskRewardRatio}`);
      console.log(`  🏷️  CLASSIFICATION: ${results.classification.classification} (score: ${results.classification.score}/${results.classification.maxScore})`);
      if (results.classification.flags.length > 0) {
        for (const f of results.classification.flags) console.log(`     ⚠️  ${f}`);
      }

    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      console.error(err.stack);
      allResults.push({ asset: def.asset, edge: def.edge, results: { status: 'REJECTED', reason: err.message } });
    }
  }

  // Generate report
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  📝 GENERATING REPORT`);
  console.log(`${'═'.repeat(60)}`);

  const report = generateReport(allResults);

  const reportPath = path.join(__dirname, 'EXTRACTABILITY_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report saved to: ${reportPath}`);

  // Also save raw JSON
  const rawPath = path.join(__dirname, 'extractability-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw data saved to: ${rawPath}`);

  // Print final summary
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  🏆 FINAL CLASSIFICATIONS`);
  console.log(`${'═'.repeat(60)}\n`);

  for (const a of allResults) {
    const r = a.results;
    if (r.status === 'REJECTED') {
      console.log(`  🔴 ${a.asset} / ${a.edge} — REJECTED (${r.reason})`);
    } else {
      const icon = r.classification.classification === 'ROBUST & EXTRACTABLE' ? '🟢' :
                   r.classification.classification === 'REAL BUT FRAGILE' ? '🟡' :
                   r.classification.classification === 'STATISTICAL BUT NOT TRADEABLE' ? '🟠' : '🔴';
      console.log(`  ${icon} ${a.asset} / ${a.edge} — ${r.classification.classification} (score: ${r.classification.score}/${r.classification.maxScore})`);
      if (r.classification.flags.length > 0) {
        for (const f of r.classification.flags) console.log(`     ⚠️  ${f}`);
      }
    }
  }

  console.log(`\n  Done.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
