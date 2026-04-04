// ═══════════════════════════════════════════════════════════════════
// PHASE 3 — EXECUTION VALIDATION (RISK OVERLAY TEST)
// ═══════════════════════════════════════════════════════════════════
//
// FIXED FRAMEWORK (NO TUNING):
//   Entry:      signal close (+0) and +1 candle
//   Stop:       2× ATR (hard, non-negotiable)
//   Trailing:   activate at +1× ATR, trail at 1.5× ATR
//   Max hold:   24h hard exit
//   Risk:       1% of capital per trade (position sized by stop distance)
//
// EDGES TESTED:
//   1. BTC — Bullish Displacement
//   2. ETH — Bullish Displacement
//   3. SOL — Higher-Low Uptrend
//
// NO parameter tuning. NO per-asset customization.
// If it fails, it fails.
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCHANGE = 'binance';
const TIMEFRAME = '1h';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:00Z';

// FIXED FRAMEWORK — DO NOT CHANGE
const FRAMEWORK = {
  atrPeriod: 14,
  stopATRMult: 2.0,        // stop = entry - 2×ATR
  trailActivateATR: 1.0,   // trail activates at +1×ATR
  trailDistanceATR: 1.5,    // trail follows at 1.5×ATR behind peak
  maxHoldCandles: 24,       // 24h hard exit
  riskPerTrade: 0.01,       // 1% capital risked per trade
  feeRate: 0.0007,          // per side (medium friction from Phase 2.7)
  slippageRate: 0.0001,     // per side
};

// ═══════════════════════════════════════════════════════════════════
// INDICATORS
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
  const bbStdArr = new Array(n).fill(null);
  for (let i = 19; i < n; i++) {
    let s=0; for (let j=i-19;j<=i;j++) s+=closes[j]; const m=s/20;
    let sq=0; for (let j=i-19;j<=i;j++) sq+=(closes[j]-m)**2;
    bbStdArr[i] = Math.sqrt(sq/20);
  }
  const bbWidth = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (bbSma[i]!==null && bbStdArr[i]!==null && closes[i]>0) bbWidth[i] = (2*2*bbStdArr[i])/closes[i];
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
  return { regimes, atrZ };
}

// ═══════════════════════════════════════════════════════════════════
// EDGE DETECTORS
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

// ═══════════════════════════════════════════════════════════════════
// TRADE SIMULATOR — Risk Overlay
// ═══════════════════════════════════════════════════════════════════

/**
 * Simulate a single trade with the fixed risk overlay.
 *
 * @param {Array} candles - full candle array
 * @param {number} signalIdx - index of signal candle
 * @param {number} entryOffset - 0 (at signal close) or 1 (+1 candle)
 * @param {number} atrValue - ATR at signal candle
 * @param {number} capital - current capital
 * @returns {Object} trade result
 */
function simulateTrade(candles, signalIdx, entryOffset, atrValue, capital) {
  const entryIdx = signalIdx + entryOffset;
  if (entryIdx >= candles.length - 1) return null;

  // Entry price = close of entry candle + slippage
  const rawEntry = candles[entryIdx].close;
  const slippage = rawEntry * FRAMEWORK.slippageRate;
  const entryPrice = rawEntry + slippage; // buy at slightly worse price
  const entryFee = entryPrice * FRAMEWORK.feeRate;

  // Stop distance = 2×ATR
  const stopDist = atrValue * FRAMEWORK.stopATRMult;
  const initialStop = entryPrice - stopDist;

  // Position sizing: risk 1% of capital, stop defines max loss
  // risk = position_size × stop_distance
  // position_size = (capital × risk%) / stop_distance
  const riskAmount = capital * FRAMEWORK.riskPerTrade;
  if (stopDist <= 0) return null;
  const positionSize = riskAmount / stopDist; // in units of the asset

  // Trailing state
  let trailingActive = false;
  let trailStop = initialStop;
  let peakPrice = entryPrice;
  const trailActivateDist = atrValue * FRAMEWORK.trailActivateATR;
  const trailDistance = atrValue * FRAMEWORK.trailDistanceATR;

  const maxHold = FRAMEWORK.maxHoldCandles;
  const exitIdx = Math.min(entryIdx + maxHold, candles.length - 1);

  let exitPrice = null;
  let exitReason = null;
  let exitTime = null;

  // Walk through each candle after entry
  for (let j = entryIdx + 1; j <= exitIdx; j++) {
    const candle = candles[j];
    const low = candle.low;
    const high = candle.high;

    // Update peak
    if (high > peakPrice) {
      peakPrice = high;

      // Check if trailing should activate
      if (!trailingActive && (peakPrice - entryPrice) >= trailActivateDist) {
        trailingActive = true;
      }
    }

    // Update trailing stop
    if (trailingActive) {
      const newTrail = peakPrice - trailDistance;
      if (newTrail > trailStop) {
        trailStop = newTrail;
      }
    }

    // Check stop hit (initial or trailing)
    if (low <= trailStop) {
      // Stop was hit within this candle
      // Assume we exit at the stop price (best case) or at the low (worst case)
      // Conservative: exit at stop price (limit order fills between low and stop)
      exitPrice = trailStop;
      exitReason = trailingActive ? 'trailing_stop' : 'hard_stop';
      exitTime = j;
      break;
    }

    // Max holding time
    if (j === exitIdx) {
      exitPrice = candle.close;
      exitReason = 'time_exit';
      exitTime = j;
    }
  }

  if (exitPrice === null) return null;

  // Apply exit slippage and fee
  const exitSlippage = exitPrice * FRAMEWORK.slippageRate;
  const finalExitPrice = exitPrice - exitSlippage; // sell at slightly worse price
  const exitFee = finalExitPrice * FRAMEWORK.feeRate;

  // P&L calculation
  const pnlPerUnit = finalExitPrice - entryPrice;
  const grossPnL = pnlPerUnit * positionSize;
  const totalFees = (entryFee + exitFee) * positionSize;
  const netPnL = grossPnL - totalFees;
  const pnlPct = netPnL / capital; // as % of capital
  const holdCandles = exitTime - entryIdx;

  // Raw (no-stop) comparison: what would happen with 24h hold, no stops
  const rawExitIdx = exitIdx;
  const rawExit = candles[rawExitIdx].close;
  const rawReturn = (rawExit - entryPrice) / entryPrice;
  const rawMAE = computeRawMAE(candles, entryIdx, rawExitIdx);

  return {
    signalIdx,
    entryIdx,
    entryPrice,
    initialStop,
    atrValue,
    stopDist,
    positionSize,
    capital,
    exitPrice: finalExitPrice,
    exitReason,
    exitTime,
    holdCandles,
    netPnL,
    pnlPct,
    totalFees,
    trailingActive,
    peakPrice,
    rawReturn,
    rawMAE,
  };
}

function computeRawMAE(candles, entryIdx, exitIdx) {
  const entryPrice = candles[entryIdx].close;
  let worstMAE = 0;
  for (let j = entryIdx + 1; j <= exitIdx && j < candles.length; j++) {
    const adverse = (candles[j].low - entryPrice) / entryPrice;
    if (adverse < worstMAE) worstMAE = adverse;
  }
  return worstMAE;
}

// ═══════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════

function stats(arr) {
  const v = arr.filter(x => x!==null && !isNaN(x) && isFinite(x));
  if (v.length < 3) return { n: v.length, mean: 0, median: 0, std: 0, pctPositive: 0, tStat: 0 };
  const n = v.length;
  const mean = v.reduce((s,x)=>s+x,0)/n;
  const sorted = [...v].sort((a,b)=>a-b);
  const median = sorted[Math.floor(n/2)];
  const pos = v.filter(r=>r>0).length;
  let m2=0;
  for (const x of v) { const d=x-mean; m2+=d*d; }
  m2/=n;
  const std = Math.sqrt(m2);
  const t = std>0 ? mean/(std/Math.sqrt(n)) : 0;
  return { n, mean, median, std, pctPositive: pos/n, tStat: t, min: sorted[0], max: sorted[n-1] };
}

function percentile(arr, p) {
  const sorted = [...arr].filter(x=>x!==null && isFinite(x)).sort((a,b)=>a-b);
  if (sorted.length===0) return 0;
  const idx = Math.floor(p/100 * sorted.length);
  return sorted[Math.min(idx, sorted.length-1)];
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════

function runRiskOverlayTest(candles, eventIndices, label, atr) {
  const results = {};
  const startingCapital = 10000;

  for (const entryMode of ['on_signal', 'plus_one_candle']) {
    const entryOffset = entryMode === 'on_signal' ? 0 : 1;
    const trades = [];
    let capital = startingCapital;

    for (const idx of eventIndices) {
      if (atr[idx] === null) continue;
      const trade = simulateTrade(candles, idx, entryOffset, atr[idx], capital);
      if (trade) {
        trades.push(trade);
        capital += trade.netPnL;
        if (capital < 0) capital = 0; // blown up
      }
    }

    if (trades.length < 10) {
      results[entryMode] = { status: 'INSUFFICIENT_DATA', trades: trades.length };
      continue;
    }

    // Core metrics
    const pnls = trades.map(t => t.netPnL);
    const pnlPcts = trades.map(t => t.pnlPct);
    const rawReturns = trades.map(t => t.rawReturn);
    const rawMAEs = trades.map(t => t.rawMAE);

    const pnlStats = stats(pnls);
    const pnlPctStats = stats(pnlPcts);
    const rawReturnStats = stats(rawReturns);

    // Win rate
    const wins = trades.filter(t => t.netPnL > 0);
    const losses = trades.filter(t => t.netPnL <= 0);
    const winRate = wins.length / trades.length;

    // Profit factor
    const grossProfit = wins.reduce((s,t) => s + t.netPnL, 0);
    const grossLoss = Math.abs(losses.reduce((s,t) => s + t.netPnL, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    // Max drawdown
    let peak = startingCapital;
    let maxDD = 0;
    let maxDDPct = 0;
    let bal = startingCapital;
    const equityCurve = [startingCapital];
    for (const t of trades) {
      bal += t.netPnL;
      if (bal > peak) peak = bal;
      const dd = peak - bal;
      const ddPct = dd / peak;
      if (dd > maxDD) maxDD = dd;
      if (ddPct > maxDDPct) maxDDPct = ddPct;
      equityCurve.push(bal);
    }

    // Exit analysis
    const exitReasons = {};
    for (const t of trades) {
      if (!exitReasons[t.exitReason]) exitReasons[t.exitReason] = { count: 0, pnl: 0, wins: 0 };
      exitReasons[t.exitReason].count++;
      exitReasons[t.exitReason].pnl += t.netPnL;
      if (t.netPnL > 0) exitReasons[t.exitReason].wins++;
    }

    // Trailing activation rate
    const trailingActivated = trades.filter(t => t.trailingActive).length;

    // Stop impact: compare raw MAE distribution to stopped PnL
    const rawWorst1pct = percentile(rawMAEs.map(v => Math.abs(v)), 99);
    const rawWorst5pct = percentile(rawMAEs.map(v => Math.abs(v)), 95);
    const stoppedLosses = losses.map(t => Math.abs(t.pnlPct));
    const stoppedWorst1pct = stoppedLosses.length > 0 ? percentile(stoppedLosses, 99) : 0;
    const stoppedWorst5pct = stoppedLosses.length > 0 ? percentile(stoppedLosses, 95) : 0;

    // Path transformation
    const stoppedBeforeRecovery = losses.filter(t => t.exitReason === 'hard_stop').length;
    const protectedFromCatastrophe = trades.filter(t =>
      t.rawMAE < -0.05 && t.exitReason !== 'time_exit' && t.pnlPct > t.rawMAE
    ).length;

    // Holding time
    const holdTimes = trades.map(t => t.holdCandles);
    const holdStats = stats(holdTimes);

    // Monthly PnL
    const monthlyPnL = {};
    for (const t of trades) {
      const d = new Date(candles[t.entryIdx].timestamp);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      if (!monthlyPnL[key]) monthlyPnL[key] = 0;
      monthlyPnL[key] += t.netPnL;
    }
    const monthlyValues = Object.values(monthlyPnL);
    const profitableMonths = monthlyValues.filter(v => v > 0).length;

    results[entryMode] = {
      status: 'COMPLETE',
      trades: trades.length,
      startingCapital,
      finalCapital: capital,
      totalReturn: ((capital - startingCapital) / startingCapital * 100).toFixed(2) + '%',
      pnlStats,
      winRate: (winRate * 100).toFixed(1) + '%',
      profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
      maxDrawdown: (maxDDPct * 100).toFixed(2) + '%',
      maxDrawdownAbs: maxDD.toFixed(2),
      avgWin: wins.length > 0 ? (wins.reduce((s,t)=>s+t.netPnL,0)/wins.length).toFixed(2) : 0,
      avgLoss: losses.length > 0 ? (losses.reduce((s,t)=>s+t.netPnL,0)/losses.length).toFixed(2) : 0,
      avgHoldHours: holdStats.mean.toFixed(1),
      trailingActivationRate: (trailingActivated / trades.length * 100).toFixed(1) + '%',

      // Exit breakdown
      exitBreakdown: Object.fromEntries(
        Object.entries(exitReasons).map(([k,v]) => [k, {
          count: v.count,
          pct: (v.count/trades.length*100).toFixed(1)+'%',
          totalPnL: v.pnl.toFixed(2),
          winRate: (v.wins/v.count*100).toFixed(1)+'%',
        }])
      ),

      // Tail risk reduction
      tailRisk: {
        rawWorst1pctMAE: (rawWorst1pct * 100).toFixed(2) + '%',
        rawWorst5pctMAE: (rawWorst5pct * 100).toFixed(2) + '%',
        stoppedWorst1pctLoss: (stoppedWorst1pct * 100).toFixed(2) + '%',
        stoppedWorst5pctLoss: (stoppedWorst5pct * 100).toFixed(2) + '%',
        tailReduction: rawWorst1pct > 0 ? ((1 - stoppedWorst1pct / rawWorst1pct) * 100).toFixed(1) + '%' : 'N/A',
      },

      // Path transformation
      pathTransformation: {
        stoppedBeforeRecovery,
        protectedFromCatastrophe,
        pctStoppedHard: (stoppedBeforeRecovery / trades.length * 100).toFixed(1) + '%',
        pctProtected: (protectedFromCatastrophe / trades.length * 100).toFixed(1) + '%',
      },

      // Monthly
      monthly: {
        totalMonths: monthlyValues.length,
        profitableMonths,
        profitablePct: (profitableMonths / monthlyValues.length * 100).toFixed(0) + '%',
        avgMonthly: monthlyValues.length > 0 ? (monthlyValues.reduce((s,v)=>s+v,0)/monthlyValues.length).toFixed(2) : 0,
        worstMonth: monthlyValues.length > 0 ? Math.min(...monthlyValues).toFixed(2) : 0,
        bestMonth: monthlyValues.length > 0 ? Math.max(...monthlyValues).toFixed(2) : 0,
      },

      // Raw comparison
      rawComparison: {
        rawMeanReturn: (rawReturnStats.mean * 100).toFixed(4) + '%',
        rawWinRate: (rawReturns.filter(r => r > 0).length / rawReturns.length * 100).toFixed(1) + '%',
        stoppedMeanPnlPct: (pnlPctStats.mean * 100).toFixed(4) + '%',
      },

      equityCurve,
      trades: trades.map(t => ({
        signal: t.signalIdx,
        entry: t.entryPrice.toFixed(4),
        stop: t.initialStop.toFixed(4),
        exit: t.exitPrice.toFixed(4),
        reason: t.exitReason,
        pnl: t.netPnL.toFixed(2),
        holdH: t.holdCandles,
        trailing: t.trailingActive,
        rawMAE: (t.rawMAE * 100).toFixed(2) + '%',
      })),
    };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

function classifyEdge(onSignal, plusOne) {
  const flags = [];
  let verdict;

  // Primary: does on_signal survive?
  if (!onSignal || onSignal.status !== 'COMPLETE') {
    return { verdict: 'REJECTED', reason: 'Insufficient data', flags: [] };
  }

  // 1. Positive expectancy?
  const positive = onSignal.pnlStats.mean > 0;

  // 2. Profit factor
  const pf = parseFloat(onSignal.profitFactor) || 0;
    const goodPF = pf >= 1.0;

  // 3. Max drawdown bounded
  const ddPct = parseFloat(onSignal.maxDrawdown);
  const boundedDD = ddPct < 20; // less than 20% max DD

  // 4. Tail risk controlled
  const worst1 = parseFloat(onSignal.tailRisk.stoppedWorst1pctLoss);
  const tailControlled = worst1 < 5; // worst 1% loss < 5%

  // 5. Robustness: +1 candle doesn't collapse
  let robustExecution = true;
  if (plusOne && plusOne.status === 'COMPLETE') {
    const onSignalMean = onSignal.pnlStats.mean;
    const plusOneMean = plusOne.pnlStats.mean;
    // Degraded but still positive = OK. Collapsed to negative = bad.
    if (onSignalMean > 0 && plusOneMean < 0) {
      robustExecution = false;
      flags.push('Edge reverses with +1 candle entry');
    }
    if (onSignalMean > 0 && plusOneMean > 0 && plusOneMean < onSignalMean * 0.3) {
      flags.push('Severe degradation with +1 candle (>70% loss of edge)');
    }
  }

  // Classification
  if (positive && goodPF && boundedDD && tailControlled && robustExecution) {
    verdict = 'SURVIVES';
  } else if (positive && goodPF && (!boundedDD || !tailControlled)) {
    verdict = 'DEGRADED';
    if (!boundedDD) flags.push('Drawdown exceeds 20%');
    if (!tailControlled) flags.push('Worst 1% loss exceeds 5% after stops');
  } else if (positive && !goodPF) {
    verdict = 'DEGRADED';
    flags.push('Profit factor below 1.0');
  } else {
    verdict = 'DESTROYED';
    if (!positive) flags.push('Negative expectancy after stops');
    if (!robustExecution) flags.push('Execution-dependent');
  }

  // Final decision
  const extractable = verdict === 'SURVIVES';

  return {
    verdict,
    extractable,
    flags,
    metrics: {
      positive,
      goodPF,
      boundedDD,
      tailControlled,
      robustExecution,
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let report = `# 🔴 PHASE 3 — EXECUTION VALIDATION (RISK OVERLAY)\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Framework:** FIXED — Stop 2×ATR, Trail activate 1×ATR, Trail dist 1.5×ATR, Max hold 24h\n`;
  report += `**Constraint:** NO parameter tuning. NO per-asset customization.\n`;
  report += `**Data:** Binance 1h, ${START_DATE.slice(0,10)} → ${END_DATE.slice(0,10)}\n\n`;
  report += `---\n\n`;

  // Summary
  report += `## CLASSIFICATION SUMMARY\n\n`;
  report += `| Edge | On Signal PF | +1 Candle PF | Max DD | Tail 1% | Verdict |\n`;
  report += `|------|-------------|-------------|--------|---------|---------|\n`;

  for (const r of allResults) {
    const os = r.results.on_signal;
    const p1 = r.results.plus_one_candle;
    const osPF = os.status === 'COMPLETE' ? os.profitFactor : '—';
    const p1PF = p1.status === 'COMPLETE' ? p1.profitFactor : '—';
    const dd = os.status === 'COMPLETE' ? os.maxDrawdown : '—';
    const tail = os.status === 'COMPLETE' ? os.tailRisk.stoppedWorst1pctLoss : '—';
    const icon = r.classification.verdict === 'SURVIVES' ? '🟢' :
                 r.classification.verdict === 'DEGRADED' ? '🟡' : '🔴';
    report += `| ${r.asset} ${r.edge} | ${osPF} | ${p1PF} | ${dd} | ${tail} | ${icon} ${r.classification.verdict} |\n`;
  }

  report += `\n---\n\n`;

  // Detailed per edge
  for (const r of allResults) {
    report += `## ${r.asset} — ${r.edge}\n\n`;
    report += `**Verdict:** ${r.classification.verdict} ${r.classification.extractable ? '→ ELIGIBLE FOR MODEL BUILDING' : '→ REJECT'}\n\n`;

    if (r.classification.flags.length > 0) {
      report += `**Flags:**\n`;
      for (const f of r.classification.flags) report += `- ${f}\n`;
      report += `\n`;
    }

    for (const mode of ['on_signal', 'plus_one_candle']) {
      const d = r.results[mode];
      if (d.status !== 'COMPLETE') continue;

      report += `### Entry: ${mode === 'on_signal' ? 'At Signal Close' : '+1 Candle'}\n\n`;
      report += `**Performance:**\n`;
      report += `- Trades: ${d.trades}\n`;
      report += `- Total return: ${d.totalReturn} (${d.startingCapital} → ${d.finalCapital.toFixed(2)})\n`;
      report += `- Net expectancy/trade: $${d.pnlStats.mean.toFixed(2)} (${d.rawComparison.stoppedMeanPnlPct})\n`;
      report += `- Win rate: ${d.winRate}\n`;
      report += `- Profit factor: ${d.profitFactor}\n`;
      report += `- Avg win: $${d.avgWin} | Avg loss: $${d.avgLoss}\n`;
      report += `- Max drawdown: ${d.maxDrawdown} ($${d.maxDrawdownAbs})\n`;
      report += `- Avg hold: ${d.avgHoldHours}h\n`;
      report += `- Trailing activation rate: ${d.trailingActivationRate}\n\n`;

      report += `**Exit Breakdown:**\n`;
      report += `| Exit | Count | % | PnL | Win Rate |\n`;
      report += `|------|-------|---|-----|----------|\n`;
      for (const [reason, ex] of Object.entries(d.exitBreakdown)) {
        report += `| ${reason} | ${ex.count} | ${ex.pct} | $${ex.totalPnL} | ${ex.winRate} |\n`;
      }
      report += `\n`;

      report += `**Tail Risk (with stops):**\n`;
      report += `- Raw worst 1% MAE (no stops): ${d.tailRisk.rawWorst1pctMAE}\n`;
      report += `- Stopped worst 1% loss: ${d.tailRisk.stoppedWorst1pctLoss}\n`;
      report += `- Tail reduction: ${d.tailRisk.tailReduction}\n`;
      report += `- Raw worst 5% MAE: ${d.tailRisk.rawWorst5pctMAE}\n`;
      report += `- Stopped worst 5% loss: ${d.tailRisk.stoppedWorst5pctLoss}\n\n`;

      report += `**Path Transformation:**\n`;
      report += `- Stopped out (hard stop): ${d.pathTransformation.stoppedBeforeRecovery} (${d.pathTransformation.pctStoppedHard})\n`;
      report += `- Protected from catastrophic loss: ${d.pathTransformation.protectedFromCatastrophe} (${d.pathTransformation.pctProtected})\n\n`;

      report += `**Monthly Distribution:**\n`;
      report += `- Months: ${d.monthly.totalMonths}\n`;
      report += `- Profitable: ${d.monthly.profitableMonths} (${d.monthly.profitablePct})\n`;
      report += `- Avg monthly: $${d.monthly.avgMonthly}\n`;
      report += `- Best month: $${d.monthly.bestMonth}\n`;
      report += `- Worst month: $${d.monthly.worstMonth}\n\n`;

      report += `**Raw vs Stopped Comparison:**\n`;
      report += `- Raw mean 24h return: ${d.rawComparison.rawMeanReturn}\n`;
      report += `- Raw win rate: ${d.rawComparison.rawWinRate}\n`;
      report += `- Stopped mean PnL%: ${d.rawComparison.stoppedMeanPnlPct}\n\n`;
    }

    // Diagnosis
    report += `### Execution Diagnosis\n\n`;
    const os = r.results.on_signal;
    if (os.status === 'COMPLETE') {
      const trailRate = parseFloat(os.trailingActivationRate);
      const hardStopRate = os.exitBreakdown.hard_stop
        ? parseFloat(os.exitBreakdown.hard_stop.pct) : 0;

      if (trailRate > 60) {
        report += `Trailing activates in ${os.trailingActivationRate} of trades — edge has enough momentum for the trail system to capture gains.\n`;
      } else if (trailRate > 30) {
        report += `Trailing activates in only ${os.trailingActivationRate} — many trades don't reach +1×ATR before reversing.\n`;
      } else {
        report += `Trailing rarely activates (${os.trailingActivationRate}) — edge may be mean-reverting rather than trending.\n`;
      }

      if (hardStopRate > 30) {
        report += `${hardStopRate} hit the hard stop — the 2×ATR stop is too tight for this edge's volatility profile.\n`;
      }
    }
    report += `\n---\n\n`;
  }

  // Final verdict
  report += `## FINAL DECISION\n\n`;
  const survivors = allResults.filter(r => r.classification.verdict === 'SURVIVES');
  const degraded = allResults.filter(r => r.classification.verdict === 'DEGRADED');
  const destroyed = allResults.filter(r => r.classification.verdict === 'DESTROYED');

  report += `### 🟢 CASE A — EXTRACTABLE (${survivors.length})\n`;
  for (const r of survivors) report += `- **${r.asset} / ${r.edge}** — survives stop system, positive expectancy, tail risk controlled\n`;
  if (survivors.length === 0) report += `- None\n`;

  report += `\n### 🟡 DEGRADED BUT POTENTIALLY USABLE (${degraded.length})\n`;
  for (const r of degraded) report += `- **${r.asset} / ${r.edge}** — ${r.classification.flags.join('; ')}\n`;
  if (degraded.length === 0) report += `- None\n`;

  report += `\n### 🔴 CASE B — NON-EXTRACTABLE (${destroyed.length})\n`;
  for (const r of destroyed) report += `- **${r.asset} / ${r.edge}** — ${r.classification.flags.join('; ') || 'stops destroy expectancy'}\n`;
  if (destroyed.length === 0) report += `- None\n`;

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
  process.stdout.write(`  📥 ${symbol}...`);
  while (cursor < end) {
    const candles = await exchange.fetchOHLCV(symbol, TIMEFRAME, cursor, 1000);
    if (!candles || !candles.length) break;
    all.push(...candles);
    cursor = candles[candles.length-1][0] + 1;
    await new Promise(r => setTimeout(r, exchange.rateLimit));
  }
  const seen = new Set();
  const unique = [];
  for (const c of all) {
    if (!seen.has(c[0])) {
      seen.add(c[0]);
      unique.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
    }
  }
  console.log(` ${unique.length} candles ✅`);
  return unique.filter(c => c.timestamp >= since && c.timestamp <= end);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔴 PHASE 3 — EXECUTION VALIDATION (RISK OVERLAY TEST)          ║
║  Fixed framework: Stop 2×ATR, Trail 1×/1.5×ATR, Max 24h       ║
║  NO tuning. NO customization. If it fails, it fails.           ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const edges = [
    { asset: 'BTC', edge: 'Bullish Displacement', detector: 'displacement' },
    { asset: 'ETH', edge: 'Bullish Displacement', detector: 'displacement' },
    { asset: 'SOL', edge: 'Higher-Low Uptrend', detector: 'higherLow' },
  ];

  const assetSymbols = {
    'SOL': 'SOL/USDT:USDT', 'BTC': 'BTC/USDT:USDT',
    'ETH': 'ETH/USDT:USDT', 'XRP': 'XRP/USDT:USDT',
  };

  const dataCache = {};
  const allResults = [];

  for (const def of edges) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔍 ${def.asset} — ${def.edge}`);
    console.log(`${'═'.repeat(60)}`);

    // Load data if needed
    if (!dataCache[def.asset]) {
      const candles = await fetchCandles(assetSymbols[def.asset]);
      const closes = candles.map(c => c.close);
      const atr = computeATR(candles, FRAMEWORK.atrPeriod);
      const adx = computeADX(candles, FRAMEWORK.atrPeriod);
      const ema50 = computeEMA(closes, 50);
      const { regimes } = detectRegimes(candles, atr, adx);
      dataCache[def.asset] = { candles, atr, adx, ema50, regimes };
    }

    const data = dataCache[def.asset];
    let events;

    // Detect events
    switch (def.detector) {
      case 'displacement':
        events = detectDisplacementBullish(data.candles, data.atr);
        break;
      case 'higherLow':
        events = detectHigherLow(data.candles, data.atr, data.ema50);
        break;
    }

    console.log(`  Events: ${events.length}`);

    if (events.length < 10) {
      console.log(`  ❌ Too few events`);
      allResults.push({ asset: def.asset, edge: def.edge, results: {}, classification: { verdict: 'REJECTED', flags: ['Too few events'], extractable: false } });
      continue;
    }

    // Run risk overlay test
    const results = runRiskOverlayTest(data.candles, events, def.edge, data.atr);
    const classification = classifyEdge(results.on_signal, results.plus_one_candle);

    allResults.push({ asset: def.asset, edge: def.edge, results, classification });

    // Print summary
    const os = results.on_signal;
    const p1 = results.plus_one_candle;
    if (os.status === 'COMPLETE') {
      console.log(`  📊 On Signal: PF=${os.profitFactor} WR=${os.winRate} DD=${os.maxDrawdown} Ret=${os.totalReturn}`);
      console.log(`  📊 +1 Candle:  PF=${p1.profitFactor} WR=${p1.winRate} DD=${p1.maxDrawdown} Ret=${p1.totalReturn}`);
      console.log(`  🛑 Tail risk: raw worst1%=${os.tailRisk.rawWorst1pctMAE} → stopped=${os.tailRisk.stoppedWorst1pctLoss} (${os.tailRisk.tailReduction} reduction)`);
      console.log(`  🔄 Exits: ${JSON.stringify(os.exitBreakdown)}`);
      console.log(`  🏷️  VERDICT: ${classification.verdict}${classification.extractable ? ' → ELIGIBLE' : ' → REJECT'}`);
      if (classification.flags.length > 0) {
        for (const f of classification.flags) console.log(`     ⚠️  ${f}`);
      }
    }
  }

  // Generate report
  const report = generateReport(allResults);
  const reportPath = path.join(__dirname, 'PHASE3_EXECUTION_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  const rawPath = path.join(__dirname, 'phase3-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw: ${rawPath}`);

  // Final summary
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  🏆 FINAL DECISION`);
  console.log(`${'═'.repeat(60)}\n`);

  for (const r of allResults) {
    const icon = r.classification.verdict === 'SURVIVES' ? '🟢' :
                 r.classification.verdict === 'DEGRADED' ? '🟡' : '🔴';
    console.log(`  ${icon} ${r.asset} / ${r.edge} — ${r.classification.verdict}`);
    if (r.classification.flags.length > 0) {
      for (const f of r.classification.flags) console.log(`     ⚠️  ${f}`);
    }
  }

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
