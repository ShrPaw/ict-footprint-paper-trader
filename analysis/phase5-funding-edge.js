// ═══════════════════════════════════════════════════════════════════
// PHASE 5 — INFORMATION EDGE DISCOVERY (FUNDING RATES)
// ═══════════════════════════════════════════════════════════════════
//
// NEW DATA: Funding rates (8h intervals) — structural information
// about participant positioning that OHLCV cannot capture.
//
// HYPOTHESES:
//   H1: Extreme funding → mean reversion (trapped longs/shorts)
//   H2: Funding regime transitions → momentum
//   H3: Cumulative funding drain → exhaustion
//   H4: Funding + price divergence → trapped traders
//   H5: Negative funding streaks → capitulation/reversal
//
// METHODOLOGY: Event-based, forward return distribution analysis
// NO trade simulation. NO indicator stacking. Pure event study.
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCHANGE = 'binance';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:00Z';

const ASSETS = [
  { symbol: 'BTC/USDT:USDT', label: 'BTC' },
  { symbol: 'ETH/USDT:USDT', label: 'ETH' },
  { symbol: 'SOL/USDT:USDT', label: 'SOL' },
  { symbol: 'XRP/USDT:USDT', label: 'XRP' },
];

// ═══════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════

async function fetchFundingRates(symbol) {
  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const since = new Date(START_DATE).getTime();
  const end = new Date(END_DATE).getTime();
  const all = [];
  let cursor = since;

  process.stdout.write(`  📥 Funding rates ${symbol}...`);
  while (cursor < end) {
    try {
      const rates = await exchange.fetchFundingRateHistory(symbol, cursor, 1000);
      if (!rates || rates.length === 0) break;
      all.push(...rates);
      cursor = rates[rates.length - 1].timestamp + 1;
      if (rates.length < 1000) break;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) {
      console.log(`\n    Error at ${new Date(cursor).toISOString()}: ${e.message}`);
      cursor += 8 * 3600 * 1000; // skip 8h
      await new Promise(r => setTimeout(r, exchange.rateLimit * 3));
    }
  }

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const r of all) {
    if (!seen.has(r.timestamp)) {
      seen.add(r.timestamp);
      unique.push({
        timestamp: r.timestamp,
        datetime: r.datetime,
        fundingRate: r.fundingRate,
        markPrice: r.info?.markPrice ? parseFloat(r.info.markPrice) : null,
      });
    }
  }

  console.log(` ${unique.length} rates ✅`);
  return unique.filter(r => r.timestamp >= since && r.timestamp <= end);
}

async function fetchCandles(symbol, timeframe = '1h') {
  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const since = new Date(START_DATE).getTime();
  const end = new Date(END_DATE).getTime();
  const all = [];
  let cursor = since;

  process.stdout.write(`  📥 Candles ${symbol}...`);
  while (cursor < end) {
    const candles = await exchange.fetchOHLCV(symbol, timeframe, cursor, 1000);
    if (!candles || !candles.length) break;
    all.push(...candles);
    cursor = candles[candles.length-1][0] + 1;
    await new Promise(r => setTimeout(r, exchange.rateLimit));
  }
  const seen = new Set(); const unique = [];
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
// ALIGNMENT: Match funding rates to nearest candle
// ═══════════════════════════════════════════════════════════════════

function alignFundingToCandles(fundingRates, candles) {
  // Funding rates occur every 8h: 00:00, 08:00, 16:00 UTC
  // Find the candle index at or just after each funding rate timestamp
  const aligned = [];
  let candleIdx = 0;

  for (const fr of fundingRates) {
    // Advance candle pointer
    while (candleIdx < candles.length - 1 && candles[candleIdx].timestamp < fr.timestamp) {
      candleIdx++;
    }
    // Find closest candle (within 1h)
    const dist = Math.abs(candles[candleIdx].timestamp - fr.timestamp);
    if (dist <= 3600000) { // within 1 hour
      aligned.push({
        ...fr,
        candleIdx,
        candleTimestamp: candles[candleIdx].timestamp,
      });
    }
  }

  return aligned;
}

// ═══════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════

function stats(arr) {
  const v = arr.filter(x => x !== null && !isNaN(x) && isFinite(x));
  if (v.length < 5) return { n: v.length, mean: 0, median: 0, std: 0, pctPositive: 0, tStat: 0, skew: 0, min: 0, max: 0 };
  const n = v.length;
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sorted = [...v].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const pos = v.filter(r => r > 0).length;
  let m2 = 0, m3 = 0;
  for (const x of v) { const d = x - mean; m2 += d * d; m3 += d * d * d; }
  m2 /= n; m3 /= n;
  const std = Math.sqrt(m2);
  const skew = std > 0 ? m3 / (std ** 3) : 0;
  const t = std > 0 ? mean / (std / Math.sqrt(n)) : 0;
  return { n, mean, median, std, pctPositive: pos / n, tStat: t, skew, min: sorted[0], max: sorted[n - 1] };
}

function percentile(arr, p) {
  const sorted = [...arr].filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(p / 100 * sorted.length), sorted.length - 1)];
}

// ═══════════════════════════════════════════════════════════════════
// FORWARD RETURN: From funding event to N hours later
// ═══════════════════════════════════════════════════════════════════

function forwardReturn(candles, fromIdx, holdHours) {
  const exitIdx = fromIdx + holdHours;
  if (exitIdx >= candles.length || fromIdx >= candles.length) return null;
  const entry = candles[fromIdx].close;
  const exit = candles[exitIdx].close;
  if (entry <= 0) return null;
  return (exit - entry) / entry;
}

// ═══════════════════════════════════════════════════════════════════
// HYPOTHESIS TESTS
// ═══════════════════════════════════════════════════════════════════

function testHypotheses(alignedFunding, candles, label) {
  const n = alignedFunding.length;
  if (n < 50) return { status: 'INSUFFICIENT_DATA' };

  const rates = alignedFunding.map(f => f.fundingRate);
  const rateStats = stats(rates);

  // Compute percentiles for "extreme" thresholds
  const p5 = percentile(rates, 5);
  const p10 = percentile(rates, 10);
  const p90 = percentile(rates, 90);
  const p95 = percentile(rates, 95);
  const p99 = percentile(rates, 99);

  const results = {};

  // ── H1: Extreme Funding → Mean Reversion ──────────────────────
  // Long funding extremes (top 5%) → bearish reversal?
  // Short funding extremes (bottom 5%) → bullish reversal?
  results.H1_extremeFunding = {};
  for (const threshold of ['p95', 'p90', 'p5', 'p10']) {
    const threshVal = threshold === 'p95' ? p95 : threshold === 'p90' ? p90 : threshold === 'p5' ? p5 : p10;
    const isTop = threshold.startsWith('p9');

    const events = alignedFunding.filter(f => isTop ? f.fundingRate >= threshVal : f.fundingRate <= threshVal);
    const eventReturns = {};
    const baselineReturns = {};

    for (const hold of [8, 24, 48, 72]) {
      const rets = events.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null);
      const allRets = alignedFunding.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null);
      eventReturns[`${hold}h`] = stats(rets);
      baselineReturns[`${hold}h`] = stats(allRets);
    }

    results.H1_extremeFunding[threshold] = {
      direction: isTop ? 'extreme_high' : 'extreme_low',
      events: events.length,
      meanRate: events.length > 0 ? events.reduce((s, f) => s + f.fundingRate, 0) / events.length : 0,
      returns: eventReturns,
      baseline: baselineReturns,
    };
  }

  // ── H2: Funding Regime Transitions ────────────────────────────
  // From negative to positive (or vice versa) → momentum shift?
  results.H2_transitions = {};
  const transitionEvents = { negToPos: [], posToNeg: [] };

  for (let i = 1; i < n; i++) {
    const prev = alignedFunding[i - 1].fundingRate;
    const curr = alignedFunding[i].fundingRate;
    if (prev < 0 && curr >= 0) {
      transitionEvents.negToPos.push(alignedFunding[i]);
    } else if (prev >= 0 && curr < 0) {
      transitionEvents.posToNeg.push(alignedFunding[i]);
    }
  }

  for (const [type, events] of Object.entries(transitionEvents)) {
    const rets = {};
    for (const hold of [8, 24, 48]) {
      rets[`${hold}h`] = stats(events.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null));
    }
    results.H2_transitions[type] = { events: events.length, returns: rets };
  }

  // ── H3: Cumulative Funding Drain ──────────────────────────────
  // Sum of last N funding rates — high cumulative = sustained cost = exhaustion
  const cumWindow = 10; // last 10 funding periods = ~80 hours
  const cumulative = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - cumWindow + 1); j <= i; j++) {
      sum += alignedFunding[j].fundingRate;
    }
    cumulative.push({ ...alignedFunding[i], cumFunding: sum });
  }

  const cumValues = cumulative.map(c => c.cumFunding);
  const cumP90 = percentile(cumValues, 90);
  const cumP10 = percentile(cumValues, 10);

  results.H3_cumulativeDrain = {};
  const highCum = cumulative.filter(c => c.cumFunding >= cumP90);
  const lowCum = cumulative.filter(c => c.cumFunding <= cumP10);

  for (const hold of [8, 24, 48]) {
    results.H3_cumulativeDrain[`${hold}h`] = {
      highCumulative: stats(highCum.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null)),
      lowCumulative: stats(lowCum.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null)),
      baseline: stats(alignedFunding.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null)),
    };
  }

  // ── H4: Funding vs Price Divergence ───────────────────────────
  // Funding positive but price falling (or vice versa) → trapped traders
  results.H4_divergence = {};
  const divEvents = { posFundNegPrice: [], negFundPosPrice: [] };

  for (let i = 3; i < n; i++) {
    const fr = alignedFunding[i].fundingRate;
    const candleIdx = alignedFunding[i].candleIdx;
    if (candleIdx < 3) continue;

    // 24h price change (approx 24h = 3 funding periods back)
    const priceChange24h = (candles[candleIdx].close - candles[candleIdx - 24]?.close) / (candles[candleIdx - 24]?.close || 1);

    if (fr > 0.0005 && priceChange24h < -0.02) {
      divEvents.posFundNegPrice.push(alignedFunding[i]);
    } else if (fr < -0.0005 && priceChange24h > 0.02) {
      divEvents.negFundPosPrice.push(alignedFunding[i]);
    }
  }

  for (const [type, events] of Object.entries(divEvents)) {
    const rets = {};
    for (const hold of [8, 24, 48]) {
      rets[`${hold}h`] = stats(events.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null));
    }
    results.H4_divergence[type] = { events: events.length, returns: rets };
  }

  // ── H5: Negative Funding Streaks ──────────────────────────────
  // Consecutive negative funding → capitulation/reversal
  results.H5_streaks = {};
  const streakEvents = { neg3: [], neg5: [], pos3: [], pos5: [] };

  for (let i = 5; i < n; i++) {
    let negStreak = 0, posStreak = 0;
    for (let j = i; j >= i - 4; j--) {
      if (alignedFunding[j].fundingRate < 0) negStreak++;
      else break;
    }
    for (let j = i; j >= i - 4; j--) {
      if (alignedFunding[j].fundingRate >= 0) posStreak++;
      else break;
    }

    if (negStreak >= 5) streakEvents.neg5.push(alignedFunding[i]);
    else if (negStreak >= 3) streakEvents.neg3.push(alignedFunding[i]);
    if (posStreak >= 5) streakEvents.pos5.push(alignedFunding[i]);
    else if (posStreak >= 3) streakEvents.pos3.push(alignedFunding[i]);
  }

  for (const [type, events] of Object.entries(streakEvents)) {
    const rets = {};
    for (const hold of [8, 24, 48]) {
      rets[`${hold}h`] = stats(events.map(f => forwardReturn(candles, f.candleIdx, hold)).filter(r => r !== null));
    }
    results.H5_streaks[type] = { events: events.length, returns: rets };
  }

  // Summary stats
  results.fundingStats = {
    mean: rateStats.mean,
    median: rateStats.median,
    std: rateStats.std,
    p5, p10, p90, p95, p99,
    pctPositive: rateStats.pctPositive,
    totalRates: n,
  };

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let r = `# 💰 PHASE 5 — INFORMATION EDGE DISCOVERY (FUNDING RATES)\n`;
  r += `**Generated:** ${new Date().toISOString()}\n`;
  r += `**Data:** Binance perpetual futures funding rates (8h intervals)\n`;
  r += `**Period:** ${START_DATE.slice(0, 10)} → ${END_DATE.slice(0, 10)}\n`;
  r += `**Method:** Event-based forward return analysis — NO trade simulation\n\n---\n\n`;

  for (const [asset, data] of Object.entries(allResults)) {
    if (data.status === 'INSUFFICIENT_DATA') continue;

    r += `## ${asset}\n\n`;

    // Funding stats
    const fs = data.fundingStats;
    r += `### Funding Rate Distribution\n`;
    r += `- Mean: ${(fs.mean * 100).toFixed(4)}% per 8h (≈${(fs.mean * 3 * 365 * 100).toFixed(1)}% annualized)\n`;
    r += `- Median: ${(fs.median * 100).toFixed(4)}%\n`;
    r += `- % Positive: ${(fs.pctPositive * 100).toFixed(1)}%\n`;
    r += `- Extreme high (p95): ${(fs.p95 * 100).toFixed(4)}%\n`;
    r += `- Extreme low (p5): ${(fs.p5 * 100).toFixed(4)}%\n`;
    r += `- Total rates: ${fs.totalRates}\n\n`;

    // H1
    r += `### H1 — Extreme Funding → Mean Reversion\n\n`;
    r += `| Threshold | Events | Mean Rate | 8h Return | 24h Return | 48h Return | Direction |\n`;
    r += `|-----------|--------|-----------|-----------|------------|------------|----------|\n`;
    for (const [thresh, h] of Object.entries(data.H1_extremeFunding)) {
      const r8 = h.returns['8h'];
      const r24 = h.returns['24h'];
      const r48 = h.returns['48h'];
      const dir = h.direction === 'extreme_high' ? 'HIGH' : 'LOW';
      r += `| ${thresh} (${dir}) | ${h.events} | ${(h.meanRate * 100).toFixed(4)}% | ${(r8?.mean * 100 || 0).toFixed(4)}% (t=${r8?.tStat?.toFixed(2) || 0}) | ${(r24?.mean * 100 || 0).toFixed(4)}% (t=${r24?.tStat?.toFixed(2) || 0}) | ${(r48?.mean * 100 || 0).toFixed(4)}% (t=${r48?.tStat?.toFixed(2) || 0}) | ${dir} |\n`;
    }

    // Baseline for comparison
    const bl = Object.values(data.H1_extremeFunding)[0]?.baseline;
    if (bl) {
      r += `\nBaseline (all funding events): 8h=${(bl['8h']?.mean * 100 || 0).toFixed(4)}% 24h=${(bl['24h']?.mean * 100 || 0).toFixed(4)}% 48h=${(bl['48h']?.mean * 100 || 0).toFixed(4)}%\n\n`;
    }

    // H2
    r += `### H2 — Funding Regime Transitions\n\n`;
    for (const [type, h] of Object.entries(data.H2_transitions)) {
      r += `**${type}** (${h.events} events):\n`;
      for (const [hold, s] of Object.entries(h.returns)) {
        r += `- ${hold}: mean=${(s.mean * 100).toFixed(4)}% t=${s.tStat.toFixed(2)} +rate=${(s.pctPositive * 100).toFixed(1)}% (n=${s.n})\n`;
      }
      r += `\n`;
    }

    // H3
    r += `### H3 — Cumulative Funding Drain (${10} periods)\n\n`;
    r += `| Hold | High Cum (p90) Mean | t-stat | Low Cum (p10) Mean | t-stat | Baseline |\n`;
    r += `|------|-------------------|--------|-------------------|--------|----------|\n`;
    for (const [hold, h] of Object.entries(data.H3_cumulativeDrain)) {
      r += `| ${hold} | ${(h.highCumulative.mean * 100).toFixed(4)}% | ${h.highCumulative.tStat.toFixed(2)} | ${(h.lowCumulative.mean * 100).toFixed(4)}% | ${h.lowCumulative.tStat.toFixed(2)} | ${(h.baseline.mean * 100).toFixed(4)}% |\n`;
    }
    r += `\n`;

    // H4
    r += `### H4 — Funding vs Price Divergence\n\n`;
    for (const [type, h] of Object.entries(data.H4_divergence)) {
      r += `**${type}** (${h.events} events):\n`;
      if (h.events === 0) { r += `- No events found\n\n`; continue; }
      for (const [hold, s] of Object.entries(h.returns)) {
        r += `- ${hold}: mean=${(s.mean * 100).toFixed(4)}% t=${s.tStat.toFixed(2)} +rate=${(s.pctPositive * 100).toFixed(1)}% (n=${s.n})\n`;
      }
      r += `\n`;
    }

    // H5
    r += `### H5 — Funding Streaks\n\n`;
    r += `| Streak | Events | 8h Return | t-stat | 24h Return | t-stat | 48h Return | t-stat |\n`;
    r += `|--------|--------|-----------|--------|------------|--------|------------|--------|\n`;
    for (const [type, h] of Object.entries(data.H5_streaks)) {
      const r8 = h.returns['8h'];
      const r24 = h.returns['24h'];
      const r48 = h.returns['48h'];
      r += `| ${type} | ${h.events} | ${(r8?.mean * 100 || 0).toFixed(4)}% | ${r8?.tStat?.toFixed(2) || 0} | ${(r24?.mean * 100 || 0).toFixed(4)}% | ${r24?.tStat?.toFixed(2) || 0} | ${(r48?.mean * 100 || 0).toFixed(4)}% | ${r48?.tStat?.toFixed(2) || 0} |\n`;
    }
    r += `\n---\n\n`;
  }

  // Summary: find all significant findings
  r += `## SIGNIFICANT FINDINGS SUMMARY\n\n`;
  let findingCount = 0;

  for (const [asset, data] of Object.entries(allResults)) {
    if (data.status === 'INSUFFICIENT_DATA') continue;

    // Check H1 extremes
    for (const [thresh, h] of Object.entries(data.H1_extremeFunding)) {
      for (const [hold, s] of Object.entries(h.returns)) {
        if (s.n >= 20 && Math.abs(s.tStat) > 2.0) {
          r += `- **${asset} H1 ${thresh} ${h.direction} ${hold}**: mean=${(s.mean * 100).toFixed(4)}% t=${s.tStat.toFixed(2)} n=${s.n}\n`;
          findingCount++;
        }
      }
    }

    // Check H2 transitions
    for (const [type, h] of Object.entries(data.H2_transitions)) {
      for (const [hold, s] of Object.entries(h.returns)) {
        if (s.n >= 20 && Math.abs(s.tStat) > 2.0) {
          r += `- **${asset} H2 ${type} ${hold}**: mean=${(s.mean * 100).toFixed(4)}% t=${s.tStat.toFixed(2)} n=${s.n}\n`;
          findingCount++;
        }
      }
    }

    // Check H3 cumulative
    for (const [hold, h] of Object.entries(data.H3_cumulativeDrain)) {
      if (h.highCumulative.n >= 20 && Math.abs(h.highCumulative.tStat) > 2.0) {
        r += `- **${asset} H3 highCum ${hold}**: mean=${(h.highCumulative.mean * 100).toFixed(4)}% t=${h.highCumulative.tStat.toFixed(2)}\n`;
        findingCount++;
      }
      if (h.lowCumulative.n >= 20 && Math.abs(h.lowCumulative.tStat) > 2.0) {
        r += `- **${asset} H3 lowCum ${hold}**: mean=${(h.lowCumulative.mean * 100).toFixed(4)}% t=${h.lowCumulative.tStat.toFixed(2)}\n`;
        findingCount++;
      }
    }

    // Check H5 streaks
    for (const [type, h] of Object.entries(data.H5_streaks)) {
      for (const [hold, s] of Object.entries(h.returns)) {
        if (s.n >= 20 && Math.abs(s.tStat) > 2.0) {
          r += `- **${asset} H5 ${type} ${hold}**: mean=${(s.mean * 100).toFixed(4)}% t=${s.tStat.toFixed(2)} n=${s.n}\n`;
          findingCount++;
        }
      }
    }
  }

  if (findingCount === 0) {
    r += `\n**No statistically significant findings across any hypothesis, any asset, any holding period.**\n`;
  }
  r += `\nTotal significant findings: ${findingCount}\n`;

  return r;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  💰 PHASE 5 — INFORMATION EDGE DISCOVERY (FUNDING RATES)        ║
║  Structural information asymmetries in participant positioning  ║
║  NO indicator stacking. NO premature models. Pure event study. ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults = {};

  for (const asset of ASSETS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🔬 ${asset.label}`);
    console.log(`${'═'.repeat(60)}`);

    try {
      // Fetch funding rates
      const fundingRates = await fetchFundingRates(asset.symbol);

      // Fetch 1h candles for forward return calculation
      const candles = await fetchCandles(asset.symbol, '1h');

      // Align
      console.log(`  🔗 Aligning funding to candles...`);
      const aligned = alignFundingToCandles(fundingRates, candles);
      console.log(`  Aligned: ${aligned.length} funding events`);

      if (aligned.length < 50) {
        console.log(`  ❌ Insufficient data`);
        allResults[asset.label] = { status: 'INSUFFICIENT_DATA' };
        continue;
      }

      // Run hypotheses
      console.log(`  🧪 Testing hypotheses...`);
      const results = testHypotheses(aligned, candles, asset.label);
      allResults[asset.label] = results;

      // Print summary
      if (results.fundingStats) {
        console.log(`  Funding: mean=${(results.fundingStats.mean * 100).toFixed(4)}% p5=${(results.fundingStats.p5 * 100).toFixed(4)}% p95=${(results.fundingStats.p95 * 100).toFixed(4)}%`);
      }

      // Find significant results
      let sigCount = 0;
      const printSig = (label, s) => {
        if (s.n >= 20 && Math.abs(s.tStat) > 2.0) {
          console.log(`    🎯 ${label}: mean=${(s.mean * 100).toFixed(4)}% t=${s.tStat.toFixed(2)} n=${s.n}`);
          sigCount++;
        }
      };

      for (const [thresh, h] of Object.entries(results.H1_extremeFunding)) {
        for (const [hold, s] of Object.entries(h.returns)) printSig(`H1 ${thresh} ${hold}`, s);
      }
      for (const [type, h] of Object.entries(results.H2_transitions)) {
        for (const [hold, s] of Object.entries(h.returns)) printSig(`H2 ${type} ${hold}`, s);
      }
      for (const [hold, h] of Object.entries(results.H3_cumulativeDrain)) {
        printSig(`H3 highCum ${hold}`, h.highCumulative);
        printSig(`H3 lowCum ${hold}`, h.lowCumulative);
      }
      for (const [type, h] of Object.entries(results.H5_streaks)) {
        for (const [hold, s] of Object.entries(h.returns)) printSig(`H5 ${type} ${hold}`, s);
      }

      if (sigCount === 0) console.log(`    No significant findings`);

    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      allResults[asset.label] = { status: 'ERROR', error: err.message };
    }
  }

  // Generate report
  const report = generateReport(allResults);
  const reportPath = path.join(__dirname, 'PHASE5_FUNDING_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  const rawPath = path.join(__dirname, 'phase5-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw: ${rawPath}`);

  console.log(`\n  Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
