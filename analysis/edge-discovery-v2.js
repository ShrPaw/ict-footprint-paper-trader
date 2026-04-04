// ═══════════════════════════════════════════════════════════════════
// EDGE DISCOVERY ENGINE v2.0 — Statistical Edge Discovery
// ═══════════════════════════════════════════════════════════════════
//
// Research Operating System (ROS) compliant:
// - No parameter optimization
// - No trade construction
// - No exit modeling
// - No cross-asset generalization
// - Strict asset isolation
// - Early rejection filtering
//
// Event Families:
//   1. Momentum / Breakout
//   2. Volatility Transition
//   3. Structural / Liquidity
//
// For each event: forward returns, MAE/MFE, clustering, distribution
// ═══════════════════════════════════════════════════════════════════

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const ASSETS = ['ETH/USDT:USDT', 'SOL/USDT:USDT', 'BTC/USDT:USDT', 'XRP/USDT:USDT'];
const ASSET_LABELS = ['ETH', 'SOL', 'BTC', 'XRP'];
const EXCHANGE = 'binance';
const TIMEFRAME = '1h';
const START_DATE = '2022-01-01T00:00:00Z';
const END_DATE = '2026-03-31T23:59:59Z';

// Forward return horizons (in candles of TIMEFRAME)
const FORWARD_HORIZONS = [1, 4, 15, 24]; // +1h, +4h, +15h, +24h

// Minimum events to consider a hypothesis
const MIN_EVENTS_RAW = 100;        // absolute minimum raw events
const MIN_EVENTS_INDEPENDENT = 50; // minimum after clustering adjustment

// Clustering threshold: if >50% of events are temporally dependent, reject
const CLUSTERING_REJECT_THRESHOLD = 0.50;

// ═══════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════

async function fetchCandles(symbol) {
  const exchange = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const since = new Date(START_DATE).getTime();
  const end = new Date(END_DATE).getTime();
  const allCandles = [];
  let cursor = since;

  console.log(`  📥 Fetching ${symbol} ${TIMEFRAME} candles...`);

  while (cursor < end) {
    const candles = await exchange.fetchOHLCV(symbol, TIMEFRAME, cursor, 1000);
    if (!candles || candles.length === 0) break;
    allCandles.push(...candles);
    cursor = candles[candles.length - 1][0] + 1;
    await new Promise(r => setTimeout(r, exchange.rateLimit));
  }

  // Deduplicate by timestamp
  const seen = new Set();
  const unique = [];
  for (const c of allCandles) {
    if (!seen.has(c[0])) {
      seen.add(c[0]);
      unique.push(c);
    }
  }

  // Filter to date range
  const filtered = unique.filter(c => c[0] >= since && c[0] <= end);

  console.log(`  ✅ ${filtered.length} candles loaded`);
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════
// INDICATOR COMPUTATION (standalone, no project imports)
// ═══════════════════════════════════════════════════════════════════

function computeATR(candles, period) {
  const n = candles.length;
  const tr = new Array(n);
  const atr = new Array(n).fill(null);
  tr[0] = candles[0][2] - candles[0][3]; // high - low
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i][2] - candles[i][3],
      Math.abs(candles[i][2] - candles[i - 1][4]),
      Math.abs(candles[i][3] - candles[i - 1][4])
    );
  }
  // SMA of TR
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    if (i >= period - 1) atr[i] = sum / period;
  }
  return atr;
}

function computeEMA(data, period) {
  const result = new Array(data.length);
  const k = 2 / (period + 1);
  result[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function computeSMA(data, period) {
  const result = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

function computeStdDev(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (data[j] - mean) ** 2;
    result[i] = Math.sqrt(sqSum / period);
  }
  return result;
}

function computeADX(candles, period) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n);
  const adx = new Array(n).fill(null);

  tr[0] = candles[0][2] - candles[0][3];
  for (let i = 1; i < n; i++) {
    const upMove = candles[i][2] - candles[i - 1][2];
    const downMove = candles[i - 1][3] - candles[i][3];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      candles[i][2] - candles[i][3],
      Math.abs(candles[i][2] - candles[i - 1][4]),
      Math.abs(candles[i][3] - candles[i - 1][4])
    );
  }

  // Wilder smoothing
  const sTR = new Array(n).fill(0);
  const sPlus = new Array(n).fill(0);
  const sMinus = new Array(n).fill(0);

  let sumTR = 0, sumPlus = 0, sumMinus = 0;
  for (let i = 0; i < period; i++) {
    sumTR += tr[i];
    sumPlus += plusDM[i];
    sumMinus += minusDM[i];
  }
  sTR[period - 1] = sumTR;
  sPlus[period - 1] = sumPlus;
  sMinus[period - 1] = sumMinus;

  for (let i = period; i < n; i++) {
    sTR[i] = sTR[i - 1] - sTR[i - 1] / period + tr[i];
    sPlus[i] = sPlus[i - 1] - sPlus[i - 1] / period + plusDM[i];
    sMinus[i] = sMinus[i - 1] - sMinus[i - 1] / period + minusDM[i];
  }

  const dx = new Array(n).fill(0);
  for (let i = period - 1; i < n; i++) {
    if (sTR[i] === 0) continue;
    const plusDI = 100 * sPlus[i] / sTR[i];
    const minusDI = 100 * sMinus[i] / sTR[i];
    const diSum = plusDI + minusDI;
    dx[i] = diSum === 0 ? 0 : 100 * Math.abs(plusDI - minusDI) / diSum;
  }

  // ADX = SMA of DX
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += dx[i];
    if (i >= period + period - 2) {
      sum -= dx[i - period];
      adx[i] = sum / period;
    } else if (i === period + period - 2) {
      adx[i] = sum / period;
    }
  }
  return adx;
}

// ═══════════════════════════════════════════════════════════════════
// REGIME DETECTION (simplified, standalone)
// ═══════════════════════════════════════════════════════════════════

function detectRegimes(candles, atr, adx) {
  const n = candles.length;
  const regimes = new Array(n).fill('UNKNOWN');

  // ATR percentile distribution (rolling 200-period)
  const atrZ = new Array(n).fill(null);
  for (let i = 200; i < n; i++) {
    if (atr[i] === null) continue;
    let sum = 0, sqSum = 0, count = 0;
    for (let j = i - 199; j <= i; j++) {
      if (atr[j] !== null) {
        sum += atr[j];
        sqSum += atr[j] ** 2;
        count++;
      }
    }
    const mean = sum / count;
    const std = Math.sqrt(sqSum / count - mean ** 2);
    atrZ[i] = std > 0 ? (atr[i] - mean) / std : 0;
  }

  // Bollinger width (20-period)
  const closes = candles.map(c => c[4]);
  const bbSma = computeSMA(closes, 20);
  const bbStd = computeStdDev(closes, 20);
  const bbWidth = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (bbSma[i] !== null && bbStd[i] !== null && closes[i] > 0) {
      bbWidth[i] = (2 * 2 * bbStd[i]) / closes[i]; // (upper-lower)/middle
    }
  }

  // BB width percentile (rolling 200)
  const bbPct = new Array(n).fill(null);
  for (let i = 200; i < n; i++) {
    if (bbWidth[i] === null) continue;
    let below = 0, count = 0;
    for (let j = i - 199; j <= i; j++) {
      if (bbWidth[j] !== null) {
        count++;
        if (bbWidth[j] < bbWidth[i]) below++;
      }
    }
    bbPct[i] = count > 0 ? below / count : 0.5;
  }

  for (let i = 200; i < n; i++) {
    const a = adx[i];
    const az = atrZ[i];
    const bp = bbPct[i];

    if (a === null || az === null || bp === null) continue;

    if (bp < 0.2 && az < -0.5) {
      regimes[i] = 'LOW_VOL';
    } else if (bp < 0.35) {
      regimes[i] = 'RANGING';
    } else if (a > 25 && az > 0.3) {
      // Distinguish trend direction
      const ema20 = computeEMA(closes, 20);
      if (ema20[i] !== null) {
        regimes[i] = closes[i] > ema20[i] ? 'TRENDING_UP' : 'TRENDING_DOWN';
      } else {
        regimes[i] = 'TRENDING_UP';
      }
    } else if (az > 1.0) {
      regimes[i] = 'VOL_EXPANSION';
    } else {
      regimes[i] = 'RANGING';
    }
  }

  return regimes;
}

// ═══════════════════════════════════════════════════════════════════
// EVENT DETECTORS
// ═══════════════════════════════════════════════════════════════════

// Returns: { indices: [i, i, ...], metadata: [{...}, ...] }

// ── FAMILY 1: MOMENTUM / BREAKOUT ──────────────────────────────

function detectBreakoutHigh(candles, lookback) {
  const events = [];
  for (let i = lookback; i < candles.length - 1; i++) {
    const high = candles[i][2];
    let isHighest = true;
    for (let j = i - lookback; j < i; j++) {
      if (candles[j][2] >= high) { isHighest = false; break; }
    }
    if (isHighest) {
      events.push({ index: i, type: 'breakout_high', lookback });
    }
  }
  return events;
}

function detectBreakoutLow(candles, lookback) {
  const events = [];
  for (let i = lookback; i < candles.length - 1; i++) {
    const low = candles[i][3];
    let isLowest = true;
    for (let j = i - lookback; j < i; j++) {
      if (candles[j][3] <= low) { isLowest = false; break; }
    }
    if (isLowest) {
      events.push({ index: i, type: 'breakout_low', lookback });
    }
  }
  return events;
}

function detectRangeExpansion(candles, atr, expansionMult) {
  const events = [];
  for (let i = 2; i < candles.length - 1; i++) {
    if (atr[i] === null || atr[i - 1] === null) continue;
    const range = candles[i][2] - candles[i][3];
    const prevRange = candles[i - 1][2] - candles[i - 1][3];
    if (prevRange <= 0) continue;

    // Current candle range is expansionMult x previous AND > ATR
    if (range > prevRange * expansionMult && range > atr[i]) {
      const direction = candles[i][4] > candles[i][1] ? 'bullish' : 'bearish';
      events.push({ index: i, type: 'range_expansion', direction, mult: range / prevRange });
    }
  }
  return events;
}

function detectStrongContinuation(candles, atr, minATRMult) {
  const events = [];
  for (let i = 3; i < candles.length - 1; i++) {
    if (atr[i] === null) continue;
    const body = Math.abs(candles[i][4] - candles[i][1]);
    if (body < atr[i] * minATRMult) continue;

    // At least 2 of previous 3 candles same direction
    const dir = candles[i][4] > candles[i][1] ? 1 : -1;
    let sameDir = 0;
    for (let j = 1; j <= 3; j++) {
      const pd = candles[i - j][4] > candles[i - j][1] ? 1 : -1;
      if (pd === dir) sameDir++;
    }
    if (sameDir >= 2) {
      events.push({ index: i, type: 'strong_continuation', direction: dir > 0 ? 'bullish' : 'bearish' });
    }
  }
  return events;
}

function detectMomentumConfluence(candles, atr, adx, ema9, ema21) {
  const events = [];
  for (let i = 5; i < candles.length - 1; i++) {
    if (atr[i] === null || adx[i] === null || ema9[i] === null || ema21[i] === null) continue;

    const body = Math.abs(candles[i][4] - candles[i][1]);
    const dir = candles[i][4] > candles[i][1] ? 1 : -1;
    const emaAligned = dir > 0 ? ema9[i] > ema21[i] : ema9[i] < ema21[i];
    const strongCandle = body > atr[i] * 0.8;
    const trendConfirmed = adx[i] > 20;

    // 2 of 3 confluence
    const score = (emaAligned ? 1 : 0) + (strongCandle ? 1 : 0) + (trendConfirmed ? 1 : 0);
    if (score >= 2) {
      events.push({
        index: i,
        type: 'momentum_confluence',
        direction: dir > 0 ? 'bullish' : 'bearish',
        score,
        emaAligned, strongCandle, trendConfirmed
      });
    }
  }
  return events;
}

// ── FAMILY 2: VOLATILITY TRANSITION ────────────────────────────

function detectVolCompressionExpansion(atr, atrZ, bbWidth) {
  const events = [];
  for (let i = 205; i < atr.length - 1; i++) {
    if (atrZ[i] === null || atrZ[i - 5] === null || bbWidth[i] === null || bbWidth[i - 10] === null) continue;

    // Was compressed (atrZ < -0.5) 5-10 bars ago, now expanding (atrZ > 0.3)
    const wasCompressed = atrZ[i - 5] < -0.5;
    const nowExpanding = atrZ[i] > 0.3;
    const bbWidening = bbWidth[i] > bbWidth[i - 5] * 1.2;

    if (wasCompressed && nowExpanding) {
      events.push({
        index: i,
        type: 'vol_compression_to_expansion',
        atrZBefore: atrZ[i - 5],
        atrZNow: atrZ[i],
        bbWidening
      });
    }
  }
  return events;
}

function detectATRSpike(candles, atr, atrZ, spikeThreshold) {
  const events = [];
  for (let i = 205; i < candles.length - 1; i++) {
    if (atrZ[i] === null) continue;
    if (atrZ[i] > spikeThreshold) {
      const direction = candles[i][4] > candles[i][1] ? 'bullish' : 'bearish';
      events.push({
        index: i,
        type: 'atr_spike',
        direction,
        atrZ: atrZ[i],
        threshold: spikeThreshold
      });
    }
  }
  return events;
}

function detectAbnormalRangeExpansion(candles, atr) {
  const events = [];
  // Compute rolling avg range
  const ranges = candles.map(c => c[2] - c[3]);
  const avgRange = computeSMA(ranges, 20);

  for (let i = 25; i < candles.length - 1; i++) {
    if (avgRange[i] === null || atr[i] === null) continue;
    const currentRange = ranges[i];
    if (currentRange > avgRange[i] * 2.5 && currentRange > atr[i] * 1.5) {
      events.push({
        index: i,
        type: 'abnormal_range_expansion',
        direction: candles[i][4] > candles[i][1] ? 'bullish' : 'bearish',
        ratio: currentRange / avgRange[i]
      });
    }
  }
  return events;
}

function detectVolSqueeze(candles, bbWidth, atrZ) {
  const events = [];
  for (let i = 210; i < candles.length - 1; i++) {
    if (bbWidth[i] === null || atrZ[i] === null) continue;

    // Find squeeze: BB width in bottom 15th percentile of 200-period lookback
    let bbBelow = 0, bbCount = 0;
    for (let j = i - 199; j <= i; j++) {
      if (bbWidth[j] !== null) {
        bbCount++;
        if (bbWidth[j] < bbWidth[i]) bbBelow++;
      }
    }
    const bbPercentile = bbCount > 0 ? bbBelow / bbCount : 0.5;

    if (bbPercentile < 0.15 && atrZ[i] < -0.3) {
      // Squeeze detected. Mark as event — watch for breakout in next N bars
      events.push({
        index: i,
        type: 'vol_squeeze',
        bbPercentile,
        atrZ: atrZ[i]
      });
    }
  }
  return events;
}

// ── FAMILY 3: STRUCTURAL / LIQUIDITY ───────────────────────────

function detectStopRunContinuation(candles, atr) {
  const events = [];
  for (let i = 2; i < candles.length - 1; i++) {
    if (atr[i] === null) continue;

    const wickUp = candles[i][2] - Math.max(candles[i][1], candles[i][4]);
    const wickDown = Math.min(candles[i][1], candles[i][4]) - candles[i][3];
    const body = Math.abs(candles[i][4] - candles[i][1]);

    // Large wick (stop run) but candle closes IN direction of continuation
    // Bullish stop run: wick above, closes near low, then next candle is bullish
    if (wickUp > body * 2 && wickUp > atr[i] * 0.5) {
      // Wick up, check if next candle continues UP (not reversal — continuation)
      if (i + 1 < candles.length && candles[i + 1][4] > candles[i + 1][1]) {
        events.push({
          index: i + 1, // signal on NEXT candle
          type: 'stop_run_continuation_up',
          wickRatio: wickUp / body
        });
      }
    }
    if (wickDown > body * 2 && wickDown > atr[i] * 0.5) {
      if (i + 1 < candles.length && candles[i + 1][4] < candles[i + 1][1]) {
        events.push({
          index: i + 1,
          type: 'stop_run_continuation_down',
          wickRatio: wickDown / body
        });
      }
    }
  }
  return events;
}

function detectDisplacementCandle(candles, atr, adx) {
  const events = [];
  for (let i = 5; i < candles.length - 1; i++) {
    if (atr[i] === null || adx[i] === null) continue;

    const body = Math.abs(candles[i][4] - candles[i][1]);
    const range = candles[i][2] - candles[i][3];
    if (range === 0) continue;

    // Large body relative to range (>70%), body > 1.5 ATR, not immediately reverted next candle
    const bodyRatio = body / range;
    const isDisplacement = bodyRatio > 0.7 && body > atr[i] * 1.5;

    if (!isDisplacement) continue;

    // Check: next candle does NOT fully reverse
    const dir = candles[i][4] > candles[i][1] ? 1 : -1;
    const nextCandle = candles[i + 1];
    const nextBody = nextCandle[4] - nextCandle[1];
    const notReverted = (dir > 0 && nextBody > -body * 0.5) || (dir < 0 && nextBody < body * 0.5);

    if (notReverted) {
      events.push({
        index: i,
        type: 'displacement_candle',
        direction: dir > 0 ? 'bullish' : 'bearish',
        bodyRatio,
        bodyATRMult: body / atr[i]
      });
    }
  }
  return events;
}

function detectImbalanceMove(candles, atr) {
  const events = [];
  for (let i = 2; i < candles.length - 1; i++) {
    if (atr[i] === null) continue;

    // Gap between candle[i-1].high and candle[i].low (or vice versa)
    const gapUp = candles[i][3] - candles[i - 1][2];
    const gapDown = candles[i - 1][3] - candles[i][2];

    if (gapUp > atr[i] * 0.3) {
      events.push({
        index: i,
        type: 'imbalance_gap_up',
        gapSize: gapUp / atr[i]
      });
    }
    if (gapDown > atr[i] * 0.3) {
      events.push({
        index: i,
        type: 'imbalance_gap_down',
        gapSize: gapDown / atr[i]
      });
    }
  }
  return events;
}

function detectPOCShift(candles, volume) {
  // Simplified: detect high-volume candles where close is far from VWAP of session
  const events = [];
  const n = candles.length;

  // Rolling VWAP (20-period)
  let cumVol = 0, cumTPV = 0;
  const vwap = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const tp = (candles[i][2] + candles[i][3] + candles[i][4]) / 3;
    const vol = volume[i];
    cumTPV += tp * vol;
    cumVol += vol;
    if (i >= 20) {
      const oldTP = (candles[i - 20][2] + candles[i - 20][3] + candles[i - 20][4]) / 3;
      cumTPV -= oldTP * volume[i - 20];
      cumVol -= volume[i - 20];
    }
    if (cumVol > 0) vwap[i] = cumTPV / cumVol;
  }

  // Volume percentile
  const volSMA = computeSMA(volume, 20);
  const volStd = computeStdDev(volume, 20);

  for (let i = 25; i < n - 1; i++) {
    if (vwap[i] === null || volSMA[i] === null || volStd[i] === null || volStd[i] === 0) continue;

    const volZ = (volume[i] - volSMA[i]) / volStd[i];
    const distFromVWAP = Math.abs(candles[i][4] - vwap[i]) / vwap[i];

    // High volume + significant deviation from VWAP = potential POC shift
    if (volZ > 1.5 && distFromVWAP > 0.005) {
      events.push({
        index: i,
        type: 'poc_shift',
        direction: candles[i][4] > vwap[i] ? 'bullish' : 'bearish',
        volZ,
        distFromVWAP
      });
    }
  }
  return events;
}

// ═══════════════════════════════════════════════════════════════════
// FORWARD RETURN & PATH ANALYSIS
// ═══════════════════════════════════════════════════════════════════

function computeForwardReturns(candles, eventIndex, horizons) {
  const entry = candles[eventIndex][4]; // close price
  const results = {};

  for (const h of horizons) {
    const exitIdx = eventIndex + h;
    if (exitIdx >= candles.length) {
      results[`fwd_${h}h`] = null;
      continue;
    }
    const exit = candles[exitIdx][4];
    results[`fwd_${h}h`] = (exit - entry) / entry;
  }

  return results;
}

function computeMAEMFE(candles, eventIndex, maxHorizon) {
  const entry = candles[eventIndex][4];
  let mae = 0; // max adverse (how far against)
  let mfe = 0; // max favorable (how far for)
  let maeTime = 0;
  let mfeTime = 0;

  const maxIdx = Math.min(eventIndex + maxHorizon, candles.length - 1);

  for (let j = eventIndex + 1; j <= maxIdx; j++) {
    const adverseLow = (candles[j][3] - entry) / entry;
    const adverseHigh = (candles[j][2] - entry) / entry;

    // MAE is the worst excursion against the entry
    if (adverseLow < mae) { mae = adverseLow; maeTime = j - eventIndex; }
    if (adverseHigh > mfe) { mfe = adverseHigh; mfeTime = j - eventIndex; }
  }

  return {
    mae, // negative = adverse excursion
    mfe, // positive = favorable excursion
    maeTime, // bars to MAE
    mfeTime, // bars to MFE
    mfeBeforeMae: mfeTime < maeTime // did favorable come first?
  };
}

// ═══════════════════════════════════════════════════════════════════
// CLUSTERING ANALYSIS
// ═══════════════════════════════════════════════════════════════════

function analyzeClustering(indices, minGap) {
  if (indices.length < 2) return { clusterRatio: 0, independentEstimate: indices.length, medianGap: Infinity };

  const gaps = [];
  for (let i = 1; i < indices.length; i++) {
    gaps.push(indices[i] - indices[i - 1]);
  }

  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];

  // Count events that are within minGap of ANY other event
  let clustered = 0;
  for (let i = 0; i < indices.length; i++) {
    // Check if within minGap of the next event
    if (i < indices.length - 1 && indices[i + 1] - indices[i] < minGap) {
      clustered++;
    }
  }

  const clusterRatio = clustered / indices.length;

  // Conservative independent estimate: assume events in a cluster of size k contribute k/ceil(k/minGap) independent events
  // Simpler: just use ratio
  const independentEstimate = Math.round(indices.length * (1 - clusterRatio * 0.8));

  return { clusterRatio, independentEstimate, medianGap, totalEvents: indices.length };
}

// ═══════════════════════════════════════════════════════════════════
// DISTRIBUTION STATISTICS
// ═══════════════════════════════════════════════════════════════════

function computeStats(returns) {
  const valid = returns.filter(r => r !== null && !isNaN(r));
  if (valid.length < 10) return null;

  const n = valid.length;
  const mean = valid.reduce((s, v) => s + v, 0) / n;
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];

  const pos = valid.filter(r => r > 0).length;
  const neg = valid.filter(r => r < 0).length;
  const pctPositive = pos / n;

  // Variance, skewness, kurtosis
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of valid) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;

  const std = Math.sqrt(m2);
  const skewness = std > 0 ? m3 / (std ** 3) : 0;
  const kurtosis = m2 > 0 ? m4 / (m2 ** 2) - 3 : 0; // excess kurtosis

  // t-statistic for mean != 0
  const tStat = std > 0 ? mean / (std / Math.sqrt(n)) : 0;

  // Simple confidence: is mean significantly different from 0 at ~95%?
  const significant = Math.abs(tStat) > 1.96;

  return {
    n, mean, median, std, min: sorted[0], max: sorted[n - 1],
    pctPositive, pos, neg,
    skewness, kurtosis, tStat, significant,
    // Annualized Sharpe-like (assuming hourly bars, ~8760 per year)
    sharpeApprox: std > 0 ? (mean / std) * Math.sqrt(8760) : 0
  };
}

// ═══════════════════════════════════════════════════════════════════
// TIME SPLIT STABILITY TEST
// ═══════════════════════════════════════════════════════════════════

function timeSplitStability(candles, events, horizon) {
  if (events.length < 40) return { stable: false, reason: 'too few events' };

  const midPoint = Math.floor(candles.length / 2);
  const firstHalf = events.filter(e => e.index < midPoint);
  const secondHalf = events.filter(e => e.index >= midPoint);

  if (firstHalf.length < 15 || secondHalf.length < 15) {
    return { stable: false, reason: 'uneven split' };
  }

  const rets1 = firstHalf.map(e => {
    const idx = e.index + horizon;
    return idx < candles.length ? (candles[idx][4] - candles[e.index][4]) / candles[e.index][4] : null;
  }).filter(r => r !== null);

  const rets2 = secondHalf.map(e => {
    const idx = e.index + horizon;
    return idx < candles.length ? (candles[idx][4] - candles[e.index][4]) / candles[e.index][4] : null;
  }).filter(r => r !== null);

  if (rets1.length < 10 || rets2.length < 10) return { stable: false, reason: 'insufficient returns' };

  const mean1 = rets1.reduce((s, v) => s + v, 0) / rets1.length;
  const mean2 = rets2.reduce((s, v) => s + v, 0) / rets2.length;

  // Same direction?
  const sameSign = (mean1 > 0 && mean2 > 0) || (mean1 < 0 && mean2 < 0);

  // Similar magnitude? (within 3x)
  const ratio = Math.abs(mean1) > 1e-8 ? Math.abs(mean2 / mean1) : (Math.abs(mean2) > 1e-8 ? 0 : 1);

  return {
    stable: sameSign && ratio > 0.33 && ratio < 3,
    mean1, mean2, sameSign, ratio,
    n1: rets1.length, n2: rets2.length
  };
}

// ═══════════════════════════════════════════════════════════════════
// REGIME BREAKDOWN
// ═══════════════════════════════════════════════════════════════════

function regimeBreakdown(candles, events, regimes, horizon) {
  const byRegime = {};
  for (const e of events) {
    const regime = regimes[e.index] || 'UNKNOWN';
    if (!byRegime[regime]) byRegime[regime] = [];

    const exitIdx = e.index + horizon;
    if (exitIdx < candles.length) {
      byRegime[regime].push((candles[exitIdx][4] - candles[e.index][4]) / candles[e.index][4]);
    }
  }

  const result = {};
  for (const [regime, rets] of Object.entries(byRegime)) {
    if (rets.length >= 10) {
      const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
      const pos = rets.filter(r => r > 0).length / rets.length;
      result[regime] = { n: rets.length, mean, pctPositive: pos };
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// EARLY REJECTION FILTER
// ═══════════════════════════════════════════════════════════════════

function earlyReject(eventResult) {
  const flags = [];

  // 1. Clustering > 50%
  if (eventResult.clustering.clusterRatio > CLUSTERING_REJECT_THRESHOLD) {
    flags.push(`CLUSTERING: ${(eventResult.clustering.clusterRatio * 100).toFixed(1)}% clustered (>${CLUSTERING_REJECT_THRESHOLD * 100}%)`);
  }

  // 2. Insufficient independent events
  if (eventResult.clustering.independentEstimate < MIN_EVENTS_INDEPENDENT) {
    flags.push(`SAMPLE: only ~${eventResult.clustering.independentEstimate} independent events (need ${MIN_EVENTS_INDEPENDENT})`);
  }

  // 3. Near-zero expectancy (not significant at 95%)
  const bestHorizon = eventResult.stats[FORWARD_HORIZONS.length - 1]; // longest horizon
  if (bestHorizon && !bestHorizon.significant) {
    flags.push(`NOT_SIGNIFICANT: t-stat=${bestHorizon.tStat.toFixed(2)} (need |t|>1.96)`);
  }

  // 4. Time split instability
  if (eventResult.timeSplit && !eventResult.timeSplit.stable) {
    flags.push(`UNSTABLE: split means ${eventResult.timeSplit.mean1?.toFixed(6)} vs ${eventResult.timeSplit.mean2?.toFixed(6)}`);
  }

  // 5. Near-zero mean return
  if (bestHorizon && Math.abs(bestHorizon.mean) < 0.0001) {
    flags.push(`ZERO_EDGE: mean return ${(bestHorizon.mean * 100).toFixed(4)}%`);
  }

  return flags;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ANALYSIS
// ═══════════════════════════════════════════════════════════════════

async function analyzeAsset(symbol, label) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🔬 ANALYZING: ${label} (${symbol})`);
  console.log(`${'═'.repeat(60)}`);

  // Load data
  const candles = await fetchCandles(symbol);
  if (candles.length < 500) {
    console.log(`  ❌ Insufficient data: ${candles.length} candles`);
    return null;
  }

  console.log(`  📐 Computing indicators...`);
  const closes = candles.map(c => c[4]);
  const volumes = candles.map(c => c[5]);
  const atr = computeATR(candles, 14);
  const adx = computeADX(candles, 14);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const bbSma = computeSMA(closes, 20);
  const bbStd = computeStdDev(closes, 20);
  const bbWidth = candles.map((c, i) => {
    if (bbSma[i] === null || bbStd[i] === null || closes[i] === 0) return null;
    return (2 * 2 * bbStd[i]) / closes[i];
  });

  // ATR z-score (rolling 200)
  const atrZ = new Array(candles.length).fill(null);
  for (let i = 200; i < candles.length; i++) {
    if (atr[i] === null) continue;
    let sum = 0, sqSum = 0, count = 0;
    for (let j = i - 199; j <= i; j++) {
      if (atr[j] !== null) { sum += atr[j]; sqSum += atr[j] ** 2; count++; }
    }
    const mean = sum / count;
    const std = Math.sqrt(sqSum / count - mean ** 2);
    atrZ[i] = std > 0 ? (atr[i] - mean) / std : 0;
  }

  const regimes = detectRegimes(candles, atr, adx);

  console.log(`  🔍 Detecting events...`);

  // ═══════════════════════════════════════════════════════════════
  // DEFINE ALL EVENT HYPOTHESES
  // ═══════════════════════════════════════════════════════════════

  const hypotheses = [
    // FAMILY 1: MOMENTUM / BREAKOUT
    { name: 'breakout_20_high', fn: () => detectBreakoutHigh(candles, 20) },
    { name: 'breakout_50_high', fn: () => detectBreakoutHigh(candles, 50) },
    { name: 'breakout_20_low', fn: () => detectBreakoutLow(candles, 20) },
    { name: 'range_expansion_2x', fn: () => detectRangeExpansion(candles, atr, 2.0) },
    { name: 'range_expansion_3x', fn: () => detectRangeExpansion(candles, atr, 3.0) },
    { name: 'strong_continuation_1x', fn: () => detectStrongContinuation(candles, atr, 1.0) },
    { name: 'momentum_confluence', fn: () => detectMomentumConfluence(candles, atr, adx, ema9, ema21) },

    // FAMILY 2: VOLATILITY TRANSITION
    { name: 'vol_compression_expansion', fn: () => detectVolCompressionExpansion(atr, atrZ, bbWidth) },
    { name: 'atr_spike_1.5', fn: () => detectATRSpike(candles, atr, atrZ, 1.5) },
    { name: 'atr_spike_2.0', fn: () => detectATRSpike(candles, atr, atrZ, 2.0) },
    { name: 'abnormal_range_2.5x', fn: () => detectAbnormalRangeExpansion(candles, atr) },
    { name: 'vol_squeeze', fn: () => detectVolSqueeze(candles, bbWidth, atrZ) },

    // FAMILY 3: STRUCTURAL / LIQUIDITY
    { name: 'stop_run_continuation', fn: () => detectStopRunContinuation(candles, atr) },
    { name: 'displacement_candle', fn: () => detectDisplacementCandle(candles, atr, adx) },
    { name: 'imbalance_gap', fn: () => detectImbalanceMove(candles, atr) },
    { name: 'poc_shift', fn: () => detectPOCShift(candles, volumes) },
  ];

  const results = [];

  for (const hyp of hypotheses) {
    console.log(`\n  ── Testing: ${hyp.name}`);

    let events;
    try {
      events = hyp.fn();
    } catch (err) {
      console.log(`    ❌ Error: ${err.message}`);
      continue;
    }

    if (events.length < MIN_EVENTS_RAW) {
      console.log(`    ⚠️  Too few events: ${events.length} (need ${MIN_EVENTS_RAW})`);
      results.push({ hypothesis: hyp.name, status: 'REJECTED', reason: `too few events: ${events.length}` });
      continue;
    }

    // Deduplicate indices (some detectors may overlap)
    const uniqueIndices = [...new Set(events.map(e => e.index))].sort((a, b) => a - b);

    // Clustering analysis (min gap = 4 bars = 4h for independence)
    const clustering = analyzeClustering(uniqueIndices, 4);

    // Forward returns for each horizon
    const statsByHorizon = {};
    for (const h of FORWARD_HORIZONS) {
      const rets = uniqueIndices.map(i => {
        const exitIdx = i + h;
        return exitIdx < candles.length ? (candles[exitIdx][4] - candles[i][4]) / candles[i][4] : null;
      }).filter(r => r !== null);
      statsByHorizon[h] = computeStats(rets);
    }

    // MAE/MFE analysis (using max horizon)
    const maxH = Math.max(...FORWARD_HORIZONS);
    const pathData = uniqueIndices.slice(0, 500).map(i => computeMAEMFE(candles, i, maxH)); // sample for speed

    // Time split stability (at longest horizon)
    const split = timeSplitStability(candles, events, maxH);

    // Regime breakdown (at 4h horizon)
    const regimeStats = regimeBreakdown(candles, events, regimes, 4);

    // Build result object
    const result = {
      hypothesis: hyp.name,
      asset: label,
      rawEvents: uniqueIndices.length,
      clustering,
      stats: statsByHorizon,
      timeSplit: split,
      regimeBreakdown: regimeStats,
    };

    // Apply early rejection
    const rejectionFlags = earlyReject(result);
    result.rejectionFlags = rejectionFlags;
    result.status = rejectionFlags.length === 0 ? 'SURVIVED' : 'REJECTED';

    // Directional bias summary (at max horizon)
    const bestStats = statsByHorizon[maxH];
    result.directionalBias = bestStats ? {
      mean: bestStats.mean,
      median: bestStats.median,
      pctPositive: bestStats.pctPositive,
      tStat: bestStats.tStat,
      significant: bestStats.significant,
      skewness: bestStats.skewness,
      kurtosis: bestStats.kurtosis
    } : null;

    // Path behavior summary
    const mfeFirstCount = pathData.filter(p => p.mfeBeforeMae).length;
    result.pathBehavior = {
      mfeFirstPct: pathData.length > 0 ? mfeFirstCount / pathData.length : 0,
      avgMAE: pathData.length > 0 ? pathData.reduce((s, p) => s + p.mae, 0) / pathData.length : 0,
      avgMFE: pathData.length > 0 ? pathData.reduce((s, p) => s + p.mfe, 0) / pathData.length : 0,
      avgMAETime: pathData.length > 0 ? pathData.reduce((s, p) => s + p.maeTime, 0) / pathData.length : 0,
      avgMFETime: pathData.length > 0 ? pathData.reduce((s, p) => s + p.mfeTime, 0) / pathData.length : 0,
    };

    results.push(result);

    // Console output
    const statusIcon = result.status === 'SURVIVED' ? '✅' : '❌';
    console.log(`    ${statusIcon} ${result.status} | Events: ${uniqueIndices.length} | Independent: ~${clustering.independentEstimate} | Cluster: ${(clustering.clusterRatio * 100).toFixed(1)}%`);
    if (bestStats) {
      console.log(`    📊 Mean: ${(bestStats.mean * 100).toFixed(4)}% | Median: ${(bestStats.median * 100).toFixed(4)}% | +Rate: ${(bestStats.pctPositive * 100).toFixed(1)}% | t=${bestStats.tStat.toFixed(2)} | Skew: ${bestStats.skewness.toFixed(2)}`);
    }
    console.log(`    📈 Path: MFE-first ${(result.pathBehavior.mfeFirstPct * 100).toFixed(0)}% | Avg MAE: ${(result.pathBehavior.avgMAE * 100).toFixed(3)}% | Avg MFE: ${(result.pathBehavior.avgMFE * 100).toFixed(3)}%`);
    if (result.status === 'REJECTED') {
      for (const f of rejectionFlags) console.log(`      🚩 ${f}`);
    }

    // Regime breakdown (compact)
    const regimeEntries = Object.entries(regimeStats);
    if (regimeEntries.length > 0) {
      const regimeStr = regimeEntries.map(([r, s]) => `${r}:${s.n}(μ=${(s.mean * 100).toFixed(3)}%)`).join(' | ');
      console.log(`    🌍 Regimes: ${regimeStr}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  return { asset: label, results };
}

// ═══════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════

function generateReport(allResults) {
  let report = '';
  report += `# 🔬 EDGE DISCOVERY REPORT v2.0\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Method:** Structural event hypothesis testing with early rejection\n`;
  report += `**Data:** ${EXCHANGE} ${TIMEFRAME}, ${START_DATE} → ${END_DATE}\n\n`;

  report += `---\n\n`;

  // Summary
  let totalTested = 0, totalSurvived = 0;
  const survivors = [];

  for (const ar of allResults) {
    if (!ar) continue;
    for (const r of ar.results) {
      totalTested++;
      if (r.status === 'SURVIVED') {
        totalSurvived++;
        survivors.push({ asset: ar.asset, ...r });
      }
    }
  }

  report += `## SUMMARY\n\n`;
  report += `- **Hypotheses tested:** ${totalTested}\n`;
  report += `- **Survived early filters:** ${totalSurvived}\n`;
  report += `- **Rejection rate:** ${((1 - totalSurvived / totalTested) * 100).toFixed(1)}%\n\n`;

  if (survivors.length === 0) {
    report += `> ⚠️ **NO CANDIDATES SURVIVED EARLY REJECTION.**\n`;
    report += `> All tested event types failed clustering, significance, stability, or sample size filters.\n`;
    report += `> This is a valid result — it means no obvious structural edge exists in these event families.\n\n`;
  }

  // Per-asset detail
  for (const ar of allResults) {
    if (!ar) continue;
    report += `---\n\n`;
    report += `## ${ar.asset}\n\n`;

    // Inventory
    report += `### Event Inventory\n\n`;
    report += `| Hypothesis | Raw Events | Independent | Cluster % | Status |\n`;
    report += `|------------|-----------|-------------|-----------|--------|\n`;
    for (const r of ar.results) {
      const clust = r.clustering || {};
      report += `| ${r.hypothesis} | ${r.rawEvents || '—'} | ${clust.independentEstimate || '—'} | ${clust.clusterRatio != null ? (clust.clusterRatio * 100).toFixed(1) + '%' : '—'} | ${r.status} |\n`;
    }
    report += `\n`;

    // Surviving candidates detail
    const assetSurvivors = ar.results.filter(r => r.status === 'SURVIVED');
    if (assetSurvivors.length > 0) {
      report += `### Surviving Candidates\n\n`;
      for (const s of assetSurvivors) {
        report += `#### ${s.hypothesis}\n\n`;

        // Stats by horizon
        report += `**Forward Returns:**\n\n`;
        report += `| Horizon | Mean | Median | +Rate | t-stat | Significant | Skew | Kurtosis |\n`;
        report += `|---------|------|--------|-------|--------|-------------|------|----------|\n`;
        for (const h of FORWARD_HORIZONS) {
          const st = s.stats[h];
          if (!st) continue;
          report += `| +${h}h | ${(st.mean * 100).toFixed(4)}% | ${(st.median * 100).toFixed(4)}% | ${(st.pctPositive * 100).toFixed(1)}% | ${st.tStat.toFixed(2)} | ${st.significant ? '✅' : '❌'} | ${st.skewness.toFixed(2)} | ${st.kurtosis.toFixed(2)} |\n`;
        }
        report += `\n`;

        // Path behavior
        if (s.pathBehavior) {
          report += `**Path Behavior:**\n`;
          report += `- MFE before MAE: ${(s.pathBehavior.mfeFirstPct * 100).toFixed(0)}% of trades\n`;
          report += `- Avg MAE: ${(s.pathBehavior.avgMAE * 100).toFixed(3)}%\n`;
          report += `- Avg MFE: ${(s.pathBehavior.avgMFE * 100).toFixed(3)}%\n`;
          report += `- Avg time to MAE: ${s.pathBehavior.avgMAETime.toFixed(1)} bars\n`;
          report += `- Avg time to MFE: ${s.pathBehavior.avgMFETime.toFixed(1)} bars\n\n`;
        }

        // Time split
        if (s.timeSplit) {
          report += `**Time Split Stability:** ${s.timeSplit.stable ? '✅ STABLE' : '❌ UNSTABLE'}\n`;
          if (s.timeSplit.mean1 != null) {
            report += `- First half mean: ${(s.timeSplit.mean1 * 100).toFixed(4)}% (${s.timeSplit.n1} events)\n`;
            report += `- Second half mean: ${(s.timeSplit.mean2 * 100).toFixed(4)}% (${s.timeSplit.n2} events)\n`;
            report += `- Ratio: ${s.timeSplit.ratio?.toFixed(2)}x\n\n`;
          }
        }

        // Regime breakdown
        if (s.regimeBreakdown && Object.keys(s.regimeBreakdown).length > 0) {
          report += `**Regime Breakdown (4h horizon):**\n\n`;
          report += `| Regime | Events | Mean Return | +Rate |\n`;
          report += `|--------|--------|-------------|-------|\n`;
          for (const [regime, stats] of Object.entries(s.regimeBreakdown)) {
            report += `| ${regime} | ${stats.n} | ${(stats.mean * 100).toFixed(4)}% | ${(stats.pctPositive * 100).toFixed(1)}% |\n`;
          }
          report += `\n`;
        }

        // Risk flags
        report += `**Risk Flags:** None (passed all early filters)\n\n`;
      }
    }

    // Rejected with reasons
    const rejected = ar.results.filter(r => r.status === 'REJECTED');
    if (rejected.length > 0) {
      report += `### Rejected Hypotheses\n\n`;
      for (const r of rejected) {
        report += `- **${r.hypothesis}**: ${r.reason || (r.rejectionFlags || []).join('; ')}\n`;
      }
      report += `\n`;
    }
  }

  // Final assessment
  report += `---\n\n`;
  report += `## FINAL ASSESSMENT\n\n`;

  if (survivors.length > 0) {
    report += `### Candidates Requiring Adversarial Testing\n\n`;
    for (const s of survivors) {
      const bestH = FORWARD_HORIZONS[FORWARD_HORIZONS.length - 1];
      const st = s.stats[bestH];
      report += `- **${s.asset} / ${s.hypothesis}**: `;
      report += `mean=${st ? (st.mean * 100).toFixed(4) + '%' : '?'}, `;
      report += `+rate=${st ? (st.pctPositive * 100).toFixed(1) + '%' : '?'}, `;
      report += `t=${st ? st.tStat.toFixed(2) : '?'}, `;
      report += `~${s.clustering.independentEstimate} independent events`;
      report += `\n`;
    }
    report += `\n> These candidates passed early rejection but have NOT been validated.\n`;
    report += `> Next step: adversarial stress testing (subsample, regime-split, out-of-sample).\n`;
  } else {
    report += `> **No structural edges discovered in the tested event families.**\n`;
    report += `>\n`;
    report += `> Possible next steps:\n`;
    report += `> 1. Test different event families (e.g., volume-based, microstructure)\n`;
    report += `> 2. Use higher-frequency data (15m, 5m) for timing-sensitive events\n`;
    report += `> 3. Combine event types (confluence-based hypotheses)\n`;
    report += `> 4. Test conditional edges (e.g., "X works ONLY in regime Y")\n`;
  }

  return report;
}

// ═══════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🔬 EDGE DISCOVERY ENGINE v2.0                                  ║
║  Structural Event Hypothesis Testing                            ║
║  Assets: ETH, SOL, BTC, XRP | Timeframe: 1h                    ║
║  Period: 2022-01-01 → 2026-03-31                               ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const allResults = [];

  for (let i = 0; i < ASSETS.length; i++) {
    try {
      const result = await analyzeAsset(ASSETS[i], ASSET_LABELS[i]);
      allResults.push(result);
    } catch (err) {
      console.error(`  ❌ Failed to analyze ${ASSET_LABELS[i]}: ${err.message}`);
      allResults.push(null);
    }
  }

  // Generate report
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📝 Generating report...`);

  const report = generateReport(allResults);

  const reportPath = path.join(__dirname, '..', 'data', `edge-discovery-report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`  ✅ Report saved: ${reportPath}`);

  // Also save raw results as JSON
  const jsonPath = path.join(__dirname, '..', 'data', `edge-discovery-raw-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`  ✅ Raw data saved: ${jsonPath}`);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🏁 EDGE DISCOVERY COMPLETE`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
