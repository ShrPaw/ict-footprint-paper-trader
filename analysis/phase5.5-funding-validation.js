// ═══════════════════════════════════════════════════════════════════
// PHASE 5.5 — STRUCTURAL EDGE VALIDATION (FUNDING RATES)
// ═══════════════════════════════════════════════════════════════════
// Assume edge is false until proven robust.
// 7 tests: stability, regime independence, timing, friction,
// distribution quality, risk structure, event independence.
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCHANGE = 'binance';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:00Z';

const FEE_RATES = { low: 0.0004, medium: 0.0007, high: 0.0010 };

// ═══════════════════════════════════════════════════════════════════
// INDICATORS
// ═══════════════════════════════════════════════════════════════════

function computeATR(candles, period) {
  const n=candles.length,tr=new Array(n),atr=new Array(n).fill(null);
  tr[0]=candles[0].high-candles[0].low;
  for(let i=1;i<n;i++)tr[i]=Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close));
  let sum=0;for(let i=0;i<n;i++){sum+=tr[i];if(i>=period)sum-=tr[i-period];if(i>=period-1)atr[i]=sum/period;}return atr;
}

function computeEMA(data,period){const r=new Array(data.length),k=2/(period+1);r[0]=data[0];for(let i=1;i<data.length;i++)r[i]=data[i]*k+r[i-1]*(1-k);return r;}

function computeADX(candles,period){
  const n=candles.length,plusDM=new Array(n).fill(0),minusDM=new Array(n).fill(0),tr=new Array(n),adx=new Array(n).fill(null);
  tr[0]=candles[0].high-candles[0].low;
  for(let i=1;i<n;i++){const up=candles[i].high-candles[i-1].high,dn=candles[i-1].low-candles[i].low;plusDM[i]=up>dn&&up>0?up:0;minusDM[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close));}
  const sTR=new Array(n).fill(0),sP=new Array(n).fill(0),sM=new Array(n).fill(0);
  let sumTR=0,sumP=0,sumM=0;for(let i=0;i<period;i++){sumTR+=tr[i];sumP+=plusDM[i];sumM+=minusDM[i];}
  sTR[period-1]=sumTR;sP[period-1]=sumP;sM[period-1]=sumM;
  for(let i=period;i<n;i++){sTR[i]=sTR[i-1]-sTR[i-1]/period+tr[i];sP[i]=sP[i-1]-sP[i-1]/period+plusDM[i];sM[i]=sM[i-1]-sM[i-1]/period+minusDM[i];}
  const dx=new Array(n).fill(0);for(let i=period-1;i<n;i++){if(sTR[i]===0)continue;const pdi=100*sP[i]/sTR[i],mdi=100*sM[i]/sTR[i],ds=pdi+mdi;dx[i]=ds===0?0:100*Math.abs(pdi-mdi)/ds;}
  let s=0;for(let i=0;i<n;i++){s+=dx[i];if(i>=period+period-2){s-=dx[i-period];adx[i]=s/period;}}return adx;
}

function computeSMA(data,period){const r=new Array(data.length).fill(null);let s=0;for(let i=0;i<data.length;i++){s+=data[i];if(i>=period)s-=data[i-period];if(i>=period-1)r[i]=s/period;}return r;}

function detectRegimes(candles,atr,adx){
  const n=candles.length,closes=candles.map(c=>c.close),regimes=new Array(n).fill('UNKNOWN'),atrZ=new Array(n).fill(null);
  for(let i=200;i<n;i++){if(atr[i]===null)continue;let s=0,sq=0,c=0;for(let j=i-199;j<=i;j++){if(atr[j]!==null){s+=atr[j];sq+=atr[j]**2;c++;}}const m=s/c;const std=Math.sqrt(Math.max(0,sq/c-m*m));atrZ[i]=std>0?(atr[i]-m)/std:0;}
  const bbSma=computeSMA(closes,20),bbStdArr=new Array(n).fill(null);
  for(let i=19;i<n;i++){let s=0;for(let j=i-19;j<=i;j++)s+=closes[j];const m=s/20;let sq=0;for(let j=i-19;j<=i;j++)sq+=(closes[j]-m)**2;bbStdArr[i]=Math.sqrt(sq/20);}
  const bbWidth=new Array(n).fill(null);for(let i=0;i<n;i++){if(bbSma[i]!==null&&bbStdArr[i]!==null&&closes[i]>0)bbWidth[i]=(2*2*bbStdArr[i])/closes[i];}
  const ema20=computeEMA(closes,20);
  for(let i=200;i<n;i++){if(atrZ[i]===null||adx[i]===null||bbWidth[i]===null)continue;let bbBelow=0,bbCount=0;for(let j=i-199;j<=i;j++){if(bbWidth[j]!==null){bbCount++;if(bbWidth[j]<bbWidth[i])bbBelow++;}}const bbPct=bbCount>0?bbBelow/bbCount:0.5;
    if(bbPct<0.2&&atrZ[i]<-0.5)regimes[i]='LOW_VOL';else if(bbPct<0.35)regimes[i]='RANGING';else if(adx[i]>25&&atrZ[i]>0.3)regimes[i]=closes[i]>ema20[i]?'TRENDING_UP':'TRENDING_DOWN';else if(atrZ[i]>1.0)regimes[i]='VOL_EXPANSION';else regimes[i]='RANGING';}
  return {regimes,atrZ};
}

// ═══════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════

function stats(arr){
  const v=arr.filter(x=>x!==null&&!isNaN(x)&&isFinite(x));
  if(v.length<5)return{n:v.length,mean:0,median:0,std:0,pctPositive:0,tStat:0,skew:0,kurtosis:0,min:0,max:0,p5:0,p95:0};
  const n=v.length,mean=v.reduce((s,x)=>s+x,0)/n,sorted=[...v].sort((a,b)=>a-b),median=sorted[Math.floor(n/2)],pos=v.filter(r=>r>0).length;
  let m2=0,m3=0,m4=0;for(const x of v){const d=x-mean;m2+=d*d;m3+=d*d*d;m4+=d*d*d*d;}m2/=n;m3/=n;m4/=n;
  const std=Math.sqrt(m2),skew=std>0?m3/(std**3):0,kurtosis=m2>0?m4/(m2**2)-3:0,t=std>0?mean/(std/Math.sqrt(n)):0;
  return{n,mean,median,std,pctPositive:pos/n,tStat:t,skew,kurtosis,min:sorted[0],max:sorted[n-1],
    p5:sorted[Math.floor(n*0.05)],p25:sorted[Math.floor(n*0.25)],p75:sorted[Math.floor(n*0.75)],p95:sorted[Math.floor(n*0.95)]};
}

function percentile(arr,p){const sorted=[...arr].filter(x=>x!==null&&isFinite(x)).sort((a,b)=>a-b);if(sorted.length===0)return 0;return sorted[Math.min(Math.floor(p/100*sorted.length),sorted.length-1)];}

// ═══════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════

async function fetchFundingRates(symbol){
  const exchange=new ccxt[EXCHANGE]({enableRateLimit:true}),since=new Date(START_DATE).getTime(),end=new Date(END_DATE).getTime();
  const all=[];let cursor=since;process.stdout.write(`  📥 Funding ${symbol}...`);
  while(cursor<end){try{const rates=await exchange.fetchFundingRateHistory(symbol,cursor,1000);if(!rates||rates.length===0)break;all.push(...rates);cursor=rates[rates.length-1].timestamp+1;if(rates.length<1000)break;await new Promise(r=>setTimeout(r,exchange.rateLimit));}catch(e){cursor+=8*3600*1000;await new Promise(r=>setTimeout(r,exchange.rateLimit*3));}}
  const seen=new Set(),unique=[];for(const r of all){if(!seen.has(r.timestamp)){seen.add(r.timestamp);unique.push({timestamp:r.timestamp,fundingRate:r.fundingRate,markPrice:r.info?.markPrice?parseFloat(r.info.markPrice):null});}}
  console.log(` ${unique.length} ✅`);return unique.filter(r=>r.timestamp>=since&&r.timestamp<=end);
}

async function fetchCandles(symbol){
  const exchange=new ccxt[EXCHANGE]({enableRateLimit:true}),since=new Date(START_DATE).getTime(),end=new Date(END_DATE).getTime();
  const all=[];let cursor=since;process.stdout.write(`  📥 Candles ${symbol}...`);
  while(cursor<end){const c=await exchange.fetchOHLCV(symbol,'1h',cursor,1000);if(!c||!c.length)break;all.push(...c);cursor=c[c.length-1][0]+1;await new Promise(r=>setTimeout(r,exchange.rateLimit));}
  const seen=new Set(),unique=[];for(const c of all){if(!seen.has(c[0])){seen.add(c[0]);unique.push({timestamp:c[0],open:c[1],high:c[2],low:c[3],close:c[4],volume:c[5]});}}
  console.log(` ${unique.length} ✅`);return unique.filter(c=>c.timestamp>=since&&c.timestamp<=end);
}

function alignFundingToCandles(fr,candles){
  const aligned=[];let ci=0;
  for(const f of fr){while(ci<candles.length-1&&candles[ci].timestamp<f.timestamp)ci++;if(Math.abs(candles[ci].timestamp-f.timestamp)<=3600000)aligned.push({...f,candleIdx:ci});}
  return aligned;
}

// ═══════════════════════════════════════════════════════════════════
// SIGNAL DETECTORS (top 5 from Phase 5)
// ═══════════════════════════════════════════════════════════════════

function detectSignals(alignedFunding, candles){
  const n=alignedFunding.length;
  const rates=alignedFunding.map(f=>f.fundingRate);
  const p5=percentile(rates,5),p10=percentile(rates,10),p90=percentile(rates,90),p95=percentile(rates,95);

  // Cumulative funding (10 periods)
  const cumWindow=10;
  const cumValues=[];
  for(let i=0;i<n;i++){let sum=0;for(let j=Math.max(0,i-cumWindow+1);j<=i;j++)sum+=alignedFunding[j].fundingRate;cumValues.push(sum);}
  const cumP90=percentile(cumValues,90),cumP10=percentile(cumValues,10);

  const signals={};

  // Signal 1: BTC Extreme Low (p10)
  signals.btc_extremeLow_p10 = alignedFunding.filter(f=>f.fundingRate<=p10).map(f=>({idx:f.candleIdx,ts:f.timestamp,rate:f.fundingRate}));

  // Signal 2: XRP High Cumulative Drain
  signals.xrp_highCumDrain = alignedFunding.filter((f,i)=>cumValues[i]>=cumP90).map((f,i)=>({idx:f.candleIdx,ts:f.timestamp,cum:cumValues[i]}));

  // Signal 3: XRP Extreme Low (p10)
  signals.xrp_extremeLow_p10 = alignedFunding.filter(f=>f.fundingRate<=p10).map(f=>({idx:f.candleIdx,ts:f.timestamp,rate:f.fundingRate}));

  // Signal 4: ETH Negative Streak 3+
  const ethNegStreak=[];
  for(let i=2;i<n;i++){let streak=0;for(let j=i;j>=i-2&&j>=0;j--){if(alignedFunding[j].fundingRate<0)streak++;else break;}if(streak>=3)ethNegStreak.push({idx:alignedFunding[i].candleIdx,ts:alignedFunding[i].timestamp,streak});}
  signals.eth_negStreak3 = ethNegStreak;

  // Signal 5: BTC Extreme High (p95)
  signals.btc_extremeHigh_p95 = alignedFunding.filter(f=>f.fundingRate>=p95).map(f=>({idx:f.candleIdx,ts:f.timestamp,rate:f.fundingRate}));

  // Signal 6: ETH High Cumulative Drain
  signals.eth_highCumDrain = alignedFunding.filter((f,i)=>cumValues[i]>=cumP90).map((f,i)=>({idx:f.candleIdx,ts:f.timestamp,cum:cumValues[i]}));

  // Signal 7: BTC High Cumulative Drain
  signals.btc_highCumDrain = alignedFunding.filter((f,i)=>cumValues[i]>=cumP90).map((f,i)=>({idx:f.candleIdx,ts:f.timestamp,cum:cumValues[i]}));

  return signals;
}

// ═══════════════════════════════════════════════════════════════════
// FORWARD RETURN WITH PATH (MAE/MFE)
// ═══════════════════════════════════════════════════════════════════

function analyzeEvent(candles, entryIdx, holdHours){
  const exitIdx=entryIdx+holdHours;
  if(exitIdx>=candles.length||entryIdx>=candles.length)return null;
  const entryPrice=candles[entryIdx].close;
  if(entryPrice<=0)return null;
  const exitPrice=candles[exitIdx].close;
  const netReturn=(exitPrice-entryPrice)/entryPrice;

  // Path: MAE/MFE
  let mae=0,mfe=0,mfeTime=holdHours;
  for(let j=entryIdx;j<=exitIdx;j++){
    const adverse=(candles[j].low-entryPrice)/entryPrice;
    const favorable=(candles[j].high-entryPrice)/entryPrice;
    if(adverse<mae)mae=adverse;
    if(favorable>mfe){mfe=favorable;mfeTime=j-entryIdx;}
  }

  // Time to first positive
  let timeToPos=holdHours;
  for(let j=entryIdx+1;j<=exitIdx;j++){
    if(candles[j].close>entryPrice){timeToPos=j-entryIdx;break;}
  }

  return{
    entryPrice,exitPrice,netReturn,mae,mfe,mfeTime,timeToPos,
    year:new Date(candles[entryIdx].timestamp).getUTCFullYear(),
    hour:new Date(candles[entryIdx].timestamp).getUTCHours(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// FULL VALIDATION
// ═══════════════════════════════════════════════════════════════════

function validateSignal(events, candles, regimes, signalName, holdHours){
  const results=[];
  for(const ev of events){
    const r=analyzeEvent(candles,ev.idx,holdHours);
    if(r){r.regime=regimes[ev.idx]||'UNKNOWN';r.signal=signalName;results.push(r);}
  }
  if(results.length<20)return{status:'INSUFFICIENT_DATA',n:results.length};

  const returns=results.map(r=>r.netReturn);
  const s=stats(returns);

  // T1: Year stability
  const byYear={};
  for(const r of results){if(!byYear[r.year])byYear[r.year]=[];byYear[r.year].push(r.netReturn);}
  const yearStats={};
  let yearsPos=0,yearsTotal=0;
  for(const[y,rets]of Object.entries(byYear)){const ys=stats(rets);yearStats[y]=ys;yearsTotal++;if(ys.mean>0)yearsPos++;}
  const yearConsistency=yearsTotal>0?yearsPos/yearsTotal:0;

  // T2: Regime independence
  const byRegime={};
  for(const r of results){if(!byRegime[r.regime])byRegime[r.regime]=[];byRegime[r.regime].push(r.netReturn);}
  const regimeStats={};
  let regimesPos=0,regimesTotal=0;
  for(const[reg,rets]of Object.entries(byRegime)){if(rets.length>=10){const rs=stats(rets);regimeStats[reg]=rs;regimesTotal++;if(rs.mean>0)regimesPos++;}}
  const regimeIndependence=regimesTotal>0?regimesPos/regimesTotal:0;

  // T3: Entry timing (simulate +1 interval = +8h delay)
  const delayedResults=[];
  for(const ev of events){
    const delayedIdx=ev.idx+8; // +8h (1 funding interval)
    const r=analyzeEvent(candles,delayedIdx,holdHours);
    if(r)delayedResults.push(r.netReturn);
  }
  const delayedStats=stats(delayedResults);

  // T4: Friction impact
  const frictionReturns={
    low:returns.map(r=>r-2*FEE_RATES.low),
    medium:returns.map(r=>r-2*FEE_RATES.medium),
    high:returns.map(r=>r-2*FEE_RATES.high),
  };
  const frictionStats={};
  for(const[k,rets]of Object.entries(frictionReturns))frictionStats[k]=stats(rets);

  // T5: Distribution quality
  const distribution={
    mean:s.mean,median:s.median,skew:s.skew,kurtosis:s.kurtosis,
    meanVsMedian:s.median>0?'median_positive':'median_negative',
    outlierDriven:Math.abs(s.skew)>2.0,
    fatTailed:s.kurtosis>5.0,
  };

  // T6: Risk structure
  const maes=results.map(r=>r.mae);
  const mfe=results.map(r=>r.mfe);
  const worst1=percentile(maes.map(v=>Math.abs(v)),99);
  const worst5=percentile(maes.map(v=>Math.abs(v)),95);
  const riskProfile={
    avgMAE:s.mean<0?stats(maes).mean:stats(maes).mean,
    worst1pctLoss:(worst1*100).toFixed(2)+'%',
    worst5pctLoss:(worst5*100).toFixed(2)+'%',
    boundedRisk:worst1<0.05,
    avgMFE:stats(mfe).mean,
    timeToFirstPositive:stats(results.map(r=>r.timeToPos)),
  };

  // T7: Event independence (clustering)
  const eventTimes=events.map(e=>e.ts).sort((a,b)=>a-b);
  let clustered=0;
  for(let i=1;i<eventTimes.length;i++){
    if(eventTimes[i]-eventTimes[i-1]<8*3600*1000)clustered++; // within 8h
  }
  const clusteringRate=eventTimes.length>1?clustered/(eventTimes.length-1):0;
  const independentEst=Math.round(results.length*(1-clusteringRate*0.8));

  // Classification
  const flags=[];
  let score=0;

  if(s.tStat>2.0&&s.mean>0)score+=2;else flags.push('Not significant or negative');
  if(yearConsistency>=0.6)score+=1;else if(yearConsistency<0.4)flags.push('Negative in majority of years');
  if(regimeIndependence>=0.5)score+=1;else flags.push('Regime dependent');
  if(delayedStats.mean>0&&delayedStats.tStat>1.5)score+=1;else flags.push('Killed by 8h delay');
  if(frictionStats.medium.mean>0)score+=1;else flags.push('Killed by friction');
  if(!distribution.outlierDriven)score+=1;else flags.push('Skew-driven (>2.0)');
  if(riskProfile.boundedRisk)score+=1;else flags.push('Unbounded tail risk');
  if(independentEst>=50)score+=1;else flags.push('Too few independent events');

  let classification;
  if(score>=7)classification='ROBUST STRUCTURAL EDGE';
  else if(score>=5)classification='CONDITIONAL EDGE';
  else if(score>=3)classification='FRAGILE';
  else classification='NON-EXTRACTABLE';

  return{
    status:'COMPLETE',
    events:results.length,independentEst,clusteringRate,
    baseline:s,byYear:yearStats,yearConsistency,
    byRegime:regimeStats,regimeIndependence,
    delayed:delayedStats,friction:frictionStats,
    distribution,risk:riskProfile,
    classification:{class:classification,score,maxScore:8,flags},
  };
}

// ═══════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults){
  let r=`# 🔬 PHASE 5.5 — STRUCTURAL EDGE VALIDATION\n`;
  r+=`**Generated:** ${new Date().toISOString()}\n`;
  r+=`**Data:** Binance funding rates (8h) + 1h candles, ${START_DATE.slice(0,10)} → ${END_DATE.slice(0,10)}\n`;
  r+=`**Assumption:** Edge is false until proven robust.\n\n---\n\n`;

  // Summary
  r+=`## CLASSIFICATION SUMMARY\n\n`;
  r+=`| Signal | Events | Indep. | Mean 48h | t-stat | Friction OK | Stable | Class |\n`;
  r+=`|--------|--------|--------|----------|--------|-------------|--------|-------|\n`;

  for(const[sigName,data]of Object.entries(allResults)){
    if(data.status!=='COMPLETE')continue;
    const b=data.baseline;
    const fo=data.friction.medium.mean>0?'✅':'❌';
    const st=data.yearConsistency>=0.6?'✅':'❌';
    const icon=data.classification.class==='ROBUST STRUCTURAL EDGE'?'🟢':data.classification.class==='CONDITIONAL EDGE'?'🟡':'🔴';
    r+=`| ${sigName} | ${data.events} | ${data.independentEst} | ${(b.mean*100).toFixed(4)}% | ${b.tStat.toFixed(2)} | ${fo} | ${st} | ${icon} ${data.classification.class} |\n`;
  }
  r+=`\n---\n\n`;

  // Detailed
  for(const[sigName,data]of Object.entries(allResults)){
    if(data.status!=='COMPLETE')continue;
    const b=data.baseline;

    r+=`## ${sigName}\n\n`;
    r+=`**Classification:** ${data.classification.class} (score: ${data.classification.score}/${data.classification.maxScore})\n`;
    if(data.classification.flags.length>0){r+=`**Flags:**\n`;for(const f of data.classification.flags)r+=`- ${f}\n`;}
    r+=`\n`;

    r+=`### T1 — Year Stability\n`;
    r+=`| Year | Mean | t-stat | n | WR |\n`;
    r+=`|------|------|--------|---|----|\n`;
    for(const[y,ys]of Object.entries(data.byYear))r+=`| ${y} | ${(ys.mean*100).toFixed(4)}% | ${ys.tStat.toFixed(2)} | ${ys.n} | ${(ys.pctPositive*100).toFixed(1)}% |\n`;
    r+=`\nConsistency: ${(data.yearConsistency*100).toFixed(0)}%\n\n`;

    r+=`### T2 — Regime Independence\n`;
    r+=`| Regime | Mean | t-stat | n |\n`;
    r+=`|--------|------|--------|---|\n`;
    for(const[reg,rs]of Object.entries(data.byRegime))r+=`| ${reg} | ${(rs.mean*100).toFixed(4)}% | ${rs.tStat.toFixed(2)} | ${rs.n} |\n`;
    r+=`\nRegime independence: ${(data.regimeIndependence*100).toFixed(0)}%\n\n`;

    r+=`### T3 — Timing\n`;
    r+=`- On signal: mean=${(b.mean*100).toFixed(4)}% t=${b.tStat.toFixed(2)}\n`;
    r+=`- +8h delay: mean=${(data.delayed.mean*100).toFixed(4)}% t=${data.delayed.tStat.toFixed(2)}\n`;
    r+=`- Retention: ${b.mean!==0?((data.delayed.mean/b.mean)*100).toFixed(0):0}%\n\n`;

    r+=`### T4 — Friction\n`;
    for(const[k,fs]of Object.entries(data.friction))r+=`- ${k}: mean=${(fs.mean*100).toFixed(4)}% t=${fs.tStat.toFixed(2)}\n`;
    r+=`\n`;

    r+=`### T5 — Distribution\n`;
    r+=`- Mean: ${(data.distribution.mean*100).toFixed(4)}% | Median: ${(data.distribution.median*100).toFixed(4)}%\n`;
    r+=`- Skew: ${data.distribution.skew.toFixed(2)} | Kurtosis: ${data.distribution.kurtosis.toFixed(2)}\n`;
    r+=`- Outlier driven: ${data.distribution.outlierDriven?'YES ⚠️':'No'} | Fat tailed: ${data.distribution.fatTailed?'YES ⚠️':'No'}\n\n`;

    r+=`### T6 — Risk\n`;
    r+=`- Worst 1%: ${data.risk.worst1pctLoss} | Worst 5%: ${data.risk.worst5pctLoss}\n`;
    r+=`- Bounded: ${data.risk.boundedRisk?'YES':'NO'}\n`;
    r+=`- Avg MFE: ${(data.risk.avgMFE*100).toFixed(4)}%\n`;
    r+=`- Time to positive: mean=${data.risk.timeToFirstPositive.mean?.toFixed(1)}h median=${data.risk.timeToFirstPositive.median?.toFixed(1)}h\n\n`;

    r+=`### T7 — Event Independence\n`;
    r+=`- Clustering rate: ${(data.clusteringRate*100).toFixed(1)}%\n`;
    r+=`- Independent events (est.): ${data.independentEst}\n\n---\n\n`;
  }

  // Final verdict
  r+=`## FINAL VERDICT\n\n`;
  const robust=Object.entries(allResults).filter(([_,d])=>d.classification?.class==='ROBUST STRUCTURAL EDGE');
  const conditional=Object.entries(allResults).filter(([_,d])=>d.classification?.class==='CONDITIONAL EDGE');
  const fragile=Object.entries(allResults).filter(([_,d])=>d.classification?.class==='FRAGILE');
  const rejected=Object.entries(allResults).filter(([_,d])=>d.classification?.class==='NON-EXTRACTABLE'||d.status!=='COMPLETE');

  r+=`### 🟢 ROBUST STRUCTURAL EDGE (${robust.length})\n`;
  for(const[n,d]of robust)r+=`- **${n}**: ${d.events} events, mean=${(d.baseline.mean*100).toFixed(4)}%, t=${d.baseline.tStat.toFixed(2)}\n`;
  if(!robust.length)r+=`- None\n`;

  r+=`\n### 🟡 CONDITIONAL EDGE (${conditional.length})\n`;
  for(const[n,d]of conditional)r+=`- **${n}**: ${d.classification.flags.join('; ')}\n`;
  if(!conditional.length)r+=`- None\n`;

  r+=`\n### 🔴 FRAGILE / NON-EXTRACTABLE (${fragile.length+rejected.length})\n`;
  for(const[n,d]of[...fragile,...rejected])r+=`- **${n}**: ${d.classification?.flags?.join('; ')||d.status}\n`;
  if(!fragile.length&&!rejected.length)r+=`- None\n`;

  return r;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main(){
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔬 PHASE 5.5 — STRUCTURAL EDGE VALIDATION                      ║
║  7-test validation of funding rate positioning edge              ║
║  Assume false until proven robust.                               ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults={};
  const holdHours=48; // optimal from Phase 5

  for(const asset of['BTC','ETH','XRP']){
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔬 ${asset}`);
    console.log(`${'═'.repeat(60)}`);

    const sym={BTC:'BTC/USDT:USDT',ETH:'ETH/USDT:USDT',XRP:'XRP/USDT:USDT'}[asset];
    const fundingRates=await fetchFundingRates(sym);
    const candles=await fetchCandles(sym);
    const aligned=alignFundingToCandles(fundingRates,candles);

    const atr=computeATR(candles,14);
    const adx=computeADX(candles,14);
    const {regimes}=detectRegimes(candles,atr,adx);

    console.log(`  Aligned: ${aligned.length} funding events`);

    // Detect signals for this asset
    const signals=detectSignals(aligned,candles);

    // Validate only relevant signals for this asset
    const relevantSignals={
      BTC:['btc_extremeLow_p10','btc_extremeHigh_p95','btc_highCumDrain'],
      ETH:['eth_negStreak3','eth_highCumDrain'],
      XRP:['xrp_highCumDrain','xrp_extremeLow_p10'],
    }[asset];

    for(const sigName of relevantSignals){
      const events=signals[sigName];
      if(!events||events.length<20){
        console.log(`  ${sigName}: insufficient (${events?.length||0})`);
        allResults[sigName]={status:'INSUFFICIENT_DATA',n:events?.length||0};
        continue;
      }

      console.log(`\n  Validating ${sigName} (${events.length} events)...`);
      const result=validateSignal(events,candles,regimes,sigName,holdHours);
      allResults[sigName]=result;

      if(result.status==='COMPLETE'){
        const b=result.baseline;
        const c=result.classification;
        console.log(`    Baseline: mean=${(b.mean*100).toFixed(4)}% t=${b.tStat.toFixed(2)} +rate=${(b.pctPositive*100).toFixed(1)}%`);
        console.log(`    Years: ${(result.yearConsistency*100).toFixed(0)}% positive | Regimes: ${(result.regimeIndependence*100).toFixed(0)}% positive`);
        console.log(`    Delay +8h: ${(result.delayed.mean*100).toFixed(4)}% | Friction med: ${(result.friction.medium.mean*100).toFixed(4)}%`);
        console.log(`    Risk: worst1%=${result.risk.worst1pctLoss} bounded=${result.risk.boundedRisk}`);
        console.log(`    ${c.class==='ROBUST STRUCTURAL EDGE'?'🟢':c.class==='CONDITIONAL EDGE'?'🟡':'🔴'} ${c.class} (${c.score}/${c.maxScore})`);
        if(c.flags.length>0)for(const f of c.flags)console.log(`      ⚠️ ${f}`);
      }
    }
  }

  // Report
  const report=generateReport(allResults);
  const rp=path.join(__dirname,'PHASE5.5_VALIDATION_REPORT.md');
  fs.writeFileSync(rp,report);
  console.log(`\n  ✅ Report: ${rp}`);

  const rawPath=path.join(__dirname,'phase5.5-raw.json');
  fs.writeFileSync(rawPath,JSON.stringify(allResults,null,2));
  console.log(`  ✅ Raw: ${rawPath}`);

  // Final
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  🏆 FINAL VERDICT`);
  console.log(`${'═'.repeat(60)}\n`);

  for(const[name,data]of Object.entries(allResults)){
    if(data.status!=='COMPLETE'){console.log(`  🔴 ${name} — ${data.status}`);continue;}
    const c=data.classification;
    const icon=c.class==='ROBUST STRUCTURAL EDGE'?'🟢':c.class==='CONDITIONAL EDGE'?'🟡':'🔴';
    console.log(`  ${icon} ${name} — ${c.class} (${c.score}/${c.maxScore})`);
    if(c.flags.length>0)for(const f of c.flags)console.log(`     ⚠️ ${f}`);
  }

  console.log(`\n  Done.`);
}

main().catch(err=>{console.error('Fatal:',err);process.exit(1);});
