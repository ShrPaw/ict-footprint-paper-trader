// ═══════════════════════════════════════════════════════════════════
// PHASE 4 — DURATION EDGE DISCOVERY
// ═══════════════════════════════════════════════════════════════════
//
// PARADIGM SHIFT: No longer modeling signal → entry → outcome.
// Now modeling: entry randomness → time exposure → outcome distribution.
//
// Hypothesis: TIME, not ENTRY, is the real source of edge.
//
// 5 experiments:
//   E1 — Random entry baseline (fixed holding periods)
//   E2 — Conditional time edge (regime, time-of-day)
//   E3 — Path analysis (probability of going positive within N hours)
//   E4 — Entry irrelevance test (signal vs random comparison)
//   E5 — Time-based exit system (pure time exits, no stops)
//
// RULES: NO stops, NO trailing, NO optimization, NO signal filtering
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

const ASSETS = [
  { symbol: 'BTC/USDT:USDT', label: 'BTC' },
  { symbol: 'ETH/USDT:USDT', label: 'ETH' },
  { symbol: 'SOL/USDT:USDT', label: 'SOL' },
  { symbol: 'XRP/USDT:USDT', label: 'XRP' },
];

// Fixed parameters
const RANDOM_SEEDS = 5;           // run 5 independent random samples
const RANDOM_SAMPLE_SIZE = 2000;  // trades per sample
const HOLDING_PERIODS = [1, 2, 3, 4, 6, 8, 12, 24]; // hours
const FEE_RATE = 0.0007;          // per side (medium friction)

// ═══════════════════════════════════════════════════════════════════
// INDICATORS
// ═══════════════════════════════════════════════════════════════════

function computeATR(candles, period) {
  const n = candles.length;
  const tr = new Array(n);
  const atr = new Array(n).fill(null);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(candles[i].high-candles[i].low, Math.abs(candles[i].high-candles[i-1].close), Math.abs(candles[i].low-candles[i-1].close));
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i-period];
    if (i >= period-1) atr[i] = sum/period;
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
  tr[0] = candles[0].high-candles[0].low;
  for (let i = 1; i < n; i++) {
    const up=candles[i].high-candles[i-1].high, dn=candles[i-1].low-candles[i].low;
    plusDM[i]=up>dn&&up>0?up:0; minusDM[i]=dn>up&&dn>0?dn:0;
    tr[i]=Math.max(candles[i].high-candles[i].low, Math.abs(candles[i].high-candles[i-1].close), Math.abs(candles[i].low-candles[i-1].close));
  }
  const sTR=new Array(n).fill(0), sP=new Array(n).fill(0), sM=new Array(n).fill(0);
  let sumTR=0,sumP=0,sumM=0;
  for(let i=0;i<period;i++){sumTR+=tr[i];sumP+=plusDM[i];sumM+=minusDM[i];}
  sTR[period-1]=sumTR;sP[period-1]=sumP;sM[period-1]=sumM;
  for(let i=period;i<n;i++){
    sTR[i]=sTR[i-1]-sTR[i-1]/period+tr[i];
    sP[i]=sP[i-1]-sP[i-1]/period+plusDM[i];
    sM[i]=sM[i-1]-sM[i-1]/period+minusDM[i];
  }
  const dx=new Array(n).fill(0);
  for(let i=period-1;i<n;i++){
    if(sTR[i]===0)continue;
    const pdi=100*sP[i]/sTR[i],mdi=100*sM[i]/sTR[i],ds=pdi+mdi;
    dx[i]=ds===0?0:100*Math.abs(pdi-mdi)/ds;
  }
  let s=0;
  for(let i=0;i<n;i++){s+=dx[i];if(i>=period+period-2){s-=dx[i-period];adx[i]=s/period;}}
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
  const closes = candles.map(c=>c.close);
  const regimes = new Array(n).fill('UNKNOWN');
  const atrZ = new Array(n).fill(null);
  for (let i=200;i<n;i++){
    if(atr[i]===null)continue;
    let s=0,sq=0,c=0;
    for(let j=i-199;j<=i;j++){if(atr[j]!==null){s+=atr[j];sq+=atr[j]**2;c++;}}
    const m=s/c;const std=Math.sqrt(Math.max(0,sq/c-m*m));
    atrZ[i]=std>0?(atr[i]-m)/std:0;
  }
  const bbSma=computeSMA(closes,20);
  const bbStdArr=new Array(n).fill(null);
  for(let i=19;i<n;i++){
    let s=0;for(let j=i-19;j<=i;j++)s+=closes[j];const m=s/20;
    let sq=0;for(let j=i-19;j<=i;j++)sq+=(closes[j]-m)**2;
    bbStdArr[i]=Math.sqrt(sq/20);
  }
  const bbWidth=new Array(n).fill(null);
  for(let i=0;i<n;i++){
    if(bbSma[i]!==null&&bbStdArr[i]!==null&&closes[i]>0)bbWidth[i]=(2*2*bbStdArr[i])/closes[i];
  }
  const ema20=computeEMA(closes,20);
  for(let i=200;i<n;i++){
    if(atrZ[i]===null||adx[i]===null||bbWidth[i]===null)continue;
    let bbBelow=0,bbCount=0;
    for(let j=i-199;j<=i;j++){if(bbWidth[j]!==null){bbCount++;if(bbWidth[j]<bbWidth[i])bbBelow++;}}
    const bbPct=bbCount>0?bbBelow/bbCount:0.5;
    if(bbPct<0.2&&atrZ[i]<-0.5)regimes[i]='LOW_VOL';
    else if(bbPct<0.35)regimes[i]='RANGING';
    else if(adx[i]>25&&atrZ[i]>0.3)regimes[i]=closes[i]>ema20[i]?'TRENDING_UP':'TRENDING_DOWN';
    else if(atrZ[i]>1.0)regimes[i]='VOL_EXPANSION';
    else regimes[i]='RANGING';
  }
  return {regimes,atrZ};
}

// ═══════════════════════════════════════════════════════════════════
// EDGE DETECTORS (for E4 comparison)
// ═══════════════════════════════════════════════════════════════════

function detectDisplacementBullish(candles, atr) {
  const n=candles.length;const events=[];
  for(let i=5;i<n-1;i++){
    if(atr[i]===null)continue;
    const body=Math.abs(candles[i].close-candles[i].open);
    const range=candles[i].high-candles[i].low;
    if(range===0)continue;
    if(body/range>0.7&&body>atr[i]*1.5){
      const dir=candles[i].close>candles[i].open?1:-1;
      const nextBody=candles[i+1].close-candles[i+1].open;
      if(dir>0&&nextBody>-body*0.5)events.push(i);
    }
  }
  return events;
}

function detectHigherLow(candles, atr, ema50) {
  const n=candles.length;const events=[];
  const lows=candles.map(c=>c.low);
  for(let i=10;i<n-1;i++){
    if(atr[i]===null||ema50[i]===null)continue;
    const isLocalLow=lows[i]<=lows[i-1]&&lows[i]<=lows[i+1]&&lows[i]<=lows[i-2]&&lows[i]<=lows[i-3];
    if(!isLocalLow)continue;
    for(let j=i-3;j>=i-20&&j>=4;j--){
      const wasLocalLow=lows[j]<=lows[j-1]&&lows[j]<=lows[j+1]&&lows[j]<=lows[j-2]&&lows[j]<=lows[j+2];
      if(wasLocalLow&&lows[i]>lows[j]&&candles[i].close>ema50[i]){events.push(i);break;}
    }
  }
  return events;
}

// ═══════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════

function stats(arr) {
  const v=arr.filter(x=>x!==null&&!isNaN(x)&&isFinite(x));
  if(v.length<5)return{n:v.length,mean:0,median:0,std:0,pctPositive:0,tStat:0,skew:0,min:0,max:0};
  const n=v.length;
  const mean=v.reduce((s,x)=>s+x,0)/n;
  const sorted=[...v].sort((a,b)=>a-b);
  const median=sorted[Math.floor(n/2)];
  const pos=v.filter(r=>r>0).length;
  let m2=0,m3=0;
  for(const x of v){const d=x-mean;m2+=d*d;m3+=d*d*d;}
  m2/=n;m3/=n;
  const std=Math.sqrt(m2);
  const skew=std>0?m3/(std**3):0;
  const t=std>0?mean/(std/Math.sqrt(n)):0;
  return{n,mean,median,std,pctPositive:pos/n,tStat:t,skew,min:sorted[0],max:sorted[n-1],
    p5:sorted[Math.floor(n*0.05)],p25:sorted[Math.floor(n*0.25)],
    p75:sorted[Math.floor(n*0.75)],p95:sorted[Math.floor(n*0.95)]};
}

function percentile(arr,p){
  const sorted=[...arr].filter(x=>x!==null&&isFinite(x)).sort((a,b)=>a-b);
  if(sorted.length===0)return 0;
  return sorted[Math.min(Math.floor(p/100*sorted.length),sorted.length-1)];
}

// Seeded pseudo-random for reproducibility
class RNG {
  constructor(seed){this.state=seed;}
  next(){this.state=(this.state*1664525+1013904223)&0xFFFFFFFF;return(this.state>>>0)/0xFFFFFFFF;}
  randInt(max){return Math.floor(this.next()*max);}
}

// ═══════════════════════════════════════════════════════════════════
// EXPERIMENT 1: RANDOM ENTRY BASELINE
// ═══════════════════════════════════════════════════════════════════

function experiment1(candles, label) {
  const n = candles.length;
  const results = {};

  // Need enough warmup and runway
  const minIdx = 200;
  const maxIdx = n - 25; // leave room for 24h hold

  for (const hold of HOLDING_PERIODS) {
    const allReturns = [];

    // Run multiple random samples
    for (let seed = 0; seed < RANDOM_SEEDS; seed++) {
      const rng = new RNG(seed * 12345 + 67890);
      for (let t = 0; t < RANDOM_SAMPLE_SIZE; t++) {
        const idx = minIdx + rng.randInt(maxIdx - minIdx);
        const exitIdx = idx + hold;
        if (exitIdx >= n) continue;

        const entryPrice = candles[idx].close;
        const exitPrice = candles[exitIdx].close;
        if (entryPrice <= 0) continue;

        // Raw return (no fees)
        const rawReturn = (exitPrice - entryPrice) / entryPrice;
        // Net return (with fees)
        const netReturn = rawReturn - 2 * FEE_RATE;

        allReturns.push({ raw: rawReturn, net: netReturn, holdHours: hold });
      }
    }

    const rawReturns = allReturns.map(r => r.raw);
    const netReturns = allReturns.map(r => r.net);
    const rawS = stats(rawReturns);
    const netS = stats(netReturns);

    results[`${hold}h`] = {
      samples: allReturns.length,
      raw: rawS,
      net: netS,
      edgeExists: Math.abs(rawS.tStat) > 1.96,
      edgeDirection: rawS.mean > 0 ? 'LONG' : rawS.mean < 0 ? 'SHORT' : 'NONE',
    };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// EXPERIMENT 2: CONDITIONAL TIME EDGE
// ═══════════════════════════════════════════════════════════════════

function experiment2(candles, atr, adx, regimes, label) {
  const n = candles.length;
  const minIdx = 200;
  const maxIdx = n - 25;
  const results = {};

  // Get UTC hours
  const hours = candles.map(c => new Date(c.timestamp).getUTCHours());
  const days = candles.map(c => new Date(c.timestamp).getUTCDay());

  // By regime
  const byRegime = {};
  const byHour = {};
  const byDay = {};
  const byRegimeAndHold = {};

  for (let idx = minIdx; idx < maxIdx; idx++) {
    const reg = regimes[idx] || 'UNKNOWN';
    const h = hours[idx];
    const d = days[idx];

    for (const hold of [1, 2, 4, 8, 24]) {
      const exitIdx = idx + hold;
      if (exitIdx >= n) continue;
      const ret = (candles[exitIdx].close - candles[idx].close) / candles[idx].close;

      // By regime
      if (!byRegime[reg]) byRegime[reg] = [];
      byRegime[reg].push(ret);

      // By regime × hold
      const rk = `${reg}_${hold}h`;
      if (!byRegimeAndHold[rk]) byRegimeAndHold[rk] = [];
      byRegimeAndHold[rk].push(ret);

      // By hour (only for 4h hold to keep it manageable)
      if (hold === 4) {
        const hk = `h${h}`;
        if (!byHour[hk]) byHour[hk] = [];
        byHour[hk].push(ret);
      }

      // By day of week (4h hold)
      if (hold === 4) {
        const dk = `dow${d}`;
        if (!byDay[dk]) byDay[dk] = [];
        byDay[dk].push(ret);
      }
    }
  }

  // Regime analysis
  results.byRegime = {};
  for (const [reg, rets] of Object.entries(byRegime)) {
    if (rets.length >= 50) {
      results.byRegime[reg] = stats(rets);
    }
  }

  // Regime × holding period
  results.byRegimeAndHold = {};
  for (const [key, rets] of Object.entries(byRegimeAndHold)) {
    if (rets.length >= 30) {
      results.byRegimeAndHold[key] = stats(rets);
    }
  }

  // Hour analysis (4h hold)
  results.byHour = {};
  for (const [hk, rets] of Object.entries(byHour)) {
    if (rets.length >= 30) {
      results.byHour[hk] = stats(rets);
    }
  }

  // Day of week (4h hold)
  results.byDay = {};
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (const [dk, rets] of Object.entries(byDay)) {
    if (rets.length >= 30) {
      const dowNum = parseInt(dk.replace('dow',''));
      results.byDay[dayNames[dowNum]] = stats(rets);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// EXPERIMENT 3: PATH ANALYSIS
// ═══════════════════════════════════════════════════════════════════

function experiment3(candles, label) {
  const n = candles.length;
  const minIdx = 200;
  const maxIdx = n - 25;

  const pathData = [];

  // For each eligible index, compute the path of returns at each hour
  for (let idx = minIdx; idx < maxIdx; idx++) {
    const path = [];
    const entryPrice = candles[idx].close;
    if (entryPrice <= 0) continue;

    for (let h = 1; h <= 24; h++) {
      const exitIdx = idx + h;
      if (exitIdx >= n) { path.push(null); continue; }
      path.push((candles[exitIdx].close - entryPrice) / entryPrice);
    }
    pathData.push(path);
  }

  // Probability of being positive at each hour
  const probPositiveAt = [];
  const meanReturnAt = [];
  for (let h = 0; h < 24; h++) {
    const vals = pathData.map(p => p[h]).filter(v => v !== null);
    if (vals.length < 100) { probPositiveAt.push(null); meanReturnAt.push(null); continue; }
    probPositiveAt.push(vals.filter(v => v > 0).length / vals.length);
    meanReturnAt.push(vals.reduce((s,v) => s+v, 0) / vals.length);
  }

  // "Go positive then revert" analysis
  // For trades that end negative at 24h, what % went positive at some point?
  // For trades that end positive at 24h, what % went negative at some point?
  let negEndWentPos = 0, negEndTotal = 0;
  let posEndWentNeg = 0, posEndTotal = 0;
  for (const path of pathData) {
    const final = path[23];
    if (final === null) continue;
    if (final <= 0) {
      negEndTotal++;
      if (path.some(p => p !== null && p > 0)) negEndWentPos++;
    } else {
      posEndTotal++;
      if (path.some(p => p !== null && p < 0)) posEndWentNeg++;
    }
  }

  // Time-to-first-positive
  const timeToPos = [];
  for (const path of pathData) {
    for (let h = 0; h < 24; h++) {
      if (path[h] !== null && path[h] > 0) { timeToPos.push(h + 1); break; }
    }
  }

  // Time-to-max-return (when does the best return typically occur?)
  const timeToMax = [];
  for (const path of pathData) {
    let bestH = -1, bestR = -Infinity;
    for (let h = 0; h < 24; h++) {
      if (path[h] !== null && path[h] > bestR) { bestR = path[h]; bestH = h; }
    }
    if (bestH >= 0) timeToMax.push(bestH + 1);
  }

  return {
    probPositiveAt,
    meanReturnAt,
    reversion: {
      negEndWentPosAtSomePoint: negEndTotal > 0 ? negEndWentPos / negEndTotal : 0,
      posEndWentNegAtSomePoint: posEndTotal > 0 ? posEndWentNeg / posEndTotal : 0,
      negEndTotal,
      posEndTotal,
    },
    timeToFirstPositive: {
      mean: timeToPos.length > 0 ? timeToPos.reduce((s,v)=>s+v,0)/timeToPos.length : null,
      median: timeToPos.length > 0 ? percentile(timeToPos, 50) : null,
      p75: timeToPos.length > 0 ? percentile(timeToPos, 75) : null,
      neverGoesPositive: pathData.length - timeToPos.length,
      neverGoesPositivePct: pathData.length > 0 ? ((pathData.length - timeToPos.length) / pathData.length * 100).toFixed(1) + '%' : 'N/A',
    },
    timeToMaxReturn: {
      mean: timeToMax.length > 0 ? timeToMax.reduce((s,v)=>s+v,0)/timeToMax.length : null,
      median: timeToMax.length > 0 ? percentile(timeToMax, 50) : null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXPERIMENT 4: ENTRY IRRELEVANCE TEST
// ═══════════════════════════════════════════════════════════════════

function experiment4(candles, atr, ema50, regimes, label) {
  const n = candles.length;

  // Signal-based entries
  const dispEvents = detectDisplacementBullish(candles, atr);
  const hlEvents = detectHigherLow(candles, atr, ema50);

  // Random entries (matched sample size)
  const minIdx = 200;
  const maxIdx = n - 25;

  function randomEntries(count, seed) {
    const rng = new RNG(seed);
    const entries = [];
    const used = new Set();
    let attempts = 0;
    while (entries.length < count && attempts < count * 10) {
      const idx = minIdx + rng.randInt(maxIdx - minIdx);
      if (!used.has(idx)) { used.add(idx); entries.push(idx); }
      attempts++;
    }
    return entries;
  }

  function evaluateEntries(indices, holdHours) {
    const returns = [];
    for (const idx of indices) {
      const exitIdx = idx + holdHours;
      if (exitIdx >= n) continue;
      const ret = (candles[exitIdx].close - candles[idx].close) / candles[idx].close;
      returns.push(ret);
    }
    return stats(returns);
  }

  const results = {};

  for (const hold of [1, 2, 4, 8, 24]) {
    const disp = evaluateEntries(dispEvents, hold);
    const hl = evaluateEntries(hlEvents, hold);

    // Matched random samples (average over 10 seeds)
    const dispRandoms = [];
    const hlRandoms = [];
    for (let s = 0; s < 10; s++) {
      dispRandoms.push(evaluateEntries(randomEntries(dispEvents.length, s * 1000 + 42), hold));
      hlRandoms.push(evaluateEntries(randomEntries(hlEvents.length, s * 1000 + 99), hold));
    }

    const avgDispRandom = {
      mean: dispRandoms.reduce((s,r) => s + r.mean, 0) / dispRandoms.length,
      pctPositive: dispRandoms.reduce((s,r) => s + r.pctPositive, 0) / dispRandoms.length,
    };
    const avgHLRandom = {
      mean: hlRandoms.reduce((s,r) => s + r.mean, 0) / hlRandoms.length,
      pctPositive: hlRandoms.reduce((s,r) => s + r.pctPositive, 0) / hlRandoms.length,
    };

    results[`${hold}h`] = {
      displacement: { signal: disp, random: avgDispRandom, signalBeatsRandom: disp.mean > avgDispRandom.mean },
      higherLow: { signal: hl, random: avgHLRandom, signalBeatsRandom: hl.mean > avgHLRandom.mean },
    };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// EXPERIMENT 5: TIME-BASED EXIT SYSTEM
// ═══════════════════════════════════════════════════════════════════

function experiment5(candles, regimes, label) {
  const n = candles.length;
  const minIdx = 200;
  const maxIdx = n - 25;
  const results = {};

  // For each holding period, simulate a "system" of entering every N hours
  // to avoid overlapping trades, and exiting after the fixed period
  for (const hold of [1, 2, 4]) {
    const trades = [];
    let idx = minIdx;

    while (idx < maxIdx) {
      const exitIdx = idx + hold;
      if (exitIdx >= n) break;

      const entryPrice = candles[idx].close;
      const exitPrice = candles[exitIdx].close;
      const netReturn = (exitPrice - entryPrice) / entryPrice - 2 * FEE_RATE;
      const regime = regimes[idx] || 'UNKNOWN';

      trades.push({
        entryIdx: idx,
        exitIdx,
        netReturn,
        rawReturn: (exitPrice - entryPrice) / entryPrice,
        regime,
        entryHour: new Date(candles[idx].timestamp).getUTCHours(),
      });

      idx += hold; // non-overlapping
    }

    const returns = trades.map(t => t.netReturn);
    const s = stats(returns);

    // Monthly breakdown
    const monthly = {};
    for (const t of trades) {
      const d = new Date(candles[t.entryIdx].timestamp);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      if (!monthly[key]) monthly[key] = 0;
      monthly[key] += t.netReturn;
    }
    const monthlyValues = Object.values(monthly);

    // Regime breakdown
    const byRegime = {};
    for (const t of trades) {
      if (!byRegime[t.regime]) byRegime[t.regime] = [];
      byRegime[t.regime].push(t.netReturn);
    }

    results[`${hold}h`] = {
      trades: trades.length,
      stats: s,
      profitableMonths: monthlyValues.filter(v => v > 0).length,
      totalMonths: monthlyValues.length,
      profitableMonthsPct: (monthlyValues.filter(v => v > 0).length / monthlyValues.length * 100).toFixed(0) + '%',
      worstMonth: monthlyValues.length > 0 ? Math.min(...monthlyValues) : 0,
      bestMonth: monthlyValues.length > 0 ? Math.max(...monthlyValues) : 0,
      avgMonthly: monthlyValues.length > 0 ? (monthlyValues.reduce((s,v)=>s+v,0)/monthlyValues.length) : 0,
      byRegime: Object.fromEntries(
        Object.entries(byRegime).filter(([_,r])=>r.length>=10).map(([reg,rets])=>[reg, stats(rets)])
      ),
    };
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let r = `# 🧠 PHASE 4 — DURATION EDGE DISCOVERY\n`;
  r += `**Generated:** ${new Date().toISOString()}\n`;
  r += `**Paradigm:** Entry randomness → Time exposure → Outcome distribution\n`;
  r += `**Rule:** NO stops, NO trailing, NO optimization, NO signal filtering\n`;
  r += `**Data:** Binance 1h, ${START_DATE.slice(0,10)} → ${END_DATE.slice(0,10)}\n\n---\n\n`;

  // ═══════════════════════════════════════════════════════════════
  // E1: Random Entry Baseline
  // ═══════════════════════════════════════════════════════════════
  r += `## E1 — Random Entry Baseline\n\n`;
  r += `${RANDOM_SAMPLE_SIZE} random entries × ${RANDOM_SEEDS} seeds per asset, per holding period.\n\n`;

  for (const asset of ASSETS) {
    const e1 = allResults[asset.label]?.e1;
    if (!e1) continue;
    r += `### ${asset.label}\n\n`;
    r += `| Hold | Mean | t-stat | Win Rate | Skew | Significant? |\n`;
    r += `|------|------|--------|----------|------|-------------|\n`;
    for (const [hold, data] of Object.entries(e1)) {
      const s = data.raw;
      r += `| ${hold} | ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}% | ${s.skew.toFixed(2)} | ${data.edgeExists ? '✅ ' + data.edgeDirection : '❌'} |\n`;
    }
    r += `\n`;
  }

  // ═══════════════════════════════════════════════════════════════
  // E2: Conditional Time Edge
  // ═══════════════════════════════════════════════════════════════
  r += `## E2 — Conditional Time Edge\n\n`;

  for (const asset of ASSETS) {
    const e2 = allResults[asset.label]?.e2;
    if (!e2) continue;
    r += `### ${asset.label} — By Regime (4h hold)\n\n`;
    r += `| Regime | Mean | t-stat | Win Rate | n |\n`;
    r += `|--------|------|--------|----------|---|\n`;
    for (const [reg, s] of Object.entries(e2.byRegime)) {
      r += `| ${reg} | ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}% | ${s.n} |\n`;
    }
    r += `\n`;

    // Best regime × hold combo
    r += `### ${asset.label} — Best Regime × Hold Combos\n\n`;
    r += `| Combo | Mean | t-stat | Win Rate |\n`;
    r += `|-------|------|--------|----------|\n`;
    const combos = Object.entries(e2.byRegimeAndHold)
      .filter(([_,s]) => s.n >= 50 && s.tStat > 2.0)
      .sort((a,b) => b[1].mean - a[1].mean)
      .slice(0, 10);
    for (const [key, s] of combos) {
      r += `| ${key} | ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}% |\n`;
    }
    r += `\n`;

    // Hour analysis
    r += `### ${asset.label} — By Hour UTC (4h hold)\n\n`;
    r += `| Hour | Mean | t-stat | Win Rate |\n`;
    r += `|------|------|--------|----------|\n`;
    for (let h = 0; h < 24; h++) {
      const s = e2.byHour[`h${h}`];
      if (!s) { r += `| ${h}:00 | — | — | — |\n`; continue; }
      const highlight = s.tStat > 2.0 ? ' **' : '';
      r += `| ${h}:00 |${highlight} ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}%${highlight} |\n`;
    }
    r += `\n`;
  }

  // ═══════════════════════════════════════════════════════════════
  // E3: Path Analysis
  // ═══════════════════════════════════════════════════════════════
  r += `## E3 — Path Analysis\n\n`;

  for (const asset of ASSETS) {
    const e3 = allResults[asset.label]?.e3;
    if (!e3) continue;
    r += `### ${asset.label}\n\n`;

    r += `**Probability of positive return at each hour:**\n\n`;
    r += `| Hour | P(positive) | Mean Return |\n`;
    r += `|------|------------|-------------|\n`;
    for (let h = 0; h < 24; h++) {
      const p = e3.probPositiveAt[h];
      const m = e3.meanReturnAt[h];
      if (p === null) continue;
      const highlight = p > 0.55 ? ' **' : '';
      r += `| +${h+1}h |${highlight} ${(p*100).toFixed(1)}% | ${(m*100).toFixed(4)}%${highlight} |\n`;
    }
    r += `\n`;

    r += `**Reversion analysis:**\n`;
    r += `- Trades ending negative at 24h that went positive at some point: ${(e3.reversion.negEndWentPosAtSomePoint*100).toFixed(1)}% (${e3.reversion.negEndTotal} trades)\n`;
    r += `- Trades ending positive at 24h that went negative at some point: ${(e3.reversion.posEndWentNegAtSomePoint*100).toFixed(1)}% (${e3.reversion.posEndTotal} trades)\n\n`;

    r += `**Time to first positive:**\n`;
    r += `- Mean: ${e3.timeToFirstPositive.mean?.toFixed(1)}h\n`;
    r += `- Median: ${e3.timeToFirstPositive.median?.toFixed(1)}h\n`;
    r += `- Never goes positive: ${e3.timeToFirstPositive.neverGoesPositivePct}\n\n`;

    r += `**Time to max return:**\n`;
    r += `- Mean: ${e3.timeToMaxReturn.mean?.toFixed(1)}h\n`;
    r += `- Median: ${e3.timeToMaxReturn.median?.toFixed(1)}h\n\n`;
  }

  // ═══════════════════════════════════════════════════════════════
  // E4: Entry Irrelevance Test
  // ═══════════════════════════════════════════════════════════════
  r += `## E4 — Entry Irrelevance Test\n\n`;
  r += `Do signal-based entries outperform random? (Displacement, Higher-Low vs matched random)\n\n`;

  for (const asset of ASSETS) {
    const e4 = allResults[asset.label]?.e4;
    if (!e4) continue;
    r += `### ${asset.label}\n\n`;
    r += `| Hold | Displacement Mean | Random Mean | Signal Beats? | HL Mean | Random Mean | Signal Beats? |\n`;
    r += `|------|------------------|-------------|--------------|---------|-------------|--------------|\n`;
    for (const [hold, data] of Object.entries(e4)) {
      const db = data.displacement.signalBeatsRandom ? '✅' : '❌';
      const hb = data.higherLow.signalBeatsRandom ? '✅' : '❌';
      r += `| ${hold} | ${(data.displacement.signal.mean*100).toFixed(4)}% | ${(data.displacement.random.mean*100).toFixed(4)}% | ${db} | ${(data.higherLow.signal.mean*100).toFixed(4)}% | ${(data.higherLow.random.mean*100).toFixed(4)}% | ${hb} |\n`;
    }
    r += `\n`;
  }

  // ═══════════════════════════════════════════════════════════════
  // E5: Time-Based Exit System
  // ═══════════════════════════════════════════════════════════════
  r += `## E5 — Time-Based Exit System (non-overlapping, no stops)\n\n`;

  for (const asset of ASSETS) {
    const e5 = allResults[asset.label]?.e5;
    if (!e5) continue;
    r += `### ${asset.label}\n\n`;
    r += `| Hold | Trades | Mean | t-stat | Win Rate | Profitable Mo. | Avg Monthly |\n`;
    r += `|------|--------|------|--------|----------|----------------|-------------|\n`;
    for (const [hold, data] of Object.entries(e5)) {
      const s = data.stats;
      r += `| ${hold} | ${data.trades} | ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}% | ${data.profitableMonths}/${data.totalMonths} (${data.profitableMonthsPct}) | ${(data.avgMonthly*100).toFixed(4)}% |\n`;
    }
    r += `\n`;

    // Best regime for 4h system
    const e5_4h = e5['4h'];
    if (e5_4h && Object.keys(e5_4h.byRegime).length > 0) {
      r += `**4h system by regime:**\n`;
      r += `| Regime | Mean | t-stat | Win Rate |\n`;
      r += `|--------|------|--------|----------|\n`;
      for (const [reg, s] of Object.entries(e5_4h.byRegime)) {
        r += `| ${reg} | ${(s.mean*100).toFixed(4)}% | ${s.tStat.toFixed(2)} | ${(s.pctPositive*100).toFixed(1)}% |\n`;
      }
      r += `\n`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FINAL CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════
  r += `## FINAL CLASSIFICATION\n\n`;

  // Aggregate findings
  const durationEdgeFindings = [];
  for (const asset of ASSETS) {
    const e1 = allResults[asset.label]?.e1;
    if (!e1) continue;
    for (const [hold, data] of Object.entries(e1)) {
      if (data.edgeExists) {
        durationEdgeFindings.push({ asset: asset.label, hold, direction: data.edgeDirection, mean: data.raw.mean, t: data.raw.tStat, wr: data.raw.pctPositive });
      }
    }
  }

  // Entry value assessment
  const entryAddsValue = [];
  for (const asset of ASSETS) {
    const e4 = allResults[asset.label]?.e4;
    if (!e4) continue;
    for (const [hold, data] of Object.entries(e4)) {
      if (data.displacement.signalBeatsRandom || data.higherLow.signalBeatsRandom) {
        entryAddsValue.push({ asset: asset.label, hold, displacement: data.displacement.signalBeatsRandom, hl: data.higherLow.signalBeatsRandom });
      }
    }
  }

  if (durationEdgeFindings.length > 0) {
    r += `### 🟢 CASE A — DURATION EDGE EXISTS\n\n`;
    r += `Non-random behavior detected at specific holding periods:\n\n`;
    for (const f of durationEdgeFindings) {
      r += `- **${f.asset} ${f.hold}**: ${f.direction} bias, mean=${(f.mean*100).toFixed(4)}%, t=${f.t.toFixed(2)}, WR=${(f.wr*100).toFixed(1)}%\n`;
    }
    r += `\n`;

    if (entryAddsValue.length > 0) {
      r += `**Entry signals add marginal value in:**\n`;
      for (const e of entryAddsValue) {
        r += `- ${e.asset} ${e.hold}: ${e.displacement ? 'Displacement' : ''} ${e.hl ? 'Higher-Low' : ''}\n`;
      }
    } else {
      r += `**Entry signals add NO value beyond random entry.** The edge is purely time-based.\n`;
    }
  } else {
    r += `### 🔴 CASE B — NO DURATION EDGE\n\n`;
    r += `No holding period shows statistically significant non-random behavior.\n`;
    r += `Results are indistinguishable from coin flip across all assets and durations.\n\n`;
    r += `**Conclusion:** No exploitable edge exists in this dataset.\n`;
  }

  return r;
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
    if (!candles||!candles.length) break;
    all.push(...candles);
    cursor = candles[candles.length-1][0]+1;
    await new Promise(r=>setTimeout(r,exchange.rateLimit));
  }
  const seen=new Set();const unique=[];
  for(const c of all){if(!seen.has(c[0])){seen.add(c[0]);unique.push({timestamp:c[0],open:c[1],high:c[2],low:c[3],close:c[4],volume:c[5]});}}
  console.log(` ${unique.length} ✅`);
  return unique.filter(c=>c.timestamp>=since&&c.timestamp<=end);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🧠 PHASE 4 — DURATION EDGE DISCOVERY                           ║
║  Paradigm: Time exposure > Entry signal                         ║
║  NO stops, NO trailing, NO optimization, NO filtering          ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults = {};

  for (const asset of ASSETS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔬 ${asset.label}`);
    console.log(`${'═'.repeat(60)}`);

    const candles = await fetchCandles(asset.symbol);
    const closes = candles.map(c=>c.close);
    const atr = computeATR(candles, 14);
    const adx = computeADX(candles, 14);
    const ema50 = computeEMA(closes, 50);
    const { regimes } = detectRegimes(candles, atr, adx);

    allResults[asset.label] = {};

    // E1
    console.log(`  E1: Random entry baseline...`);
    const e1 = experiment1(candles, asset.label);
    allResults[asset.label].e1 = e1;
    for (const [hold, data] of Object.entries(e1)) {
      const s = data.raw;
      console.log(`    ${hold}: mean=${(s.mean*100).toFixed(4)}% t=${s.tStat.toFixed(2)} WR=${(s.pctPositive*100).toFixed(1)}% ${data.edgeExists ? '✅ '+data.edgeDirection : '❌'}`);
    }

    // E2
    console.log(`  E2: Conditional time edge...`);
    const e2 = experiment2(candles, atr, adx, regimes, asset.label);
    allResults[asset.label].e2 = e2;
    const topCombos = Object.entries(e2.byRegimeAndHold)
      .filter(([_,s])=>s.n>=50&&s.tStat>2.0)
      .sort((a,b)=>b[1].mean-a[1].mean).slice(0,3);
    if (topCombos.length > 0) {
      for (const [k,s] of topCombos) console.log(`    🎯 ${k}: mean=${(s.mean*100).toFixed(4)}% t=${s.tStat.toFixed(2)}`);
    } else {
      console.log(`    No significant regime×hold combos`);
    }

    // E3
    console.log(`  E3: Path analysis...`);
    const e3 = experiment3(candles, asset.label);
    allResults[asset.label].e3 = e3;
    console.log(`    Reversion: ${(e3.reversion.negEndWentPosAtSomePoint*100).toFixed(0)}% of losers went positive at some point`);
    console.log(`    Never goes positive: ${e3.timeToFirstPositive.neverGoesPositivePct}`);

    // E4
    console.log(`  E4: Entry irrelevance test...`);
    const e4 = experiment4(candles, atr, ema50, regimes, asset.label);
    allResults[asset.label].e4 = e4;
    for (const [hold, data] of Object.entries(e4)) {
      const db = data.displacement.signalBeatsRandom?'✅':'❌';
      const hb = data.higherLow.signalBeatsRandom?'✅':'❌';
      console.log(`    ${hold}: Disp signal=${(data.displacement.signal.mean*100).toFixed(4)}% rand=${(data.displacement.random.mean*100).toFixed(4)}% ${db} | HL signal=${(data.higherLow.signal.mean*100).toFixed(4)}% rand=${(data.higherLow.random.mean*100).toFixed(4)}% ${hb}`);
    }

    // E5
    console.log(`  E5: Time-based exit system...`);
    const e5 = experiment5(candles, regimes, asset.label);
    allResults[asset.label].e5 = e5;
    for (const [hold, data] of Object.entries(e5)) {
      console.log(`    ${hold}: PF=${data.stats.std>0?(data.stats.mean/data.stats.std*Math.sqrt(data.trades/(data.totalMonths/12))).toFixed(2):'N/A'} WR=${(data.stats.pctPositive*100).toFixed(1)}% months=${data.profitableMonths}/${data.totalMonths}`);
    }
  }

  // Generate report
  const report = generateReport(allResults);
  const reportPath = path.join(__dirname, 'PHASE4_DURATION_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  const rawPath = path.join(__dirname, 'phase4-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw: ${rawPath}`);

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
