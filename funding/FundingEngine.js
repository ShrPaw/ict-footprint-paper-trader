// ═══════════════════════════════════════════════════════════════════
// FundingEngine — Signal Detection
// ═══════════════════════════════════════════════════════════════════
// Responsibilities:
//   - Fetch funding rate data (Binance, 8h intervals)
//   - Compute percentile thresholds (rolling, non-optimized)
//   - Detect events: extreme funding + cumulative pressure
//   - Emit clean event signals
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import FundingConfig from './FundingConfig.js';

export default class FundingEngine {
  constructor() {
    this.fundingData = new Map();   // label -> [{timestamp, fundingRate}]
    this.candleData = new Map();    // label -> [{timestamp, open, high, low, close}]
    this.thresholds = new Map();    // label -> {p10, p95, cumP90}
  }

  // ── Data Fetching ────────────────────────────────────────────────

  async fetchFundingRates(symbol, label, startDate, endDate) {
    const exchange = new ccxt.binance({ enableRateLimit: true });
    const since = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const all = [];
    let cursor = since;

    process.stdout.write(`  📥 Funding ${label}...`);
    while (cursor < end) {
      try {
        const rates = await exchange.fetchFundingRateHistory(symbol, cursor, 1000);
        if (!rates || rates.length === 0) break;
        all.push(...rates);
        cursor = rates[rates.length - 1].timestamp + 1;
        if (rates.length < 1000) break;
        await new Promise(r => setTimeout(r, exchange.rateLimit));
      } catch (e) {
        cursor += 8 * 3600 * 1000;
        await new Promise(r => setTimeout(r, exchange.rateLimit * 3));
      }
    }

    const seen = new Set(), unique = [];
    for (const r of all) {
      if (!seen.has(r.timestamp)) {
        seen.add(r.timestamp);
        unique.push({ timestamp: r.timestamp, fundingRate: r.fundingRate });
      }
    }
    console.log(` ${unique.length} ✅`);
    this.fundingData.set(label, unique.filter(r => r.timestamp >= since && r.timestamp <= end));
    return this.fundingData.get(label);
  }

  async fetchCandles(symbol, label, startDate, endDate) {
    const exchange = new ccxt.binance({ enableRateLimit: true });
    const since = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const all = [];
    let cursor = since;

    process.stdout.write(`  📥 Candles ${label}...`);
    while (cursor < end) {
      const c = await exchange.fetchOHLCV(symbol, '1h', cursor, 1000);
      if (!c || !c.length) break;
      all.push(...c);
      cursor = c[c.length - 1][0] + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    }

    const seen = new Set(), unique = [];
    for (const c of all) {
      if (!seen.has(c[0])) {
        seen.add(c[0]);
        unique.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4] });
      }
    }
    console.log(` ${unique.length} ✅`);
    this.candleData.set(label, unique.filter(c => c.timestamp >= since && c.timestamp <= end));
    return this.candleData.get(label);
  }

  // ── Threshold Computation (rolling, non-optimized) ───────────────

  computeThresholds(label) {
    const funding = this.fundingData.get(label);
    if (!funding || funding.length < 50) return null;

    const rates = funding.map(f => f.fundingRate);
    const p10 = this._percentile(rates, FundingConfig.entry.extremeLowPercentile);
    const p95 = this._percentile(rates, FundingConfig.entry.extremeHighPercentile);

    // Cumulative drain
    const window = FundingConfig.entry.cumulativeWindow;
    const cumValues = [];
    for (let i = 0; i < rates.length; i++) {
      let sum = 0;
      for (let j = Math.max(0, i - window + 1); j <= i; j++) sum += rates[j];
      cumValues.push(sum);
    }
    const cumP90 = this._percentile(cumValues, FundingConfig.entry.cumulativeDrainPercentile);

    const thresholds = { p10, p95, cumP90, cumValues };
    this.thresholds.set(label, thresholds);
    return thresholds;
  }

  // ── Signal Detection ─────────────────────────────────────────────

  detectSignals(label) {
    const funding = this.fundingData.get(label);
    const candles = this.candleData.get(label);
    const thresholds = this.thresholds.get(label);

    if (!funding || !candles || !thresholds) return [];

    const signals = [];
    const { p10, p95, cumP90, cumValues } = thresholds;
    const signalTypes = FundingConfig.signalTypes[label] || [];

    for (let i = 0; i < funding.length; i++) {
      const fr = funding[i];
      let signalType = null;

      // Check each signal type for this asset
      if (signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) {
        signalType = 'extremeLow_p10';
      } else if (signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) {
        signalType = 'extremeHigh_p95';
      } else if (signalTypes.includes('highCumDrain') && cumValues[i] >= cumP90) {
        signalType = 'highCumDrain';
      }

      if (signalType) {
        // Find entry candle (at or just after funding settlement)
        const candleIdx = this._findCandleIndex(candles, fr.timestamp);
        if (candleIdx !== null && candleIdx + 48 < candles.length) {
          signals.push({
            label,
            signalType,
            fundingRate: fr.fundingRate,
            cumulativeFunding: cumValues[i],
            fundingTimestamp: fr.timestamp,
            entryIdx: candleIdx,
            entryTimestamp: candles[candleIdx].timestamp,
            entryPrice: candles[candleIdx].close,
            year: new Date(candles[candleIdx].timestamp).getUTCFullYear(),
          });
        }
      }
    }

    return signals;
  }

  // ── Live Mode: Check latest funding for new signals ──────────────

  checkLiveSignal(label) {
    const funding = this.fundingData.get(label);
    const candles = this.candleData.get(label);
    if (!funding || !candles || funding.length < 10) return null;

    const thresholds = this.computeThresholds(label);
    if (!thresholds) return null;

    const i = funding.length - 1;
    const fr = funding[i];
    const { p10, p95, cumP90, cumValues } = thresholds;
    const signalTypes = FundingConfig.signalTypes[label] || [];

    let signalType = null;
    if (signalTypes.includes('extremeLow_p10') && fr.fundingRate <= p10) {
      signalType = 'extremeLow_p10';
    } else if (signalTypes.includes('extremeHigh_p95') && fr.fundingRate >= p95) {
      signalType = 'extremeHigh_p95';
    } else if (signalTypes.includes('highCumDrain') && cumValues[i] >= cumP90) {
      signalType = 'highCumDrain';
    }

    if (!signalType) return null;

    const candleIdx = candles.length - 1;
    return {
      label,
      signalType,
      fundingRate: fr.fundingRate,
      cumulativeFunding: cumValues[i],
      fundingTimestamp: fr.timestamp,
      entryIdx: candleIdx,
      entryTimestamp: candles[candleIdx].timestamp,
      entryPrice: candles[candleIdx].close,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  _findCandleIndex(candles, fundingTimestamp) {
    let lo = 0, hi = candles.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].timestamp < fundingTimestamp) lo = mid + 1;
      else hi = mid - 1;
    }
    // lo is the first candle >= fundingTimestamp
    if (lo < candles.length && Math.abs(candles[lo].timestamp - fundingTimestamp) <= 3600000) {
      return lo;
    }
    if (lo > 0 && Math.abs(candles[lo - 1].timestamp - fundingTimestamp) <= 3600000) {
      return lo - 1;
    }
    return null;
  }

  _percentile(arr, p) {
    const sorted = [...arr].filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    return sorted[Math.min(Math.floor(p / 100 * sorted.length), sorted.length - 1)];
  }
}
