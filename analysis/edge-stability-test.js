// ═══════════════════════════════════════════════════════════════════
// EDGE DISCOVERY v2.2 — ADVERSARIAL STABILITY TEST
// ═══════════════════════════════════════════════════════════════════
// Tests the top candidates from v2.1 for:
// 1. Year-by-year consistency
// 2. Quarterly consistency
// 3. Regime-conditional stability
// 4. Subsample bootstrap
// 5. Directional bias verification (is it real or skewed?)
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

// ── Indicators (minimal set) ──────────────────────────────────

function computeATR(c, p) {
  const n=c.length, tr=new Array(n), atr=new Array(n).fill(null);
  tr[0]=c[0][2]-c[0][3];
  for(let i=1;i<n;i++) tr[i]=Math.max(c[i][2]-c[i][3],Math.abs(c[i][2]-c[i-1][4]),Math.abs(c[i][3]-c[i-1][4]));
  let s=0; for(let i=0;i<n;i++){s+=tr[i];if(i>=p)s-=tr[i-p];if(i>=p-1)atr[i]=s/p;}
  return atr;
}
function computeEMA(d,p){const r=new Array(d.length),k=2/(p+1);r[0]=d[0];for(let i=1;i<d.length;i++)r[i]=d[i]*k+r[i-1]*(1-k);return r;}
function computeSMA(d,p){const r=new Array(d.length).fill(null);let s=0;for(let i=0;i<d.length;i++){s+=d[i];if(i>=p)s-=d[i-p];if(i>=p-1)r[i]=s/p;}return r;}
function computeStdDev(d,p){const r=new Array(d.length).fill(null);for(let i=p-1;i<d.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=d[j];const m=s/p;let sq=0;for(let j=i-p+1;j<=i;j++)sq+=(d[j]-m)**2;r[i]=Math.sqrt(sq/p);}return r;}
function computeADX(c,p){
  const n=c.length,pd=new Array(n).fill(0),md=new Array(n).fill(0),tr=new Array(n),adx=new Array(n).fill(null);
  tr[0]=c[0][2]-c[0][3];
  for(let i=1;i<n;i++){const u=c[i][2]-c[i-1][2],d=c[i-1][3]-c[i][3];pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i][2]-c[i][3],Math.abs(c[i][2]-c[i-1][4]),Math.abs(c[i][3]-c[i-1][4]));}
  const sT=new Array(n).fill(0),sP=new Array(n).fill(0),sM=new Array(n).fill(0);
  let st=0,sp=0,sm=0;for(let i=0;i<p;i++){st+=tr[i];sp+=pd[i];sm+=md[i];}
  sT[p-1]=st;sP[p-1]=sp;sM[p-1]=sm;
  for(let i=p;i<n;i++){sT[i]=sT[i-1]-sT[i-1]/p+tr[i];sP[i]=sP[i-1]-sP[i-1]/p+pd[i];sM[i]=sM[i-1]-sM[i-1]/p+md[i];}
  const dx=new Array(n).fill(0);
  for(let i=p-1;i<n;i++){if(sT[i]===0)continue;const pi=100*sP[i]/sT[i],mi=100*sM[i]/sT[i],ds=pi+mi;dx[i]=ds===0?0:100*Math.abs(pi-mi)/ds;}
  let s=0;for(let i=0;i<n;i++){s+=dx[i];if(i>=p+p-2){s-=dx[i-p];adx[i]=s/p;}}
  return adx;
}

function detectRegimes(candles,atr,adx){
  const n=candles.length,closes=candles.map(c=>c[4]),regs=new Array(n).fill('UNKNOWN');
  const atrZ=new Array(n).fill(null);
  for(let i=200;i<n;i++){if(atr[i]===null)continue;let s=0,q=0,c=0;for(let j=i-199;j<=i;j++)if(atr[j]!==null){s+=atr[j];q+=atr[j]**2;c++;}const m=s/c,std=Math.sqrt(q/c-m**2);atrZ[i]=std>0?(atr[i]-m)/std:0;}
  const bbS=computeSMA(closes,20),bbD=computeStdDev(closes,20),bbW=new Array(n).fill(null);
  for(let i=0;i<n;i++)if(bbS[i]!==null&&bbD[i]!==null&&closes[i]>0)bbW[i]=(2*2*bbD[i])/closes[i];
  const ema20=computeEMA(closes,20);
  for(let i=200;i<n;i++){
    if(atrZ[i]===null||adx[i]===null||bbW[i]===null)continue;
    let bbB=0,bbC=0;for(let j=i-199;j<=i;j++)if(bbW[j]!==null){bbC++;if(bbW[j]<bbW[i])bbB++;}
    const bp=bbC>0?bbB/bbC:0.5;
    if(bp<0.2&&atrZ[i]<-0.5)regs[i]='LOW_VOL';
    else if(bp<0.35)regs[i]='RANGING';
    else if(adx[i]>25&&atrZ[i]>0.3)regs[i]=closes[i]>ema20[i]?'TRENDING_UP':'TRENDING_DOWN';
    else if(atrZ[i]>1.0)regs[i]='VOL_EXPANSION';
    else regs[i]='RANGING';
  }
  return regs;
}

function s(returns){
  const v=returns.filter(r=>r!==null&&!isNaN(r));if(v.length<5)return null;
  const n=v.length,mean=v.reduce((s,x)=>s+x,0)/n;
  const sorted=[...v].sort((a,b)=>a-b),median=sorted[Math.floor(n/2)];
  const pos=v.filter(r=>r>0).length;
  let m2=0;for(const x of v){const d=x-mean;m2+=d*d;}m2/=n;
  const std=Math.sqrt(m2),t=std>0?mean/(std/Math.sqrt(n)):0;
  return{n,mean,median,std,pctPositive:pos/n,tStat:t,sig:Math.abs(t)>1.96};
}

// ── Event detectors ──────────────────────────────────────────

function detectHigherLowUptrend(candles,atr,regs){
  const n=candles.length,lows=candles.map(c=>c[3]),closes=candles.map(c=>c[4]),ema50=computeEMA(closes,50);
  const events=[];
  for(let i=10;i<n-1;i++){
    if(atr[i]===null)continue;
    const isLL=lows[i]<=lows[i-1]&&lows[i]<=lows[i+1]&&lows[i]<=lows[i-2]&&lows[i]<=lows[i-3];
    if(!isLL)continue;
    for(let j=i-3;j>=Math.max(i-20,4);j--){
      const wLL=lows[j]<=lows[j-1]&&lows[j]<=lows[j+1]&&lows[j]<=lows[j-2]&&lows[j]<=lows[j+2];
      if(wLL&&lows[i]>lows[j]&&closes[i]>ema50[i]){events.push({index:i,regime:regs[i]});break;}
    }
  }
  return events;
}

function detectDisplacementBullish(candles,atr){
  const n=candles.length,events=[];
  for(let i=5;i<n-1;i++){
    if(atr[i]===null)continue;
    const body=Math.abs(candles[i][4]-candles[i][1]),range=candles[i][2]-candles[i][3];
    if(range===0)continue;
    if(body/range>0.7&&body>atr[i]*1.5&&candles[i][4]>candles[i][1]){
      const nb=candles[i+1][4]-candles[i+1][1];
      if(nb>-body*0.5)events.push({index:i,regime:'ANY'});
    }
  }
  return events;
}

function detectStopRunTrendUp(candles,atr,regs){
  const n=candles.length,events=[];
  for(let i=2;i<n-2;i++){
    if(atr[i]===null||regs[i+1]!=='TRENDING_UP')continue;
    const wickUp=candles[i][2]-Math.max(candles[i][1],candles[i][4]),body=Math.abs(candles[i][4]-candles[i][1]);
    if(wickUp>body*2&&wickUp>atr[i]*0.5&&candles[i+1][4]>candles[i+1][1])events.push({index:i+1,regime:'TRENDING_UP'});
  }
  return events;
}

// ── Stability tests ──────────────────────────────────────────

function yearByYear(candles,events,maxH){
  const years={};
  for(const e of events){
    const yr=new Date(candles[e.index][0]).getUTCFullYear();
    if(!years[yr])years[yr]=[];
    const ei=e.index+maxH;
    if(ei<candles.length)years[yr].push((candles[ei][4]-candles[e.index][4])/candles[e.index][4]);
  }
  const result={};
  for(const [yr,rets] of Object.entries(years)){
    if(rets.length>=5)result[yr]=s(rets);
  }
  return result;
}

function quarterByQuarter(candles,events,maxH){
  const qtrs={};
  for(const e of events){
    const d=new Date(candles[e.index][0]);
    const q=`${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth()/3)+1}`;
    if(!qtrs[q])qtrs[q]=[];
    const ei=e.index+maxH;
    if(ei<candles.length)qtrs[q].push((candles[ei][4]-candles[e.index][4])/candles[e.index][4]);
  }
  const result={};
  for(const [q,rets] of Object.entries(qtrs)){
    if(rets.length>=5)result[q]=s(rets);
  }
  return result;
}

function subsampleTest(candles,events,maxH,iterations=20){
  const rets=events.map(e=>{
    const ei=e.index+maxH;
    return ei<candles.length?(candles[ei][4]-candles[e.index][4])/candles[e.index][4]:null;
  }).filter(r=>r!==null);

  if(rets.length<30)return{valid:false};

  let stableCount=0;
  const allMean=rets.reduce((s,v)=>s+v,0)/rets.length;

  for(let iter=0;iter<iterations;iter++){
    // Random 50% subsample
    const shuffled=[...rets].sort(()=>Math.random()-0.5);
    const half=shuffled.slice(0,Math.floor(shuffled.length/2));
    const subMean=half.reduce((s,v)=>s+v,0)/half.length;
    const sameSign=(allMean>0&&subMean>0)||(allMean<0&&subMean<0);
    if(sameSign)stableCount++;
  }

  return{valid:true,stablePct:stableCount/iterations,allMean};
}

// ── Main ─────────────────────────────────────────────────────

async function fetchCandles(symbol){
  const ex=new ccxt[EXCHANGE]({enableRateLimit:true});
  const since=new Date(START_DATE).getTime(),end=new Date(END_DATE).getTime();
  const all=[];let cur=since;
  while(cur<end){const c=await ex.fetchOHLCV(symbol,TIMEFRAME,cur,1000);if(!c||!c.length)break;all.push(...c);cur=c[c.length-1][0]+1;await new Promise(r=>setTimeout(r,ex.rateLimit));}
  const seen=new Set(),u=[];for(const c of all){if(!seen.has(c[0])){seen.add(c[0]);u.push(c);}}
  return u.filter(c=>c[0]>=since&&c[0]<=end);
}

async function testCandidate(symbol,label,detectorFn,detectorName,maxH=24){
  console.log(`\n  🔬 ${label}/${detectorName}`);

  const candles=await fetchCandles(symbol);
  const atr=computeATR(candles,14);
  const adx=computeADX(candles,14);
  const regs=detectRegimes(candles,atr,adx);

  const events=detectorFn(candles,atr,regs);
  console.log(`    Events: ${events.length}`);

  if(events.length<30){console.log(`    ⚠️  Too few events`);return null;}

  // Overall stats
  const rets=events.map(e=>{const ei=e.index+maxH;return ei<candles.length?(candles[ei][4]-candles[e.index][4])/candles[e.index][4]:null;}).filter(r=>r!==null);
  const overall=s(rets);
  console.log(`    Overall: mean=${(overall.mean*100).toFixed(4)}% +rate=${(overall.pctPositive*100).toFixed(1)}% t=${overall.tStat.toFixed(2)} ${overall.sig?'✅':'❌'}`);

  // Year-by-year
  const yby=yearByYear(candles,events,maxH);
  const years=Object.entries(yby);
  const consistentYears=years.filter(([_,st])=>st.sig&&(st.mean>0)===(overall.mean>0));
  console.log(`    Year-by-year: ${consistentYears.length}/${years.length} years significant + same direction`);
  for(const [yr,st] of years){
    const icon=st.sig&&((st.mean>0)===(overall.mean>0))?'✅':'❌';
    console.log(`      ${yr}: n=${st.n} mean=${(st.mean*100).toFixed(4)}% t=${st.tStat.toFixed(2)} ${icon}`);
  }

  // Quarter-by-quarter consistency
  const qby=quarterByQuarter(candles,events,maxH);
  const quarters=Object.entries(qby);
  const consistentQ=quarters.filter(([_,st])=>(st.mean>0)===(overall.mean>0));
  console.log(`    Quarterly: ${consistentQ.length}/${quarters.length} quarters same direction`);

  // Subsample bootstrap
  const sub=subsampleTest(candles,events,maxH);
  if(sub.valid)console.log(`    Subsample: ${(sub.stablePct*100).toFixed(0)}% of random halves agree (${sub.allMean>0?'long':'short'})`);

  // Regime breakdown
  const regBd={};
  for(const e of events){
    const r=e.regime||regs[e.index]||'UNKNOWN';
    if(!regBd[r])regBd[r]=[];
    const ei=e.index+maxH;
    if(ei<candles.length)regBd[r].push((candles[ei][4]-candles[e.index][4])/candles[e.index][4]);
  }
  console.log(`    Regimes:`);
  for(const [r,rets] of Object.entries(regBd)){
    if(rets.length>=8){const st=s(rets);if(st)console.log(`      ${r}: n=${st.n} mean=${(st.mean*100).toFixed(4)}% t=${st.tStat.toFixed(2)} ${st.sig?'✅':''}`);}
  }

  // VERDICT
  const yearConsistency=consistentYears.length/Math.max(years.length,1);
  const qConsistency=consistentQ.length/Math.max(quarters.length,1);
  const robust=overall.sig&&yearConsistency>=0.6&&qConsistency>=0.6&&(sub.valid?sub.stablePct>=0.8:true);

  console.log(`    ══ VERDICT: ${robust?'🟢 ROBUST':'🔴 FRAGILE'} ══`);

  return{
    label,detector:detectorName,
    events:events.length,overall,
    yearByYear:yby,quarterByQuarter:qby,
    yearConsistency,qConsistency,
    subsample:sub,robust
  };
}

async function main(){
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔬 EDGE DISCOVERY v2.2 — Adversarial Stability Test            ║
║  Year-by-year, quarterly, subsample bootstrap                   ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const candidates=[
    // ETH
    {sym:'ETH/USDT:USDT',label:'ETH',fn:(c,a,r)=>detectDisplacementBullish(c,a),name:'displacement_bullish'},
    {sym:'ETH/USDT:USDT',label:'ETH',fn:(c,a,r)=>detectHigherLowUptrend(c,a,r),name:'higher_low_uptrend'},
    // SOL
    {sym:'SOL/USDT:USDT',label:'SOL',fn:(c,a,r)=>detectStopRunTrendUp(c,a,r),name:'stop_run_trend_up'},
    {sym:'SOL/USDT:USDT',label:'SOL',fn:(c,a,r)=>detectDisplacementBullish(c,a),name:'displacement_bullish'},
    {sym:'SOL/USDT:USDT',label:'SOL',fn:(c,a,r)=>detectHigherLowUptrend(c,a,r),name:'higher_low_uptrend'},
    // BTC
    {sym:'BTC/USDT:USDT',label:'BTC',fn:(c,a,r)=>detectDisplacementBullish(c,a),name:'displacement_bullish'},
    {sym:'BTC/USDT:USDT',label:'BTC',fn:(c,a,r)=>detectHigherLowUptrend(c,a,r),name:'higher_low_uptrend'},
    // XRP
    {sym:'XRP/USDT:USDT',label:'XRP',fn:(c,a,r)=>{
      const n=c.length,vols=c.map(x=>x[5]),vSMA=computeSMA(vols,20),vStd=computeStdDev(vols,20);
      const events=[];
      for(let i=25;i<n-1;i++){if(vSMA[i]===null||vStd[i]===null||vStd[i]===0)continue;
        const vz=(vols[i]-vSMA[i])/vStd[i];if(vz>2.0&&c[i][4]<c[i][1])events.push({index:i,regime:r[i]});}
      return events;
    },name:'volume_surge_bear'},
  ];

  const results=[];
  for(const c of candidates){
    try{
      const r=await testCandidate(c.sym,c.label,c.fn,c.name);
      if(r)results.push(r);
    }catch(e){console.error(`  ❌ ${c.label}/${c.name}: ${e.message}`);}
  }

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 FINAL STABILITY ASSESSMENT`);
  console.log(`${'═'.repeat(60)}\n`);

  const robust=results.filter(r=>r.robust);
  const fragile=results.filter(r=>!r.robust);

  if(robust.length>0){
    console.log(`  🟢 ROBUST CANDIDATES:`);
    for(const r of robust){
      console.log(`    ${r.label}/${r.detector}: mean=${(r.overall.mean*100).toFixed(4)}% t=${r.overall.tStat.toFixed(2)} ${r.overall.sig?'✅':''} | ${r.events} events | Y:${(r.yearConsistency*100).toFixed(0)}% Q:${(r.qConsistency*100).toFixed(0)}%`);
    }
  }
  if(fragile.length>0){
    console.log(`\n  🔴 FRAGILE CANDIDATES:`);
    for(const r of fragile){
      console.log(`    ${r.label}/${r.detector}: mean=${(r.overall.mean*100).toFixed(4)}% t=${r.overall.tStat.toFixed(2)} | Y:${(r.yearConsistency*100).toFixed(0)}% Q:${(r.qConsistency*100).toFixed(0)}%`);
    }
  }

  // Save
  const reportPath=path.join(__dirname,'..','data',`edge-stability-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  fs.writeFileSync(reportPath,JSON.stringify(results,null,2));
  console.log(`\n  ✅ Results saved: ${reportPath}\n`);
}

main().catch(e=>{console.error('Fatal:',e);process.exit(1);});
