// ═══════════════════════════════════════════════════════════════════
// CATASTROPHIC WINDOW FORENSICS — Real-Time Detectability Analysis
// ═══════════════════════════════════════════════════════════════════
// Post-mortem of the 4 catastrophic BTC windows.
// Uses ONLY data available at signal generation time.
// No hindsight. No optimization. Pure forensic reconstruction.
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  symbol: 'BTC/USDT:USDT',
  extremeLowPct: 10,
  extremeHighPct: 95,
  cumulativeDrainPct: 90,
  cumulativeWindow: 10,
  holdHours: 48,
};

// Catastrophic windows from walk-forward
const CATASTROPHIC_WINDOWS = [
  { id: 'W2', label: 'Terra/Luna + 3AC', testStart: '2022-04-02', testEnd: '2022-07-02', trainStart: '2021-04-02', pf: 0.52 },
  { id: 'W4', label: 'FTX aftermath', testStart: '2022-10-02', testEnd: '2023-01-01', trainStart: '2021-10-01', pf: 0.37 },
  { id: 'W7', label: 'Low-vol grind', testStart: '2023-07-03', testEnd: '2023-10-02', trainStart: '2022-07-02', pf: 0.48 },
  { id: 'W15', label: 'Unknown (2025)', testStart: '2025-07-02', testEnd: '2025-10-01', trainStart: '2024-07-02', pf: 0.55 },
];

// Non-catastrophic windows for contrast
const HEALTHY_WINDOWS = [
  { id: 'W1', testStart: '2022-01-01', testEnd: '2022-04-02', trainStart: '2021-01-01', pf: 2.42 },
  { id: 'W5', testStart: '2023-01-01', testEnd: '2023-04-02', trainStart: '2022-01-01', pf: 1.55 },
  { id: 'W8', testStart: '2023-10-02', testEnd: '2024-01-01', trainStart: '2022-10-02', pf: 2.02 },
  { id: 'W9', testStart: '2024-01-01', testEnd: '2024-04-02', trainStart: '2023-01-01', pf: 1.75 },
  { id: 'W14', testStart: '2025-04-02', testEnd: '2025-07-02', trainStart: '2024-04-02', pf: 5.95 },
];

// ── Helpers ───────────────────────────────────────────────────────
function percentile(arr, p) {
  const sorted = [...arr].filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(p / 100 * sorted.length), sorted.length - 1)];
}

function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
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

async function fetchData(exchange, symbol, since, until) {
  // Funding
  const allFunding = [];
  let cursor = since;
  while (cursor < until) {
    try {
      const rates = await exchange.fetchFundingRateHistory(symbol, cursor, 1000);
      if (!rates || rates.length === 0) break;
      allFunding.push(...rates);
      cursor = rates[rates.length - 1].timestamp + 1;
      if (rates.length < 1000) break;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) {
      cursor += 8 * 3600 * 1000;
      await new Promise(r => setTimeout(r, exchange.rateLimit * 3));
    }
  }
  const seenF = new Set(), uniqueF = [];
  for (const r of allFunding) {
    if (!seenF.has(r.timestamp)) { seenF.add(r.timestamp); uniqueF.push({ timestamp: r.timestamp, fundingRate: r.fundingRate }); }
  }
  const funding = uniqueF.filter(r => r.timestamp >= since && r.timestamp <= until);

  // Candles
  const allCandles = [];
  cursor = since;
  while (cursor < until) {
    try {
      const c = await exchange.fetchOHLCV(symbol, '1h', cursor, 1000);
      if (!c || !c.length) break;
      allCandles.push(...c);
      cursor = c[c.length - 1][0] + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) {
      cursor += 3600 * 1000;
      await new Promise(r => setTimeout(r, exchange.rateLimit * 3));
    }
  }
  const seenC = new Set(), uniqueC = [];
  for (const c of allCandles) {
    if (!seenC.has(c[0])) { seenC.add(c[0]); uniqueC.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }); }
  }
  const candles = uniqueC.filter(c => c.timestamp >= since && c.timestamp <= until);

  return { funding, candles };
}

// ── Microstructure Analysis at Signal Time ────────────────────────
function analyzeSignalContext(signalFundingIdx, allFunding, allCandles, candleOffset, trainFunding) {
  const fr = allFunding[signalFundingIdx];
  const context = {};

  // 1. FUNDING BEHAVIOR (what was observable at entry)
  const lookback24h = 3;   // 3 × 8h = 24h
  const lookback72h = 9;   // 9 × 8h = 72h

  const recent24h = [];
  const recent72h = [];
  for (let j = Math.max(0, signalFundingIdx - lookback24h); j < signalFundingIdx; j++) {
    recent24h.push(allFunding[j].fundingRate);
  }
  for (let j = Math.max(0, signalFundingIdx - lookback72h); j < signalFundingIdx; j++) {
    recent72h.push(allFunding[j].fundingRate);
  }

  context.fundingLevel = fr.fundingRate;
  context.fundingMean24h = mean(recent24h);
  context.fundingMean72h = mean(recent72h);
  context.fundingSlope24h = recent24h.length >= 2 ? (recent24h[recent24h.length - 1] - recent24h[0]) : 0;
  context.fundingSlope72h = recent72h.length >= 2 ? (recent72h[recent72h.length - 1] - recent72h[0]) : 0;
  context.fundingVolatility72h = stddev(recent72h);

  // Is funding accelerating (getting more extreme) or decelerating?
  context.fundingAccelerating = Math.abs(fr.fundingRate) > Math.abs(context.fundingMean72h);

  // 2. TRAIN PERCENTILE CONTEXT (what thresholds were set)
  const trainRates = trainFunding.map(f => f.fundingRate);
  context.trainP10 = percentile(trainRates, CONFIG.extremeLowPct);
  context.trainP95 = percentile(trainRates, CONFIG.extremeHighPct);
  context.trainMean = mean(trainRates);
  context.trainStddev = stddev(trainRates);

  // How extreme is this signal relative to train distribution?
  context.signalZScore = context.trainStddev > 0
    ? (fr.fundingRate - context.trainMean) / context.trainStddev
    : 0;

  // 3. CUMULATIVE DRAIN CONTEXT
  const cumWindow = CONFIG.cumulativeWindow;
  let cumSum = 0;
  for (let j = Math.max(0, signalFundingIdx - cumWindow + 1); j <= signalFundingIdx; j++) {
    cumSum += allFunding[j].fundingRate;
  }
  context.cumulativeDrain = cumSum;

  // Was the cumulative drain driven by one extreme event or sustained pressure?
  const cumRates = [];
  for (let j = Math.max(0, signalFundingIdx - cumWindow + 1); j <= signalFundingIdx; j++) {
    cumRates.push(allFunding[j].fundingRate);
  }
  context.cumDrainMaxSingle = Math.max(...cumRates.map(Math.abs));
  context.cumDrainContribution = context.cumDrainMaxSingle / (Math.abs(cumSum) || 1);

  // 4. PRICE BEHAVIOR (what was observable at entry)
  const candleIdx = candleOffset + signalFundingIdx; // approximate
  if (candleIdx !== null && candleIdx >= 48 && candleIdx < allCandles.length) {
    // 48h lookback on price
    const price48h = [];
    for (let j = candleIdx - 48; j <= candleIdx; j++) {
      price48h.push(allCandles[j].close);
    }
    context.priceChange48h = (price48h[price48h.length - 1] - price48h[0]) / price48h[0];
    context.priceRange48h = (Math.max(...price48h.map(c => c)) - Math.min(...price48h.map(c => c))) / price48h[0];

    // 7-day price trend
    if (candleIdx >= 168) {
      const price7d = [];
      for (let j = candleIdx - 168; j <= candleIdx; j++) {
        price7d.push(allCandles[j].close);
      }
      context.priceChange7d = (price7d[price7d.length - 1] - price7d[0]) / price7d[0];
      context.priceRange7d = (Math.max(...price7d) - Math.min(...price7d)) / price7d[0];

      // Directional persistence: what % of 7d candles were in trend direction?
      const trendDir = context.priceChange7d >= 0 ? 1 : -1;
      let aligned = 0;
      for (let j = 1; j < price7d.length; j++) {
        const dir = price7d[j] >= price7d[j - 1] ? 1 : -1;
        if (dir === trendDir) aligned++;
      }
      context.trendPersistence7d = aligned / (price7d.length - 1);
    }

    // 30-day trend
    if (candleIdx >= 720) {
      const price30d = [];
      for (let j = candleIdx - 720; j <= candleIdx; j++) {
        price30d.push(allCandles[j].close);
      }
      context.priceChange30d = (price30d[price30d.length - 1] - price30d[0]) / price30d[0];
    }

    // ATR (14-period)
    if (candleIdx >= 14) {
      const trs = [];
      for (let j = candleIdx - 13; j <= candleIdx; j++) {
        const tr = allCandles[j].high - allCandles[j].low;
        trs.push(tr / allCandles[j].close);
      }
      context.atr14 = mean(trs);
    }
  }

  // 5. SIGNAL TYPE
  const signalTypes = [];
  if (fr.fundingRate <= context.trainP10) signalTypes.push('extremeLow_p10');
  if (fr.fundingRate >= context.trainP95) signalTypes.push('extremeHigh_p95');
  // cumDrain check needs cumValues array
  const allCumValues = [];
  for (let i = 0; i < allFunding.length; i++) {
    let s = 0;
    for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) s += allFunding[j].fundingRate;
    allCumValues.push(s);
  }
  const cumP90 = percentile(allCumValues, CONFIG.cumulativeDrainPct);
  if (allCumValues[signalFundingIdx] >= cumP90) signalTypes.push('highCumDrain');
  context.signalType = signalTypes.join('+') || 'unknown';
  context.trainCumP90 = cumP90;

  return context;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔍 CATASTROPHIC WINDOW FORENSICS                               ║
║  Real-time detectability analysis                               ║
║  NO hindsight | NO optimization | Pure observation              ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const exchange = new ccxt.binance({ enableRateLimit: true });

  // Fetch extended data for each window (train + test period)
  const windowData = {};

  for (const w of [...CATASTROPHIC_WINDOWS, ...HEALTHY_WINDOWS]) {
    console.log(`\n━━━ ${w.id} (${w.testStart} → ${w.testEnd}) ━━━`);
    const trainStart = new Date(w.trainStart).getTime();
    const testEnd = new Date(w.testEnd).getTime();
    // Fetch from train start to test end + buffer
    const fetchEnd = testEnd + 7 * 24 * 3600 * 1000;

    const { funding, candles } = await fetchData(exchange, CONFIG.symbol, trainStart, fetchEnd);
    console.log(`  Data: ${funding.length} funding, ${candles.length} candles`);

    // Split train vs test
    const testStartTs = new Date(w.testStart).getTime();
    const testEndTs = new Date(w.testEnd).getTime();
    const trainFunding = funding.filter(f => f.timestamp >= trainStart && f.timestamp < testStartTs);
    const testFunding = funding.filter(f => f.timestamp >= testStartTs && f.timestamp <= testEndTs);

    // Compute train thresholds
    const trainRates = trainFunding.map(f => f.fundingRate);
    const p10 = percentile(trainRates, CONFIG.extremeLowPct);
    const p95 = percentile(trainRates, CONFIG.extremeHighPct);
    const cumWindow = CONFIG.cumulativeWindow;

    // Compute cumulative for all funding
    const allCumValues = [];
    for (let i = 0; i < funding.length; i++) {
      let s = 0;
      for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) s += funding[j].fundingRate;
      allCumValues.push(s);
    }
    const cumP90 = percentile(
      allCumValues.filter((_, i) => funding[i].timestamp >= trainStart && funding[i].timestamp < testStartTs),
      CONFIG.cumulativeDrainPct
    );

    // Find signal indices in test period
    const signalIndices = [];
    for (let i = 0; i < funding.length; i++) {
      if (funding[i].timestamp < testStartTs || funding[i].timestamp > testEndTs) continue;
      const fr = funding[i];
      if (fr.fundingRate <= p10 || fr.fundingRate >= p95 || allCumValues[i] >= cumP90) {
        // Check candle availability
        const candleIdx = findCandleIndex(candles, fr.timestamp);
        if (candleIdx !== null && candleIdx + CONFIG.holdHours < candles.length) {
          signalIndices.push(i);
        }
      }
    }

    console.log(`  Signals: ${signalIndices.length} | p10=${(p10 * 100).toFixed(5)}% p95=${(p95 * 100).toFixed(5)}% cumP90=${(cumP90 * 100).toFixed(5)}%`);

    // Analyze each signal
    const signals = [];
    for (const idx of signalIndices) {
      const candleIdx = findCandleIndex(candles, funding[idx].timestamp);
      const ctx = analyzeSignalContext(idx, funding, candles, candleIdx - idx, trainFunding);

      // Get trade outcome (for forensics only — this is hindsight, used ONLY to label, not to decide)
      const exitIdx = candleIdx + CONFIG.holdHours;
      const entryPrice = candles[candleIdx].close;
      const exitPrice = exitIdx < candles.length ? candles[exitIdx].close : candles[candles.length - 1].close;
      const grossReturn = (exitPrice - entryPrice) / entryPrice;
      const netReturn = grossReturn - 0.0014; // round-trip fee

      signals.push({ ...ctx, entryPrice, exitPrice, grossReturn, netReturn, fundingIdx: idx });
    }

    windowData[w.id] = {
      ...w,
      signals,
      trainP10: p10,
      trainP95: p95,
      trainCumP90: cumP90,
      isCatastrophic: CATASTROPHIC_WINDOWS.some(cw => cw.id === w.id),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // FORENSIC ANALYSIS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🔬 MICROSTRUCTURE RECONSTRUCTION`);
  console.log(`${'═'.repeat(70)}`);

  for (const w of CATASTROPHIC_WINDOWS) {
    const data = windowData[w.id];
    if (!data) { console.log(`\n  ${w.id}: NO DATA`); continue; }

    console.log(`\n\n━━━ ${w.id}: ${w.label} (PF ${w.pf}) — ${w.testStart} → ${w.testEnd} ━━━`);
    console.log(`  Total signals: ${data.signals.length}`);

    const wins = data.signals.filter(s => s.netReturn > 0);
    const losses = data.signals.filter(s => s.netReturn <= 0);
    console.log(`  Wins: ${wins.length} | Losses: ${losses.length}`);

    // Aggregate microstructure metrics
    const metrics = {
      fundingLevel: mean(data.signals.map(s => s.fundingLevel)),
      fundingSlope24h: mean(data.signals.map(s => s.fundingSlope24h)),
      fundingSlope72h: mean(data.signals.map(s => s.fundingSlope72h)),
      fundingAccelerating: data.signals.filter(s => s.fundingAccelerating).length / data.signals.length,
      signalZScore: mean(data.signals.map(s => Math.abs(s.signalZScore))),
      priceChange48h: mean(data.signals.map(s => s.priceChange48h)),
      priceChange7d: mean(data.signals.filter(s => s.priceChange7d !== undefined).map(s => s.priceChange7d)),
      priceChange30d: mean(data.signals.filter(s => s.priceChange30d !== undefined).map(s => s.priceChange30d)),
      trendPersistence7d: mean(data.signals.filter(s => s.trendPersistence7d !== undefined).map(s => s.trendPersistence7d)),
      atr14: mean(data.signals.filter(s => s.atr14 !== undefined).map(s => s.atr14)),
      cumDrainContribution: mean(data.signals.map(s => s.cumDrainContribution)),
    };

    // Signal type breakdown
    const sigTypes = {};
    for (const s of data.signals) {
      sigTypes[s.signalType] = (sigTypes[s.signalType] || 0) + 1;
    }

    console.log(`\n  FUNDING MICROSTRUCTURE:`);
    console.log(`    Mean funding level:     ${(metrics.fundingLevel * 100).toFixed(5)}%`);
    console.log(`    Mean 24h slope:         ${(metrics.fundingSlope24h * 100).toFixed(6)}%`);
    console.log(`    Mean 72h slope:         ${(metrics.fundingSlope72h * 100).toFixed(6)}%`);
    console.log(`    Accelerating:           ${(metrics.fundingAccelerating * 100).toFixed(0)}% of signals`);
    console.log(`    Mean |Z-score|:         ${metrics.signalZScore.toFixed(2)}`);
    console.log(`    CumDrain single contrib:${(metrics.cumDrainContribution * 100).toFixed(0)}%`);

    console.log(`\n  PRICE STRUCTURE:`);
    console.log(`    48h price change:       ${(metrics.priceChange48h * 100).toFixed(2)}%`);
    console.log(`    7d price change:        ${(metrics.priceChange7d * 100).toFixed(2)}%`);
    console.log(`    30d price change:       ${(metrics.priceChange30d * 100).toFixed(2)}%`);
    console.log(`    7d trend persistence:   ${(metrics.trendPersistence7d * 100).toFixed(1)}%`);
    console.log(`    ATR (14):               ${(metrics.atr14 * 100).toFixed(3)}%`);

    console.log(`\n  SIGNAL TYPES: ${JSON.stringify(sigTypes)}`);

    // Loser vs Winner comparison
    if (wins.length > 0 && losses.length > 0) {
      console.log(`\n  WINNER vs LOSER COMPARISON:`);
      const wMetrics = {
        fundingSlope72h: mean(wins.map(s => s.fundingSlope72h)),
        priceChange7d: mean(wins.filter(s => s.priceChange7d).map(s => s.priceChange7d)),
        trendPersistence: mean(wins.filter(s => s.trendPersistence7d).map(s => s.trendPersistence7d)),
        atr: mean(wins.filter(s => s.atr14).map(s => s.atr14)),
        accelerating: wins.filter(s => s.fundingAccelerating).length / wins.length,
      };
      const lMetrics = {
        fundingSlope72h: mean(losses.map(s => s.fundingSlope72h)),
        priceChange7d: mean(losses.filter(s => s.priceChange7d).map(s => s.priceChange7d)),
        trendPersistence: mean(losses.filter(s => s.trendPersistence7d).map(s => s.trendPersistence7d)),
        atr: mean(losses.filter(s => s.atr14).map(s => s.atr14)),
        accelerating: losses.filter(s => s.fundingAccelerating).length / losses.length,
      };
      console.log(`    Funding slope 72h:  W ${(wMetrics.fundingSlope72h * 100).toFixed(6)}% vs L ${(lMetrics.fundingSlope72h * 100).toFixed(6)}%`);
      console.log(`    7d price change:    W ${(wMetrics.priceChange7d * 100).toFixed(2)}% vs L ${(lMetrics.priceChange7d * 100).toFixed(2)}%`);
      console.log(`    Trend persistence:  W ${(wMetrics.trendPersistence * 100).toFixed(1)}% vs L ${(lMetrics.trendPersistence * 100).toFixed(1)}%`);
      console.log(`    ATR:                W ${(wMetrics.atr * 100).toFixed(3)}% vs L ${(lMetrics.atr * 100).toFixed(3)}%`);
      console.log(`    Accelerating:       W ${(wMetrics.accelerating * 100).toFixed(0)}% vs L ${(lMetrics.accelerating * 100).toFixed(0)}%`);
    }
  }

  // ── HEALTHY WINDOWS FOR CONTRAST ────────────────────────────────
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  📊 HEALTHY WINDOWS (CONTRAST)`);
  console.log(`${'═'.repeat(70)}`);

  for (const w of HEALTHY_WINDOWS) {
    const data = windowData[w.id];
    if (!data) continue;

    const metrics = {
      fundingSlope72h: mean(data.signals.map(s => s.fundingSlope72h)),
      priceChange7d: mean(data.signals.filter(s => s.priceChange7d !== undefined).map(s => s.priceChange7d)),
      trendPersistence7d: mean(data.signals.filter(s => s.trendPersistence7d !== undefined).map(s => s.trendPersistence7d)),
      atr14: mean(data.signals.filter(s => s.atr14 !== undefined).map(s => s.atr14)),
      fundingAccelerating: data.signals.filter(s => s.fundingAccelerating).length / data.signals.length,
      signalZScore: mean(data.signals.map(s => Math.abs(s.signalZScore))),
    };

    console.log(`\n  ${w.id} (PF ${w.pf}): ${data.signals.length} signals`);
    console.log(`    Funding slope 72h:  ${(metrics.fundingSlope72h * 100).toFixed(6)}%`);
    console.log(`    7d price change:    ${(metrics.priceChange7d * 100).toFixed(2)}%`);
    console.log(`    Trend persistence:  ${(metrics.trendPersistence7d * 100).toFixed(1)}%`);
    console.log(`    ATR:                ${(metrics.atr14 * 100).toFixed(3)}%`);
    console.log(`    Accelerating:       ${(metrics.fundingAccelerating * 100).toFixed(0)}%`);
    console.log(`    Mean |Z-score|:     ${metrics.signalZScore.toFixed(2)}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // CROSS-WINDOW PATTERN ANALYSIS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  🔬 CROSS-WINDOW PATTERN ANALYSIS`);
  console.log(`${'═'.repeat(70)}`);

  // Collect all signals from catastrophic vs healthy
  const catSignals = [];
  const healthySignals = [];
  for (const w of CATASTROPHIC_WINDOWS) {
    if (windowData[w.id]) catSignals.push(...windowData[w.id].signals.map(s => ({ ...s, window: w.id })));
  }
  for (const w of HEALTHY_WINDOWS) {
    if (windowData[w.id]) healthySignals.push(...windowData[w.id].signals.map(s => ({ ...s, window: w.id })));
  }

  console.log(`\n  Catastrophic signals: ${catSignals.length}`);
  console.log(`  Healthy signals: ${healthySignals.length}`);

  // Compare distributions
  const catWinRate = catSignals.filter(s => s.netReturn > 0).length / catSignals.length * 100;
  const healthyWinRate = healthySignals.filter(s => s.netReturn > 0).length / healthySignals.length * 100;
  console.log(`\n  Win rates: Catastrophic ${catWinRate.toFixed(1)}% vs Healthy ${healthyWinRate.toFixed(1)}%`);

  // Feature comparison
  const features = [
    { name: 'Funding Slope 72h', cat: mean(catSignals.map(s => s.fundingSlope72h)), healthy: mean(healthySignals.map(s => s.fundingSlope72h)) },
    { name: 'Price Change 7d', cat: mean(catSignals.filter(s => s.priceChange7d).map(s => s.priceChange7d)), healthy: mean(healthySignals.filter(s => s.priceChange7d).map(s => s.priceChange7d)) },
    { name: 'Trend Persistence 7d', cat: mean(catSignals.filter(s => s.trendPersistence7d).map(s => s.trendPersistence7d)), healthy: mean(healthySignals.filter(s => s.trendPersistence7d).map(s => s.trendPersistence7d)) },
    { name: 'ATR 14', cat: mean(catSignals.filter(s => s.atr14).map(s => s.atr14)), healthy: mean(healthySignals.filter(s => s.atr14).map(s => s.atr14)) },
    { name: 'Accelerating %', cat: catSignals.filter(s => s.fundingAccelerating).length / catSignals.length, healthy: healthySignals.filter(s => s.fundingAccelerating).length / healthySignals.length },
    { name: '|Z-Score|', cat: mean(catSignals.map(s => Math.abs(s.signalZScore))), healthy: mean(healthySignals.map(s => Math.abs(s.signalZScore))) },
    { name: 'CumDrain Contribution', cat: mean(catSignals.map(s => s.cumDrainContribution)), healthy: mean(healthySignals.map(s => s.cumDrainContribution)) },
    { name: '30d Price Change', cat: mean(catSignals.filter(s => s.priceChange30d).map(s => s.priceChange30d)), healthy: mean(healthySignals.filter(s => s.priceChange30d).map(s => s.priceChange30d)) },
  ];

  console.log(`\n  ${'Feature'.padEnd(25)} | ${'Catastrophic'.padStart(14)} | ${'Healthy'.padStart(14)} | ${'Delta'.padStart(14)} | Separable?`);
  console.log(`  ${'─'.repeat(90)}`);
  for (const f of features) {
    const delta = f.cat - f.healthy;
    const ratio = Math.abs(f.healthy) > 0.0001 ? Math.abs(delta / f.healthy) : 0;
    const separable = ratio > 0.3 ? '✅ YES' : '❌ NO';
    const catStr = f.name.includes('%') ? `${(f.cat * 100).toFixed(2)}%` : f.cat.toFixed(6);
    const hStr = f.name.includes('%') ? `${(f.healthy * 100).toFixed(2)}%` : f.healthy.toFixed(6);
    const dStr = f.name.includes('%') ? `${(delta * 100).toFixed(2)}%` : delta.toFixed(6);
    console.log(`  ${f.name.padEnd(25)} | ${catStr.padStart(14)} | ${hStr.padStart(14)} | ${dStr.padStart(14)} | ${separable}`);
  }

  // ── Write raw data for manual inspection ────────────────────────
  const forensicData = {};
  for (const [id, data] of Object.entries(windowData)) {
    forensicData[id] = {
      id: data.id,
      pf: data.pf,
      isCatastrophic: data.isCatastrophic,
      signalCount: data.signals.length,
      signals: data.signals.map(s => ({
        signalType: s.signalType,
        fundingLevel: s.fundingLevel,
        fundingSlope24h: s.fundingSlope24h,
        fundingSlope72h: s.fundingSlope72h,
        fundingAccelerating: s.fundingAccelerating,
        signalZScore: s.signalZScore,
        cumulativeDrain: s.cumulativeDrain,
        cumDrainContribution: s.cumDrainContribution,
        priceChange48h: s.priceChange48h,
        priceChange7d: s.priceChange7d,
        priceChange30d: s.priceChange30d,
        trendPersistence7d: s.trendPersistence7d,
        atr14: s.atr14,
        netReturn: s.netReturn,
      })),
    };
  }
  fs.writeFileSync(path.join(__dirname, 'forensic-data.json'), JSON.stringify(forensicData, null, 2));
  console.log(`\n\n  ✅ Raw data: validation/forensic-data.json`);

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
