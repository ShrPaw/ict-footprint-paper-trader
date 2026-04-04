// ═══════════════════════════════════════════════════════════════════
// EDGE DISCOVERY v2.1 — DEEP CONDITIONAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════
//
// Focus: regime-conditional edges, directional asymmetry,
// volume-conditional, multi-timeframe confirmation
//
// Only tests hypotheses that showed partial signal in v2.0
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ASSETS = [
  { symbol: 'ETH/USDT:USDT', label: 'ETH' },
  { symbol: 'SOL/USDT:USDT', label: 'SOL' },
  { symbol: 'BTC/USDT:USDT', label: 'BTC' },
  { symbol: 'XRP/USDT:USDT', label: 'XRP' },
];
const EXCHANGE = 'binance';
const TIMEFRAME = '1h';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:00Z';

// ═══════════════════════════════════════════════════════════════════
// STANDALONE INDICATORS (same as v2.0)
// ═══════════════════════════════════════════════════════════════════

function computeATR(candles, period) {
  const n = candles.length;
  const tr = new Array(n);
  const atr = new Array(n).fill(null);
  tr[0] = candles[0][2] - candles[0][3];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(candles[i][2]-candles[i][3], Math.abs(candles[i][2]-candles[i-1][4]), Math.abs(candles[i][3]-candles[i-1][4]));
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i-period];
    if (i >= period-1) atr[i] = sum/period;
  }
  return atr;
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

function computeEMA(data, period) {
  const r = new Array(data.length);
  const k = 2/(period+1);
  r[0] = data[0];
  for (let i = 1; i < data.length; i++) r[i] = data[i]*k + r[i-1]*(1-k);
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
  tr[0] = candles[0][2]-candles[0][3];
  for (let i = 1; i < n; i++) {
    const up = candles[i][2]-candles[i-1][2];
    const dn = candles[i-1][3]-candles[i][3];
    plusDM[i] = up>dn&&up>0?up:0;
    minusDM[i] = dn>up&&dn>0?dn:0;
    tr[i] = Math.max(candles[i][2]-candles[i][3], Math.abs(candles[i][2]-candles[i-1][4]), Math.abs(candles[i][3]-candles[i-1][4]));
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

// Regime detection
function detectRegimes(candles, atr, adx) {
  const n = candles.length;
  const closes = candles.map(c => c[4]);
  const regimes = new Array(n).fill('UNKNOWN');

  const atrZ = new Array(n).fill(null);
  for (let i = 200; i < n; i++) {
    if (atr[i]===null) continue;
    let s=0, sq=0, c=0;
    for (let j = i-199; j <= i; j++) { if (atr[j]!==null) { s+=atr[j]; sq+=atr[j]**2; c++; } }
    const m=s/c; const std=Math.sqrt(sq/c-m**2);
    atrZ[i] = std>0?(atr[i]-m)/std:0;
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
    const bbPct = bbCount>0?bbBelow/bbCount:0.5;

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

function stats(returns) {
  const v = returns.filter(r => r!==null && !isNaN(r));
  if (v.length < 10) return null;
  const n=v.length;
  const mean=v.reduce((s,x)=>s+x,0)/n;
  const sorted=[...v].sort((a,b)=>a-b);
  const median=sorted[Math.floor(n/2)];
  const pos=v.filter(r=>r>0).length;
  let m2=0,m3=0,m4=0;
  for (const x of v) { const d=x-mean; m2+=d*d; m3+=d*d*d; m4+=d*d*d*d; }
  m2/=n; m3/=n; m4/=n;
  const std=Math.sqrt(m2);
  const skew=std>0?m3/(std**3):0;
  const kurt=m2>0?m4/(m2**2)-3:0;
  const t=std>0?mean/(std/Math.sqrt(n)):0;
  return { n, mean, median, std, pctPositive:pos/n, tStat:t, significant:Math.abs(t)>1.96, skew, kurtosis:kurt };
}

function clusteringRatio(indices, minGap) {
  if (indices.length<2) return 0;
  let clustered=0;
  for (let i=0;i<indices.length-1;i++) {
    if (indices[i+1]-indices[i]<minGap) clustered++;
  }
  return clustered/indices.length;
}

// ═══════════════════════════════════════════════════════════════════
// CONDITIONAL HYPOTHESES (the deep cuts)
// ═══════════════════════════════════════════════════════════════════

// HYPO 1: Range expansion ONLY in TRENDING_UP regime (continuation edge)
// HYPO 2: Stop-run continuation ONLY in TRENDING regimes
// HYPO 3: Displacement candle direction asymmetry
// HYPO 4: Post-high-volume continuation (volume surge → directional follow-through)
// HYPO 5: Multi-candle directional sequence (3+ same-direction candles → exhaustion or continuation per regime)
// HYPO 6: ATR z-score regime transitions (below-0 → above-0 transition)
// HYPO 7: EMA cross + momentum candle confluence
// HYPO 8: Bollinger squeeze breakout (direction-specific)
// HYPO 9: Higher-low / lower-high structural patterns
// HYPO 10: Killzone-specific edges (London/NY open momentum)

function runConditionalAnalysis(candles, label) {
  const n = candles.length;
  const closes = candles.map(c=>c[4]);
  const highs = candles.map(c=>c[2]);
  const lows = candles.map(c=>c[3]);
  const volumes = candles.map(c=>c[5]);

  console.log(`  📐 Computing indicators for ${label}...`);
  const atr = computeATR(candles, 14);
  const adx = computeADX(candles, 14);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const volSMA = computeSMA(volumes, 20);
  const volStd = computeStdDev(volumes, 20);

  const { regimes, atrZ } = detectRegimes(candles, atr, adx);

  // UTC hours for killzone detection
  const hours = candles.map(c => new Date(c[0]).getUTCHours());

  console.log(`  🔍 Running conditional hypotheses...`);

  const results = [];

  // ═══════════════════════════════════════════════════════════════
  // HYPO 1: Range expansion in TRENDING_UP → continuation
  // ═══════════════════════════════════════════════════════════════
  {
    const events = [];
    for (let i = 3; i < n-1; i++) {
      if (atr[i]===null || regimes[i]!=='TRENDING_UP') continue;
      const range = highs[i]-lows[i];
      const prevRange = highs[i-1]-lows[i-1];
      if (prevRange<=0) continue;
      if (range > prevRange*2.0 && range > atr[i] && closes[i]>closes[i-1]) {
        events.push(i);
      }
    }
    results.push(analyzeHypo('range_exp_trend_up', events, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 2: Stop-run continuation in TRENDING_UP only
  // ═══════════════════════════════════════════════════════════════
  {
    const events = [];
    for (let i = 2; i < n-2; i++) {
      if (atr[i]===null || regimes[i+1]!=='TRENDING_UP') continue;
      const wickUp = highs[i]-Math.max(candles[i][1],candles[i][4]);
      const body = Math.abs(candles[i][4]-candles[i][1]);
      if (wickUp > body*2 && wickUp > atr[i]*0.5) {
        if (candles[i+1][4]>candles[i+1][1]) events.push(i+1);
      }
    }
    results.push(analyzeHypo('stop_run_trend_up', events, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 3: Displacement — bullish vs bearish asymmetry
  // ═══════════════════════════════════════════════════════════════
  {
    const bullEvents = [];
    const bearEvents = [];
    for (let i = 5; i < n-1; i++) {
      if (atr[i]===null) continue;
      const body = Math.abs(candles[i][4]-candles[i][1]);
      const range = highs[i]-lows[i];
      if (range===0) continue;
      const bodyRatio = body/range;
      if (bodyRatio > 0.7 && body > atr[i]*1.5) {
        const dir = candles[i][4]>candles[i][1] ? 1 : -1;
        const nextBody = candles[i+1][4]-candles[i+1][1];
        const notReverted = (dir>0 && nextBody>-body*0.5) || (dir<0 && nextBody<body*0.5);
        if (notReverted) {
          if (dir>0) bullEvents.push(i);
          else bearEvents.push(i);
        }
      }
    }
    results.push(analyzeHypo('displacement_bullish', bullEvents, candles, regimes, hours, 24));
    results.push(analyzeHypo('displacement_bearish', bearEvents, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 4: Post-volume-surge continuation (>2σ volume candle)
  // ═══════════════════════════════════════════════════════════════
  {
    const bullEvents = [];
    const bearEvents = [];
    for (let i = 25; i < n-1; i++) {
      if (volSMA[i]===null || volStd[i]===null || volStd[i]===0) continue;
      const volZ = (volumes[i]-volSMA[i])/volStd[i];
      if (volZ > 2.0) {
        const dir = candles[i][4]>candles[i][1] ? 'bull' : 'bear';
        if (dir==='bull') bullEvents.push(i);
        else bearEvents.push(i);
      }
    }
    results.push(analyzeHypo('volume_surge_bull', bullEvents, candles, regimes, hours, 24));
    results.push(analyzeHypo('volume_surge_bear', bearEvents, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 5: 3+ consecutive same-direction candles — regime split
  // ═══════════════════════════════════════════════════════════════
  {
    const trendUpEvents = [];
    const trendDownEvents = [];
    const rangingEvents = [];
    for (let i = 4; i < n-1; i++) {
      if (atr[i]===null) continue;
      let streak = 1;
      const dir = candles[i][4]>candles[i][1] ? 1 : -1;
      for (let j = i-1; j >= i-3 && j >= 0; j--) {
        const d = candles[j][4]>candles[j][1] ? 1 : -1;
        if (d===dir) streak++; else break;
      }
      if (streak >= 3) {
        const regime = regimes[i];
        if (regime==='TRENDING_UP') trendUpEvents.push(i);
        else if (regime==='TRENDING_DOWN') trendDownEvents.push(i);
        else if (regime==='RANGING') rangingEvents.push(i);
      }
    }
    results.push(analyzeHypo('3consec_trend_up', trendUpEvents, candles, regimes, hours, 24));
    results.push(analyzeHypo('3consec_trend_down', trendDownEvents, candles, regimes, hours, 24));
    results.push(analyzeHypo('3consec_ranging', rangingEvents, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 6: ATR z-score crossing from negative to positive (vol regime transition)
  // ═══════════════════════════════════════════════════════════════
  {
    const events = [];
    for (let i = 210; i < n-1; i++) {
      if (atrZ[i]===null || atrZ[i-5]===null) continue;
      if (atrZ[i-5] < -0.3 && atrZ[i] > 0.3) {
        events.push(i);
      }
    }
    results.push(analyzeHypo('atr_cross_negative_to_positive', events, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 7: EMA9 cross above EMA21 + strong bullish candle
  // ═══════════════════════════════════════════════════════════════
  {
    const events = [];
    for (let i = 25; i < n-1; i++) {
      if (ema9[i]===null || ema21[i]===null || atr[i]===null) continue;
      // Golden cross happened in last 3 bars
      const crossedUp = ema9[i]>ema21[i] && ema9[i-3]<=ema21[i-3];
      const strongBody = Math.abs(closes[i]-candles[i][1]) > atr[i]*0.8;
      const bullish = closes[i]>candles[i][1];
      if (crossedUp && strongBody && bullish) events.push(i);
    }
    results.push(analyzeHypo('ema_cross_bull', events, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 8: Higher low pattern (swing low > previous swing low, in uptrend)
  // ═══════════════════════════════════════════════════════════════
  {
    const events = [];
    for (let i = 10; i < n-1; i++) {
      if (atr[i]===null) continue;
      // Current bar is a local low (lower than neighbors)
      const isLocalLow = lows[i] <= lows[i-1] && lows[i] <= lows[i+1] &&
                         lows[i] <= lows[i-2] && lows[i] <= lows[i-3];
      if (!isLocalLow) continue;
      // Find previous local low
      for (let j = i-3; j >= i-20 && j >= 4; j--) {
        const wasLocalLow = lows[j]<=lows[j-1] && lows[j]<=lows[j+1] && lows[j]<=lows[j-2] && lows[j]<=lows[j+2];
        if (wasLocalLow && lows[i] > lows[j] && closes[i] > ema50[i]) {
          events.push(i);
          break;
        }
      }
    }
    results.push(analyzeHypo('higher_low_uptrend', events, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 9: London/NY killzone momentum (hours 6-18 UTC)
  // ═══════════════════════════════════════════════════════════════
  {
    const events = [];
    for (let i = 5; i < n-1; i++) {
      if (atr[i]===null) continue;
      const h = hours[i];
      if ((h >= 6 && h <= 8) || (h >= 13 && h <= 15)) { // London open or NY mid-session
        const body = Math.abs(closes[i]-candles[i][1]);
        if (body > atr[i]*1.0) events.push(i);
      }
    }
    results.push(analyzeHypo('killzone_momentum', events, candles, regimes, hours, 24));
  }

  // ═══════════════════════════════════════════════════════════════
  // HYPO 10: Post-vol-squeeze breakout direction (after squeeze, which way?)
  // ═══════════════════════════════════════════════════════════════
  {
    const bbSma = computeSMA(closes, 20);
    const bbStdDev = computeStdDev(closes, 20);
    const bullEvents = [];
    const bearEvents = [];
    for (let i = 210; i < n-5; i++) {
      if (atrZ[i]===null || bbSma[i]===null) continue;
      // Was in squeeze: atrZ < -0.3 and BB width in bottom 20%
      if (atrZ[i] < -0.3) {
        // Look 5-15 bars ahead for breakout
        for (let j = i+1; j <= i+15 && j < n-1; j++) {
          if (atrZ[j]!==null && atrZ[j] > 0.5) {
            // Breakout detected
            if (closes[j]>closes[j-1]) bullEvents.push(j);
            else bearEvents.push(j);
            break;
          }
        }
      }
    }
    results.push(analyzeHypo('squeeze_breakout_bull', bullEvents, candles, regimes, hours, 24));
    results.push(analyzeHypo('squeeze_breakout_bear', bearEvents, candles, regimes, hours, 24));
  }

  return results;
}

function analyzeHypo(name, indices, candles, regimes, hours, maxHorizon) {
  const unique = [...new Set(indices)].sort((a,b)=>a-b);
  if (unique.length < 30) {
    return { hypothesis: name, status: 'REJECTED', reason: `too few: ${unique.length}`, rawEvents: unique.length };
  }

  // Clustering (min 4 bars)
  const cr = clusteringRatio(unique, 4);
  const independentEst = Math.round(unique.length * (1 - cr*0.8));

  // Forward returns at multiple horizons
  const horizons = [1, 4, 12, 24];
  const statsByH = {};
  for (const h of horizons) {
    const rets = unique.map(i => {
      const ei = i+h;
      return ei < candles.length ? (candles[ei][4]-candles[i][4])/candles[i][4] : null;
    }).filter(r=>r!==null);
    statsByH[h] = stats(rets);
  }

  // Time split at max horizon
  const mid = Math.floor(candles.length/2);
  const first = unique.filter(i=>i<mid);
  const second = unique.filter(i=>i>=mid);
  let splitStable = false;
  let splitInfo = {};
  if (first.length>=10 && second.length>=10) {
    const r1 = first.map(i=>{const ei=i+maxHorizon; return ei<candles.length?(candles[ei][4]-candles[i][4])/candles[i][4]:null;}).filter(r=>r!==null);
    const r2 = second.map(i=>{const ei=i+maxHorizon; return ei<candles.length?(candles[ei][4]-candles[i][4])/candles[i][4]:null;}).filter(r=>r!==null);
    if (r1.length>=8 && r2.length>=8) {
      const m1=r1.reduce((s,v)=>s+v,0)/r1.length;
      const m2=r2.reduce((s,v)=>s+v,0)/r2.length;
      const sameSign = (m1>0&&m2>0)||(m1<0&&m2<0);
      const ratio = Math.abs(m1)>1e-8?Math.abs(m2/m1):(Math.abs(m2)>1e-8?0:1);
      splitStable = sameSign && ratio>0.33 && ratio<3;
      splitInfo = { mean1:m1, mean2:m2, sameSign, ratio, n1:r1.length, n2:r2.length };
    }
  }

  // Regime breakdown at 4h
  const regimeBd = {};
  for (const i of unique) {
    const r = regimes[i]||'UNKNOWN';
    if (!regimeBd[r]) regimeBd[r]=[];
    const ei = i+4;
    if (ei<candles.length) regimeBd[r].push((candles[ei][4]-candles[i][4])/candles[i][4]);
  }
  const regimeStats = {};
  for (const [r,rets] of Object.entries(regimeBd)) {
    if (rets.length>=8) {
      const s = stats(rets);
      if (s) regimeStats[r] = s;
    }
  }

  // Directional asymmetry check at 4h
  const allRets4h = unique.map(i=>{const ei=i+4;return ei<candles.length?(candles[ei][4]-candles[i][4])/candles[i][4]:null;}).filter(r=>r!==null);
  const s4h = stats(allRets4h);

  // Rejection flags
  const flags = [];
  if (cr > 0.50) flags.push(`CLUSTERING: ${(cr*100).toFixed(1)}%`);
  if (independentEst < 30) flags.push(`SAMPLE: ~${independentEst} independent`);
  const bestS = statsByH[maxHorizon];
  if (bestS && !bestS.significant) flags.push(`NOT_SIGNIFICANT: t=${bestS.tStat.toFixed(2)}`);
  if (!splitStable && splitInfo.mean1!=null) flags.push(`UNSTABLE: ${splitInfo.mean1.toFixed(6)} vs ${splitInfo.mean2.toFixed(6)}`);
  if (bestS && Math.abs(bestS.mean)<0.0001) flags.push(`ZERO_EDGE: mean=${(bestS.mean*100).toFixed(4)}%`);

  const status = flags.length===0 ? 'SURVIVED' : 'REJECTED';

  return {
    hypothesis: name,
    status,
    rawEvents: unique.length,
    independentEst,
    clusterRatio: cr,
    stats: statsByH,
    timeSplit: { stable: splitStable, ...splitInfo },
    regimeBreakdown: regimeStats,
    flags
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function fetchCandles(symbol) {
  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const since = new Date(START_DATE).getTime();
  const end = new Date(END_DATE).getTime();
  const all = [];
  let cursor = since;
  while (cursor < end) {
    const candles = await exchange.fetchOHLCV(symbol, TIMEFRAME, cursor, 1000);
    if (!candles||!candles.length) break;
    all.push(...candles);
    cursor = candles[candles.length-1][0]+1;
    await new Promise(r=>setTimeout(r, exchange.rateLimit));
  }
  const seen = new Set();
  const unique = [];
  for (const c of all) { if (!seen.has(c[0])) { seen.add(c[0]); unique.push(c); } }
  return unique.filter(c=>c[0]>=since && c[0]<=end);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔬 EDGE DISCOVERY v2.1 — Deep Conditional Analysis             ║
║  Regime-conditional, directional, volume-conditional edges      ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults = [];

  for (const asset of ASSETS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔬 DEEP ANALYSIS: ${asset.label}`);
    console.log(`${'═'.repeat(60)}`);

    try {
      const candles = await fetchCandles(asset.symbol);
      console.log(`  📥 ${candles.length} candles loaded`);
      const results = runConditionalAnalysis(candles, asset.label);
      allResults.push({ asset: asset.label, results });

      // Print results
      for (const r of results) {
        const icon = r.status==='SURVIVED' ? '✅' : '❌';
        const s = r.stats?.[24];
        console.log(`  ${icon} ${r.hypothesis}: ${r.status} | Events: ${r.rawEvents} | ~${r.independentEst} independent | Cluster: ${(r.clusterRatio*100).toFixed(1)}%`);
        if (s) {
          console.log(`     24h: mean=${(s.mean*100).toFixed(4)}% +rate=${(s.pctPositive*100).toFixed(1)}% t=${s.tStat.toFixed(2)} skew=${s.skew.toFixed(2)}`);
        }
        if (r.flags.length) for (const f of r.flags) console.log(`     🚩 ${f}`);

        // Show regime breakdown if interesting
        const regimeEntries = Object.entries(r.regimeBreakdown);
        if (regimeEntries.length > 0) {
          const interesting = regimeEntries.filter(([_,s]) => s.significant);
          if (interesting.length > 0) {
            for (const [reg, s] of interesting) {
              console.log(`     🌍 ${reg}: n=${s.n} mean=${(s.mean*100).toFixed(4)}% t=${s.tStat.toFixed(2)} ✅`);
            }
          }
        }
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }

  // Generate report
  let report = `# 🔬 EDGE DISCOVERY v2.1 — Deep Conditional Analysis\n`;
  report += `**Generated:** ${new Date().toISOString()}\n\n`;

  // Collect survivors
  const survivors = [];
  for (const ar of allResults) {
    for (const r of ar.results) {
      if (r.status==='SURVIVED') survivors.push({ asset: ar.asset, ...r });
    }
  }

  report += `## SUMMARY\n`;
  report += `- **Total hypotheses:** ${allResults.reduce((s,a)=>s+a.results.length,0)}\n`;
  report += `- **Survived:** ${survivors.length}\n\n`;

  if (survivors.length > 0) {
    report += `## CANDIDATES\n\n`;
    for (const s of survivors) {
      const s24 = s.stats?.[24];
      report += `### ${s.asset} / ${s.hypothesis}\n`;
      report += `- Events: ${s.rawEvents}, Independent: ~${s.independentEst}, Cluster: ${(s.clusterRatio*100).toFixed(1)}%\n`;
      if (s24) {
        report += `- 24h return: mean=${(s24.mean*100).toFixed(4)}%, +rate=${(s24.pctPositive*100).toFixed(1)}%, t=${s24.tStat.toFixed(2)}\n`;
        report += `- Distribution: skew=${s24.skew.toFixed(2)}, kurtosis=${s24.kurtosis.toFixed(2)}\n`;
      }
      report += `- Split: ${s.timeSplit.stable?'STABLE':'UNSTABLE'}\n`;
      if (Object.keys(s.regimeBreakdown).length) {
        report += `- Regimes:\n`;
        for (const [reg,st] of Object.entries(s.regimeBreakdown)) {
          report += `  - ${reg}: n=${st.n} mean=${(st.mean*100).toFixed(4)}% t=${st.tStat.toFixed(2)} ${st.significant?'✅':''}\n`;
        }
      }
      report += `\n`;
    }
  }

  // Rejected summary
  report += `## REJECTED\n\n`;
  for (const ar of allResults) {
    const rejected = ar.results.filter(r=>r.status==='REJECTED');
    for (const r of rejected) {
      report += `- **${ar.asset}/${r.hypothesis}**: ${(r.flags||[r.reason]).join('; ')}\n`;
    }
  }

  const reportPath = path.join(__dirname, '..', 'data', `edge-discovery-deep-${new Date().toISOString().replace(/[:.]/g,'-')}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report saved: ${reportPath}`);

  const jsonPath = path.join(__dirname, '..', 'data', `edge-discovery-deep-raw-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw data saved: ${jsonPath}`);

  console.log(`\n🏁 DEEP ANALYSIS COMPLETE\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
