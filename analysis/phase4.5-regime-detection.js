// ═══════════════════════════════════════════════════════════════════
// PHASE 4.5 — REGIME DETECTION VALIDATION
// ═══════════════════════════════════════════════════════════════════
//
// OBJECTIVE: Can TRENDING_UP be detected in real-time?
// NOT building a trading system. Validating DETECTION.
//
// GROUND TRUTH: ex-post, using future information
// DETECTORS: 5 independent methods using only past/current data
// RULES: NO threshold optimization, NO combining indicators
//
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

// ═══════════════════════════════════════════════════════════════════
// INDICATORS
// ═══════════════════════════════════════════════════════════════════

function computeEMA(data, period) {
  const r = new Array(data.length);
  const k = 2/(period+1);
  r[0] = data[0];
  for (let i = 1; i < data.length; i++) r[i] = data[i]*k + r[i-1]*(1-k);
  return r;
}

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
  const sTR=new Array(n).fill(0),sP=new Array(n).fill(0),sM=new Array(n).fill(0);
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

// ═══════════════════════════════════════════════════════════════════
// STEP 1: GROUND TRUTH (EX-POST)
// ═══════════════════════════════════════════════════════════════════

function defineGroundTruth(candles, threshold = 0.01) {
  const n = candles.length;
  const labels = new Array(n).fill(false);

  for (let i = 0; i < n - 24; i++) {
    const fwdReturn = (candles[i+24].close - candles[i].close) / candles[i].close;
    labels[i] = fwdReturn >= threshold;
  }

  return labels;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2: DETECTORS (5 independent methods)
// ═══════════════════════════════════════════════════════════════════

function buildDetectors(candles, atr, adx, ema9, ema21, ema50) {
  const n = candles.length;
  const closes = candles.map(c => c.close);

  const detectors = {};

  // ── DETECTOR A: ADX-Based ─────────────────────────────────────
  // Traditional trend strength: ADX > 25 AND price > EMA50
  detectors.A_adx = new Array(n).fill(false);
  for (let i = 200; i < n; i++) {
    if (adx[i] === null || ema50[i] === null) continue;
    detectors.A_adx[i] = adx[i] > 25 && closes[i] > ema50[i];
  }

  // ── DETECTOR B: EMA Structure ─────────────────────────────────
  // Bullish EMA alignment: EMA9 > EMA21 > EMA50
  detectors.B_emaStructure = new Array(n).fill(false);
  for (let i = 50; i < n; i++) {
    if (ema9[i] === null || ema21[i] === null || ema50[i] === null) continue;
    detectors.B_emaStructure[i] = ema9[i] > ema21[i] && ema21[i] > ema50[i];
  }

  // ── DETECTOR C: Price Slope ───────────────────────────────────
  // Linear regression slope of last 12 closes > positive threshold
  detectors.C_priceSlope = new Array(n).fill(false);
  const slopeWindow = 12;
  const slopeThreshold = 0.0001; // ~0.01% per hour = 0.24% per day
  for (let i = slopeWindow; i < n; i++) {
    // Simple slope: (last - first) / window
    const slope = (closes[i] - closes[i - slopeWindow + 1]) / (slopeWindow - 1);
    const slopeNorm = slope / closes[i]; // normalized
    detectors.C_priceSlope[i] = slopeNorm > slopeThreshold;
  }

  // ── DETECTOR D: Volatility + Drift ────────────────────────────
  // ATR z-score > 0.5 (expanding volatility) AND positive drift (close > close-8)
  detectors.D_volDrift = new Array(n).fill(false);
  for (let i = 200; i < n; i++) {
    if (atr[i] === null) continue;
    // ATR z-score
    let s = 0, sq = 0, c = 0;
    for (let j = i-199; j <= i; j++) {
      if (atr[j] !== null) { s += atr[j]; sq += atr[j]**2; c++; }
    }
    const m = s/c;
    const std = Math.sqrt(Math.max(0, sq/c - m*m));
    const z = std > 0 ? (atr[i] - m) / std : 0;

    // Positive drift: 8h return positive
    const drift = i >= 8 ? (closes[i] - closes[i-8]) / closes[i-8] : 0;

    detectors.D_volDrift[i] = z > 0.5 && drift > 0.005;
  }

  // ── DETECTOR E: Multi-Condition Conservative ──────────────────
  // ADX > 20 AND EMA9 > EMA21 AND close > EMA50 AND 12h return positive
  detectors.E_multiCondition = new Array(n).fill(false);
  for (let i = 200; i < n; i++) {
    if (adx[i] === null || ema9[i] === null || ema21[i] === null || ema50[i] === null) continue;
    const ret12h = i >= 12 ? (closes[i] - closes[i-12]) / closes[i-12] : 0;
    detectors.E_multiCondition[i] =
      adx[i] > 20 &&
      ema9[i] > ema21[i] &&
      closes[i] > ema50[i] &&
      ret12h > 0;
  }

  return detectors;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3: DETECTION QUALITY
// ═══════════════════════════════════════════════════════════════════

function evaluateDetector(predicted, groundTruth) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const n = Math.min(predicted.length, groundTruth.length);

  for (let i = 0; i < n; i++) {
    if (predicted[i] && groundTruth[i]) tp++;
    else if (predicted[i] && !groundTruth[i]) fp++;
    else if (!predicted[i] && groundTruth[i]) fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const accuracy = (tp + tn) / n;
  const detectionRate = (tp + fp) / n; // % of time detector is ON
  const prevalence = (tp + fn) / n;    // % of time ground truth is TRUE

  // Lift: precision / prevalence (>1 means detector is useful)
  const lift = prevalence > 0 ? precision / prevalence : 0;

  return { tp, fp, tn, fn, precision, recall, f1, accuracy, detectionRate, prevalence, lift };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4: STABILITY TEST
// ═══════════════════════════════════════════════════════════════════

function stabilityTest(predicted, groundTruth, candles) {
  const years = {};
  const n = Math.min(predicted.length, groundTruth.length);

  for (let i = 0; i < n; i++) {
    const y = new Date(candles[i].timestamp).getUTCFullYear();
    if (!years[y]) years[y] = { pred: [], truth: [] };
    years[y].pred.push(predicted[i]);
    years[y].truth.push(groundTruth[i]);
  }

  const byYear = {};
  for (const [y, data] of Object.entries(years)) {
    byYear[y] = evaluateDetector(data.pred, data.truth);
  }

  // Consistency: does precision stay positive across years?
  const precisions = Object.values(byYear).map(d => d.precision);
  const allPositive = precisions.every(p => p > 0.3);
  const minPrecision = Math.min(...precisions);
  const maxPrecision = Math.max(...precisions);
  const precisionRange = maxPrecision - minPrecision;

  return {
    byYear,
    consistent: allPositive && precisionRange < 0.3,
    minPrecision,
    maxPrecision,
    precisionRange,
  };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5: EDGE CONDITIONALITY
// ═══════════════════════════════════════════════════════════════════

function edgeConditionality(predicted, candles) {
  const n = Math.min(predicted.length, candles.length);
  const onReturns = [];
  const offReturns = [];

  for (let i = 0; i < n - 8; i++) {
    const ret = (candles[i+8].close - candles[i].close) / candles[i].close;
    if (predicted[i]) onReturns.push(ret);
    else offReturns.push(ret);
  }

  const onStats = stats(onReturns);
  const offStats = stats(offReturns);

  // Is the edge ISOLATED? ON should be positive, OFF should be neutral or negative
  const isolated = onStats.mean > 0 && onStats.tStat > 2.0;
  const separated = onStats.mean > offStats.mean * 2; // at least 2x better

  return {
    on: onStats,
    off: offStats,
    isolated,
    separated,
    edgeMultiplier: offStats.mean !== 0 ? onStats.mean / offStats.mean : Infinity,
  };
}

// ═══════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════

function stats(arr) {
  const v = arr.filter(x => x !== null && !isNaN(x) && isFinite(x));
  if (v.length < 5) return { n: v.length, mean: 0, median: 0, std: 0, pctPositive: 0, tStat: 0 };
  const n = v.length;
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sorted = [...v].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const pos = v.filter(r => r > 0).length;
  let m2 = 0;
  for (const x of v) { const d = x - mean; m2 += d * d; }
  m2 /= n;
  const std = Math.sqrt(m2);
  const t = std > 0 ? mean / (std / Math.sqrt(n)) : 0;
  return { n, mean, median, std, pctPositive: pos / n, tStat: t };
}

// ═══════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let r = `# 🔍 PHASE 4.5 — REGIME DETECTION VALIDATION\n`;
  r += `**Generated:** ${new Date().toISOString()}\n`;
  r += `**Objective:** Can TRENDING_UP be detected in real-time?\n`;
  r += `**Ground truth:** Forward 24h return >= 1%\n`;
  r += `**Rule:** NO threshold optimization, NO indicator combining\n\n---\n\n`;

  // Detection quality summary
  r += `## DETECTION QUALITY SUMMARY\n\n`;
  r += `| Asset | Detector | Precision | Recall | F1 | Lift | ON% | Stable? |\n`;
  r += `|-------|----------|-----------|--------|----|------|-----|--------|\n`;

  for (const [asset, data] of Object.entries(allResults)) {
    for (const [detName, det] of Object.entries(data.detectors)) {
      const q = det.quality;
      const s = det.stability;
      const stable = s.consistent ? '✅' : '❌';
      const shortName = detName.replace(/^[A-Z]_/, '');
      r += `| ${asset} | ${shortName} | ${(q.precision*100).toFixed(1)}% | ${(q.recall*100).toFixed(1)}% | ${q.f1.toFixed(3)} | ${q.lift.toFixed(2)} | ${(q.detectionRate*100).toFixed(1)}% | ${stable} |\n`;
    }
  }

  r += `\n---\n\n`;

  // Per-asset detail
  for (const [asset, data] of Object.entries(allResults)) {
    r += `## ${asset}\n\n`;
    r += `**Ground truth prevalence:** ${(data.prevalence*100).toFixed(1)}% of candles are TRENDING_UP (24h fwd >= 1%)\n\n`;

    for (const [detName, det] of Object.entries(data.detectors)) {
      const q = det.quality;
      const s = det.stability;
      const ec = det.edgeConditionality;
      const shortName = detName.replace(/^[A-Z]_/, '');

      r += `### Detector: ${shortName}\n\n`;
      r += `**Quality:**\n`;
      r += `- Precision: ${(q.precision*100).toFixed(1)}% (when detecting trend, how often correct)\n`;
      r += `- Recall: ${(q.recall*100).toFixed(1)}% (how much of real trends captured)\n`;
      r += `- F1: ${q.f1.toFixed(3)}\n`;
      r += `- Lift: ${q.lift.toFixed(2)} (>1 = useful)\n`;
      r += `- Detection rate: ${(q.detectionRate*100).toFixed(1)}% of time\n\n`;

      r += `**Stability across years:**\n`;
      r += `| Year | Precision | Recall | F1 | Detection% |\n`;
      r += `|------|-----------|--------|----|-----------|\n`;
      for (const [y, yd] of Object.entries(s.byYear)) {
        r += `| ${y} | ${(yd.precision*100).toFixed(1)}% | ${(yd.recall*100).toFixed(1)}% | ${yd.f1.toFixed(3)} | ${(yd.detectionRate*100).toFixed(1)}% |\n`;
      }
      r += `\nConsistent: ${s.consistent ? 'YES' : 'NO'} (precision range: ${(s.precisionRange*100).toFixed(1)}%)\n\n`;

      r += `**Edge isolation (8h hold):**\n`;
      r += `- Detector ON: mean=${(ec.on.mean*100).toFixed(4)}% t=${ec.on.tStat.toFixed(2)} +rate=${(ec.on.pctPositive*100).toFixed(1)}% (n=${ec.on.n})\n`;
      r += `- Detector OFF: mean=${(ec.off.mean*100).toFixed(4)}% t=${ec.off.tStat.toFixed(2)} +rate=${(ec.off.pctPositive*100).toFixed(1)}% (n=${ec.off.n})\n`;
      r += `- Edge multiplier: ${ec.edgeMultiplier === Infinity ? '∞' : ec.edgeMultiplier.toFixed(1)}×\n`;
      r += `- Isolated: ${ec.isolated ? 'YES' : 'NO'}\n`;
      r += `- Separated: ${ec.separated ? 'YES' : 'NO'}\n\n`;
    }
  }

  // Final decision
  r += `## FINAL DECISION\n\n`;

  const robustDetectors = [];
  const fragileDetectors = [];
  const failedDetectors = [];

  for (const [asset, data] of Object.entries(allResults)) {
    for (const [detName, det] of Object.entries(data.detectors)) {
      const q = det.quality;
      const s = det.stability;
      const ec = det.edgeConditionality;
      const shortName = detName.replace(/^[A-Z]_/, '');

      // Robust: precision > 40%, lift > 1.5, stable, edge isolated
      if (q.precision > 0.4 && q.lift > 1.5 && s.consistent && ec.isolated) {
        robustDetectors.push({ asset, detector: shortName, precision: q.precision, lift: q.lift, f1: q.f1 });
      } else if (q.precision > 0.3 && q.lift > 1.0) {
        fragileDetectors.push({ asset, detector: shortName, precision: q.precision, lift: q.lift, issues: [] });
      } else {
        failedDetectors.push({ asset, detector: shortName, precision: q.precision, lift: q.lift });
      }
    }
  }

  if (robustDetectors.length > 0) {
    r += `### 🟢 CASE A — ROBUST DETECTOR(S) EXIST\n\n`;
    for (const d of robustDetectors) {
      r += `- **${d.asset} / ${d.detector}** — precision=${(d.precision*100).toFixed(1)}%, lift=${d.lift.toFixed(2)}, F1=${d.f1.toFixed(3)}\n`;
    }
    r += `\n→ Proceed to system construction\n`;
  } else {
    r += `### 🔴 CASE B — NO ROBUST DETECTOR\n\n`;
  }

  if (fragileDetectors.length > 0) {
    r += `\n### 🟡 FRAGILE DETECTORS\n\n`;
    for (const d of fragileDetectors) {
      r += `- **${d.asset} / ${d.detector}** — precision=${(d.precision*100).toFixed(1)}%, lift=${d.lift.toFixed(2)}\n`;
    }
  }

  if (failedDetectors.length > 0) {
    r += `\n### 🔴 FAILED DETECTORS\n\n`;
    for (const d of failedDetectors) {
      r += `- **${d.asset} / ${d.detector}** — precision=${(d.precision*100).toFixed(1)}%, lift=${d.lift.toFixed(2)}\n`;
    }
  }

  return r;
}

// ═══════════════════════════════════════════════════════════════════
// DATA
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
  const seen = new Set(); const unique = [];
  for (const c of all) { if (!seen.has(c[0])) { seen.add(c[0]); unique.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }); } }
  console.log(` ${unique.length} ✅`);
  return unique.filter(c => c.timestamp >= since && c.timestamp <= end);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔍 PHASE 4.5 — REGIME DETECTION VALIDATION                     ║
║  Can TRENDING_UP be detected in real-time?                      ║
║  NO optimization. NO combining. Pure detection quality test.    ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults = {};

  for (const asset of ASSETS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔬 ${asset.label}`);
    console.log(`${'═'.repeat(60)}`);

    const candles = await fetchCandles(asset.symbol);
    const closes = candles.map(c => c.close);
    const atr = computeATR(candles, 14);
    const adx = computeADX(candles, 14);
    const ema9 = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const ema50 = computeEMA(closes, 50);

    // Ground truth
    const groundTruth = defineGroundTruth(candles, 0.01);
    const prevalence = groundTruth.filter(Boolean).length / groundTruth.length;
    console.log(`  Ground truth prevalence: ${(prevalence*100).toFixed(1)}%`);

    // Build detectors
    const detectors = buildDetectors(candles, atr, adx, ema9, ema21, ema50);

    const detResults = {};

    for (const [name, predicted] of Object.entries(detectors)) {
      console.log(`\n  ${name}:`);

      const quality = evaluateDetector(predicted, groundTruth);
      const stability = stabilityTest(predicted, groundTruth, candles);
      const edgeCond = edgeConditionality(predicted, candles);

      console.log(`    Precision: ${(quality.precision*100).toFixed(1)}% | Recall: ${(quality.recall*100).toFixed(1)}% | F1: ${quality.f1.toFixed(3)} | Lift: ${quality.lift.toFixed(2)}`);
      console.log(`    ON: mean=${(edgeCond.on.mean*100).toFixed(4)}% t=${edgeCond.on.tStat.toFixed(2)} | OFF: mean=${(edgeCond.off.mean*100).toFixed(4)}% t=${edgeCond.off.tStat.toFixed(2)}`);
      console.log(`    Stable: ${stability.consistent ? 'YES' : 'NO'} | Isolated: ${edgeCond.isolated ? 'YES' : 'NO'}`);

      detResults[name] = { quality, stability, edgeConditionality: edgeCond };
    }

    allResults[asset.label] = { prevalence, detectors: detResults };
  }

  // Generate report
  const report = generateReport(allResults);
  const reportPath = path.join(__dirname, 'PHASE4.5_REGIME_DETECTION.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  const rawPath = path.join(__dirname, 'phase4.5-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw: ${rawPath}`);

  // Final summary
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  🏆 FINAL VERDICT`);
  console.log(`${'═'.repeat(60)}\n`);

  for (const [asset, data] of Object.entries(allResults)) {
    console.log(`\n  ${asset} (prevalence: ${(data.prevalence*100).toFixed(1)}%):`);
    for (const [name, det] of Object.entries(data.detectors)) {
      const q = det.quality;
      const ec = det.edgeConditionality;
      const robust = q.precision > 0.4 && q.lift > 1.5 && det.stability.consistent && ec.isolated;
      const fragile = q.precision > 0.3 && q.lift > 1.0;
      const icon = robust ? '🟢' : fragile ? '🟡' : '🔴';
      console.log(`    ${icon} ${name}: prec=${(q.precision*100).toFixed(1)}% lift=${q.lift.toFixed(2)} stable=${det.stability.consistent} ON_mean=${(ec.on.mean*100).toFixed(4)}%`);
    }
  }

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
