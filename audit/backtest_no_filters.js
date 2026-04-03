// ═══════════════════════════════════════════════════════════════
// backtest_no_filters.js — A/B Test: Disable Portfolio Risk
// ═══════════════════════════════════════════════════════════════
// Same backtest engine but with portfolio risk and exhaustion
// disabled. Answers: "Would these signals have been profitable?"
//
// Run: node audit/backtest_no_filters.js --symbol SOL/USDT:USDT

import ccxt from 'ccxt';
import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';
import fs from 'fs';
import path from 'path';
import {
  computeEMA, computeATR, computeADX, computeBollinger,
  computeDelta, computeVolumeMetrics,
  extractRegimes, extractFVGs, extractOrderBlocks,
  extractLiquiditySweeps, extractOTEs,
} from '../engine/Precompute.js';
import OrderFlowEngine from '../engine/OrderFlowEngine.js';
import ModelRouter from '../models/ModelRouter.js';

const args = process.argv.slice(2);
const SYMBOL = args.find((a, i) => args[i - 1] === '--symbol') || 'SOL/USDT:USDT';
const START = args.find((a, i) => args[i - 1] === '--from') || '2022-01-01';
const END = args.find((a, i) => args[i - 1] === '--to') || '2026-03-31';

const BALANCE = 10000;
let balance = BALANCE;
let position = null;
const trades = [];
const equityCurve = [{ timestamp: 0, equity: BALANCE, balance: BALANCE }];
let peak = BALANCE;
let maxDD = 0, maxDDPct = 0;
let lastSignalTime = 0;
let dailyPnL = 0, dailyTradeCount = 0, lastResetDay = null;

const modelRouter = new ModelRouter();
const orderFlowEngine = new OrderFlowEngine();

async function main() {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║   🔬 A/B BACKTEST — NO PORTFOLIO RISK, NO EXHAUSTION ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);
  console.log(`  Symbol: ${SYMBOL} | ${START} → ${END}\n`);

  const exchange = new ccxt.binance({ enableRateLimit: true });

  console.log('  Fetching data...');
  const candles15m = await fetchCandles(exchange, SYMBOL, '15m');
  const candles5m = await fetchCandles(exchange, SYMBOL, '5m');
  const candles1h = await fetchCandles(exchange, SYMBOL, '1h');
  console.log(`  15m=${candles15m.length} | 5m=${candles5m.length} | 1h=${candles1h.length}`);

  console.log('  Precomputing...');
  const indicators1h = {
    ema9: computeEMA(candles1h, 9),
    ema21: computeEMA(candles1h, 21),
    ema50: computeEMA(candles1h, 50),
    atr: computeATR(candles1h, config.regime.atrPeriod),
    adx: computeADX(candles1h, config.regime.adxPeriod),
    bollinger: computeBollinger(candles1h, 20, 2),
    volumeMetrics: computeVolumeMetrics(candles1h, 20),
  };
  const indicators15m = { delta: computeDelta(candles15m) };
  const regimes = extractRegimes(candles1h, indicators1h);
  const fvgSignals = extractFVGs(candles1h);
  const obSignals = extractOrderBlocks(candles1h);
  const sweepSignals = extractLiquiditySweeps(candles1h);
  const oteSignals = extractOTEs(candles1h);

  orderFlowEngine.setPrecomputed(indicators15m.delta.delta, indicators15m.delta.deltaPercent);

  const profile = getProfile(SYMBOL);

  // 15m→1h mapping
  const m15toH1 = new Array(candles15m.length);
  let hCursor = 0;
  for (let i = 0; i < candles15m.length; i++) {
    while (hCursor < candles1h.length - 1 && candles1h[hCursor + 1].timestamp <= candles15m[i].timestamp) hCursor++;
    m15toH1[i] = hCursor;
  }

  // Track what the original system would have done
  let originalBlocked = 0, originalAllowed = 0;

  console.log('  Running backtest (filters DISABLED)...\n');

  for (let i = 50; i < candles15m.length; i++) {
    const candle = candles15m[i];
    const ts = candle.timestamp;
    const h1Idx = m15toH1[i];
    const day = new Date(ts).toDateString();
    if (day !== lastResetDay) { dailyPnL = 0; dailyTradeCount = 0; lastResetDay = day; }

    // Check exits
    if (position) checkExit(candle, ts);

    if (!position && h1Idx >= 50) {
      const regimeData = regimes[h1Idx];
      if (!regimeData) continue;
      const regime = regimeData.regime;

      // Killzone (keep — this is a real filter)
      const kz = checkKillzone(ts);
      if (!kz.allowed) continue;

      // Session gate (keep)
      if (profile.allowedSessions && !profile.allowedSessions.includes(kz.session)) continue;

      // Weekend (keep)
      const dow = new Date(ts).getUTCDay();
      if (dow === 0 || dow === 6) continue;

      // *** REGIME FILTER: RELAXED — only block TRENDING_DOWN + LOW_VOL ***
      // The original blocks RANGING too for some assets. We keep only the globally bad regimes.
      if (regime === 'TRENDING_DOWN' || regime === 'LOW_VOL') continue;

      // EMA alignment (keep)
      const price = candles1h[h1Idx].close;
      const ema21 = indicators1h.ema21[h1Idx];
      const ema50 = indicators1h.ema50[h1Idx];
      const bullish = price > ema21 && price > ema50;
      const bearish = price < ema21 && price < ema50;
      if (!bullish && !bearish) continue;

      // Cooldown (keep but halved)
      const cooldown = (profile.daytrade.signalCooldown || config.strategy.signalCooldown) / 2;
      if (lastSignalTime && ts - lastSignalTime < cooldown) continue;

      // Build context
      const ctx = {
        symbol: SYMBOL, price, timestamp: ts, m15Idx: i, h1Idx,
        regime, regimeData, profile, killzone: kz,
        bullish, bearish,
        ema9: indicators1h.ema9[h1Idx], ema21, ema50,
        atr: indicators1h.atr[h1Idx],
        adx: indicators1h.adx[h1Idx],
        bb: { upper: indicators1h.bollinger.upper[h1Idx], middle: indicators1h.bollinger.middle[h1Idx], lower: indicators1h.bollinger.lower[h1Idx] },
        volumeRatio: indicators1h.volumeMetrics.volumeRatio[h1Idx],
        delta: indicators15m.delta.delta[i],
        deltaPercent: indicators15m.delta.deltaPercent[i],
        _allDeltas: indicators15m.delta.delta,
        _allPrices: candles15m,
        fvgSignals: fvgSignals[h1Idx],
        obSignals: obSignals[h1Idx],
        sweepSignals: sweepSignals[h1Idx],
        oteSignals: oteSignals[h1Idx],
        candles1h, candles15m, indicators1h,
        index1h: h1Idx, index15m: i,
        deltaArr: indicators15m.delta.delta,
      };

      const modelCtx = {
        ...ctx,
        index1h: h1Idx,
        index15m: i,
        regimeResult: regimeData,
      };

      // *** NO EXHAUSTION CHECK ***
      // *** NO PORTFOLIO RISK CHECK ***

      let signal = modelRouter.evaluate(SYMBOL, modelCtx);

      // Also try legacy
      if (!signal) {
        signal = evaluateLegacy(ctx);
        if (signal) signal.source = 'legacy';
      }

      if (signal) {
        openPosition(signal, candle.close, ts);
        lastSignalTime = ts;
      }
    }

    // Track equity
    const unrealized = position ? calcUnrealized(candle.close) : 0;
    const equity = balance + unrealized;
    equityCurve.push({ timestamp: ts, equity, balance });
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDDPct) { maxDDPct = dd; maxDD = peak - equity; }
  }

  if (position) {
    const last = candles15m[candles15m.length - 1];
    closePosition(last.close, last.timestamp, 'backtest_end');
  }

  printReport();
}

function evaluateLegacy(ctx) {
  const ictWeight = ctx.profile.daytrade.ictWeight;
  const fpWeight = ctx.profile.daytrade.footprintWeight;

  const allScored = [];
  const ictSignals = [];
  if (ctx.fvgSignals) ictSignals.push(...ctx.fvgSignals);
  if (ctx.obSignals) ictSignals.push(...ctx.obSignals);
  if (ctx.sweepSignals) ictSignals.push(...ctx.sweepSignals);
  if (ctx.oteSignals) ictSignals.push(...ctx.oteSignals);

  for (const sig of ictSignals) {
    if (sig.type === 'FVG') continue;
    if (sig.type === 'ORDER_BLOCK') { allScored.push({ ...sig, combinedScore: sig.confidence * 0.5, source: 'ict' }); continue; }
    allScored.push({ ...sig, combinedScore: sig.confidence, source: 'ict' });
  }

  if (ctx.delta !== undefined) {
    const divSig = checkDeltaDivergence(ctx);
    if (divSig) {
      let score = divSig.confidence;
      if (divSig.type === 'DELTA_DIVERGENCE') score *= 1.5;
      allScored.push({ ...divSig, combinedScore: score, source: 'footprint' });
    }
  }

  if (allScored.length === 0) return null;
  allScored.sort((a, b) => b.combinedScore - a.combinedScore);
  const best = allScored[0];

  if (best.action === 'buy' && !ctx.bullish) return null;
  if (best.action === 'sell' && !ctx.bearish) return null;

  if (best.source === 'ict' && (ctx.regime === 'TRENDING_UP' || ctx.regime === 'TRENDING_DOWN')) best.combinedScore *= 1.3;
  if (best.type === 'DELTA_DIVERGENCE' && ctx.regime === 'ABSORPTION') best.combinedScore *= 1.3;
  if (best.type === 'STACKED_IMBALANCE' && (ctx.regime === 'TRENDING_UP' || ctx.regime === 'TRENDING_DOWN')) best.combinedScore *= 1.4;

  const sw = ctx.profile.sessionWeights[ctx.killzone.session] || 1.0;
  best.combinedScore *= sw;

  const regimeMult = { VOL_EXPANSION: 0.90, TRENDING_UP: 1.05, RANGING: 0.95, TRENDING_DOWN: 0.90, LOW_VOL: 1.0 };
  best.combinedScore *= (regimeMult[ctx.regime] ?? 1.0);

  const confluenceSignals = allScored.filter(s => s.action === best.action && s.source !== best.source);
  const hasConfluence = confluenceSignals.length > 0;
  const minConf = ctx.profile.daytrade.minConfluenceScore ?? config.strategy.minConfluenceScore;
  const minSolo = ctx.profile.daytrade.minSoloScore ?? config.strategy.minSoloScore;

  if (hasConfluence) {
    best.combinedScore += config.strategy.confluenceBonus;
    if (best.combinedScore >= minConf) return buildSignal(ctx, best);
  }
  if (best.type === 'ORDER_BLOCK' && !hasConfluence) return null;
  if (best.combinedScore >= minSolo) return buildSignal(ctx, best);
  return null;
}

function buildSignal(ctx, best) {
  const atr = ctx.atr;
  const slMult = (ctx.profile.riskOverrides?.slMultiplier ?? config.risk[ctx.regime]?.slMultiplier ?? 0.9) * ctx.profile.slTightness;
  const tpMult = config.risk[ctx.regime]?.tpMultiplier || 2.5;
  const sl = best.action === 'buy' ? ctx.price - atr * slMult : ctx.price + atr * slMult;
  const tp = best.action === 'buy' ? ctx.price + atr * tpMult : ctx.price - atr * tpMult;
  return { ...best, mode: 'DAYTRADE', regime: ctx.regime, price: ctx.price, stopLoss: sl, takeProfit: tp, atr, assetProfile: ctx.profile.name, profile: ctx.profile, session: ctx.killzone.session };
}

function checkDeltaDivergence(ctx) {
  const lookback = 10;
  const deltas = [], prices = [];
  for (let j = Math.max(0, ctx.m15Idx - lookback + 1); j <= ctx.m15Idx; j++) {
    deltas.push(ctx._allDeltas?.[j] ?? 0);
    prices.push(ctx._allPrices?.[j]?.close ?? ctx.price);
  }
  if (deltas.length < 5) return null;
  const priceUp = prices[prices.length - 1] > prices[0];
  const deltaUp = deltas[deltas.length - 1] > deltas[0];
  if (priceUp && !deltaUp) return { type: 'DELTA_DIVERGENCE', direction: 'bearish', action: 'sell', confidence: Math.min(0.5 + divergenceStrength(deltas) * 0.3, 0.9), reason: 'Bearish delta divergence' };
  if (!priceUp && deltaUp && ctx.bearish) return { type: 'DELTA_DIVERGENCE', direction: 'bullish', action: 'buy', confidence: Math.min(0.5 + divergenceStrength(deltas) * 0.3, 0.9), reason: 'Bullish delta divergence' };
  if (Math.abs(ctx.deltaPercent) > 60) return { type: 'STACKED_IMBALANCE', direction: ctx.deltaPercent > 0 ? 'bullish' : 'bearish', action: ctx.deltaPercent > 0 ? 'buy' : 'sell', confidence: 0.5, reason: `Extreme delta: ${ctx.deltaPercent.toFixed(1)}%` };
  return null;
}

function divergenceStrength(d) { const m = Math.max(...d.map(Math.abs)); if (m === 0) return 0; return Math.min(Math.abs(d[d.length - 1]) / (d.reduce((a, b) => a + Math.abs(b), 0) / d.length), 2.0); }

function openPosition(signal, price, ts) {
  const riskParams = config.risk[signal.regime] || config.risk.RANGING;
  const slDist = Math.abs(price - signal.stopLoss);
  if (slDist === 0) return;
  const riskPct = riskParams.riskPercent * (signal.profile?.riskMultiplier ?? 1.0);
  const riskAmt = balance * (riskPct / 100);
  const size = riskAmt / slDist;
  const slippage = price * config.engine.slippage * (signal.action === 'buy' ? 1 : -1);
  const fillPrice = price + slippage;
  const fee = size * fillPrice * config.engine.makerFee;
  const margin = (size * fillPrice) / 10;
  if (margin + fee > balance) return;
  if (Math.abs(dailyPnL) / BALANCE >= config.engine.maxDailyLoss) return;
  if (dailyTradeCount >= config.engine.maxDailyTrades) return;
  dailyTradeCount++;
  balance -= fee;
  const ro = signal.profile?.riskOverrides;
  position = {
    symbol: SYMBOL, side: signal.action === 'buy' ? 'long' : 'short',
    size, entryPrice: fillPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
    regime: signal.regime, signalType: signal.type, mode: signal.mode || 'DAYTRADE',
    reason: signal.reason || signal.type, entryTime: ts, fee,
    atr: signal.atr, highestPrice: fillPrice, lowestPrice: fillPrice,
    trailingActive: false, partialTPDone: false, originalSize: size,
    assetProfile: signal.assetProfile || 'unknown', profile: signal.profile || null,
    source: signal.source || 'unknown',
  };
}

function checkExit(candle, ts) {
  const pos = position;
  const price = candle.close;
  const high = candle.high, low = candle.low;
  if (pos.side === 'long') { if (high > pos.highestPrice) pos.highestPrice = high; }
  else { if (low < pos.lowestPrice) pos.lowestPrice = low; }

  // Partial TP
  if (config.engine.partialTP?.enabled && !pos.partialTPDone) {
    const tp1Dist = pos.atr * config.engine.partialTP.tpMultiplier;
    let hit = false;
    if (pos.side === 'long' && high >= pos.entryPrice + tp1Dist) hit = true;
    if (pos.side === 'short' && low <= pos.entryPrice - tp1Dist) hit = true;
    if (hit) {
      const partialSize = pos.size * config.engine.partialTP.closePercent;
      const tp1Price = pos.side === 'long' ? pos.entryPrice + tp1Dist : pos.entryPrice - tp1Dist;
      const fee = partialSize * tp1Price * config.engine.takerFee;
      const diff = pos.side === 'long' ? tp1Price - pos.entryPrice : pos.entryPrice - tp1Price;
      const pnl = diff * partialSize - (pos.fee * config.engine.partialTP.closePercent) - fee;
      balance += pnl; dailyPnL += pnl;
      trades.push({ symbol: pos.symbol, side: pos.side, size: partialSize, entryPrice: pos.entryPrice, exitPrice: tp1Price, entryTime: pos.entryTime, exitTime: ts, closeReason: 'partial_tp', regime: pos.regime, signalType: pos.signalType, mode: pos.mode, pnl, pnlPercent: pnl / (partialSize * pos.entryPrice) * 100, totalFees: pos.fee * config.engine.partialTP.closePercent + fee, duration: ts - pos.entryTime, durationMin: Math.round((ts - pos.entryTime) / 60000), assetProfile: pos.assetProfile, source: pos.source, balance });
      pos.size *= (1 - config.engine.partialTP.closePercent);
      pos.fee *= (1 - config.engine.partialTP.closePercent);
      pos.partialTPDone = true;
    }
  }

  // Trailing stop
  if (config.engine.trailingStop.enabled) {
    const ro = pos.profile?.riskOverrides;
    const actATR = ro?.trailingStop?.activationATR ?? config.engine.trailingStop.activationATR;
    const trailATR = ro?.trailingStop?.trailATR ?? config.engine.trailingStop.trailATR;
    const actDist = pos.atr * actATR;
    const trailDist = pos.atr * trailATR;
    if (!pos.trailingActive) {
      if (pos.side === 'long' && high >= pos.entryPrice + actDist) pos.trailingActive = true;
      else if (pos.side === 'short' && low <= pos.entryPrice - actDist) pos.trailingActive = true;
    }
    if (pos.trailingActive) {
      if (pos.side === 'long') { const nsl = pos.highestPrice - trailDist; if (nsl > pos.stopLoss) pos.stopLoss = nsl; }
      else { const nsl = pos.lowestPrice + trailDist; if (nsl < pos.stopLoss) pos.stopLoss = nsl; }
    }
  }

  // Emergency SL (keep — circuit breaker)
  const emATR = pos.profile?.riskOverrides?.emergencyATR ?? 12.0;
  const emDist = pos.atr * emATR;
  const emSL = pos.side === 'long' ? pos.entryPrice - emDist : pos.entryPrice + emDist;
  if (pos.side === 'long' && low <= emSL) { closePosition(emSL, ts, 'emergency_stop'); return; }
  if (pos.side === 'short' && high >= emSL) { closePosition(emSL, ts, 'emergency_stop'); return; }

  // TP
  if (pos.side === 'long' && high >= pos.takeProfit) { closePosition(pos.takeProfit, ts, 'take_profit'); return; }
  if (pos.side === 'short' && low <= pos.takeProfit) { closePosition(pos.takeProfit, ts, 'take_profit'); return; }
}

function closePosition(price, ts, reason) {
  const pos = position;
  const slippage = price * config.engine.slippage * (pos.side === 'long' ? -1 : 1);
  const fillPrice = price + slippage;
  const fee = pos.size * fillPrice * config.engine.takerFee;
  const diff = pos.side === 'long' ? fillPrice - pos.entryPrice : pos.entryPrice - fillPrice;
  const pnl = diff * pos.size - pos.fee - fee;
  balance += pnl; dailyPnL += pnl;
  trades.push({ symbol: pos.symbol, side: pos.side, size: pos.size, entryPrice: pos.entryPrice, exitPrice: fillPrice, entryTime: pos.entryTime, exitTime: ts, closeReason: reason, regime: pos.regime, signalType: pos.signalType, mode: pos.mode, pnl, pnlPercent: pnl / (pos.size * pos.entryPrice) * 100, totalFees: pos.fee + fee, duration: ts - pos.entryTime, durationMin: Math.round((ts - pos.entryTime) / 60000), assetProfile: pos.assetProfile, source: pos.source, balance });
  position = null;
}

function calcUnrealized(price) {
  if (!position) return 0;
  return position.side === 'long' ? (price - position.entryPrice) * position.size : (position.entryPrice - price) * position.size;
}

function checkKillzone(ts) {
  const h = new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60;
  const kz = config.killzones;
  if (kz.deadzones.some(dz => h >= dz.start && h < dz.end)) return { allowed: false, session: 'dead' };
  const inL = h >= kz.london.start && h < kz.london.end;
  const inN = h >= kz.ny.start && h < kz.ny.end;
  const inO = h >= kz.overlap.start && h < kz.overlap.end;
  const inA = (h >= kz.asia.start || h < kz.asia.end);
  const s = inO ? 'overlap' : inN ? 'ny' : inL ? 'london' : inA ? 'asia' : 'off';
  if (s === 'off') return { allowed: false, session: s };
  return { allowed: true, session: s };
}

async function fetchCandles(exchange, symbol, tf) {
  const all = []; let since = new Date(START).getTime(); const end = new Date(END).getTime();
  while (true) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, tf, since, 1000);
      if (!ohlcv.length) break;
      all.push(...ohlcv.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })));
      const last = ohlcv[ohlcv.length - 1][0];
      if (last >= end || ohlcv.length < 1000) break;
      since = last + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) { console.error(`  Fetch error: ${e.message}`); break; }
  }
  return all.filter(c => c.timestamp <= end);
}

function printReport() {
  const wins = trades.filter(t => t.pnl > 0 && t.closeReason !== 'partial_tp');
  const losses = trades.filter(t => t.pnl <= 0);
  const allFullTrades = trades.filter(t => t.closeReason !== 'partial_tp'); // non-partial for stats
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const totalFees = trades.reduce((s, t) => s + t.totalFees, 0);
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  // Unique positions (each position generates 1-2 trades: partial + final)
  const uniquePositions = [];
  const seenEntryTimes = new Set();
  for (const t of trades) {
    const key = `${t.entryTime}-${t.closeReason !== 'partial_tp'}`;
    if (t.closeReason !== 'partial_tp') uniquePositions.push(t);
  }
  const posWins = uniquePositions.filter(t => t.pnl > 0);
  const posLosses = uniquePositions.filter(t => t.pnl <= 0);
  const wr = uniquePositions.length > 0 ? (posWins.length / uniquePositions.length * 100) : 0;

  // By year
  const byYear = {};
  for (const t of uniquePositions) {
    const yr = new Date(t.entryTime).getUTCFullYear();
    if (!byYear[yr]) byYear[yr] = { trades: 0, wins: 0, pnl: 0 };
    byYear[yr].trades++;
    if (t.pnl > 0) byYear[yr].wins++;
    byYear[yr].pnl += t.pnl;
  }

  // By regime
  const byRegime = {};
  for (const t of uniquePositions) {
    if (!byRegime[t.regime]) byRegime[t.regime] = { trades: 0, wins: 0, pnl: 0 };
    byRegime[t.regime].trades++;
    if (t.pnl > 0) byRegime[t.regime].wins++;
    byRegime[t.regime].pnl += t.pnl;
  }

  // By exit
  const byExit = {};
  for (const t of uniquePositions) {
    if (!byExit[t.closeReason]) byExit[t.closeReason] = { trades: 0, wins: 0, pnl: 0 };
    byExit[t.closeReason].trades++;
    if (t.pnl > 0) byExit[t.closeReason].wins++;
    byExit[t.closeReason].pnl += t.pnl;
  }

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   📊 A/B BACKTEST REPORT — NO FILTERS               ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`── Performance ───────────────────────────────────`);
  console.log(`  Starting: $${BALANCE} → Final: $${balance.toFixed(2)}`);
  console.log(`  PnL: $${totalPnL.toFixed(2)} (${((balance - BALANCE) / BALANCE * 100).toFixed(1)}%)`);
  console.log(`  Fees: $${totalFees.toFixed(2)}`);
  console.log(`\n── Trade Stats ───────────────────────────────────`);
  console.log(`  Positions: ${uniquePositions.length} (${posWins.length}W / ${posLosses.length}L)`);
  console.log(`  Win Rate: ${wr.toFixed(1)}%`);
  console.log(`  PF: ${pf === Infinity ? '∞' : pf.toFixed(2)}`);
  console.log(`  Max DD: $${maxDD.toFixed(2)} (${(maxDDPct * 100).toFixed(2)}%)`);
  console.log(`\n── By Year ───────────────────────────────────────`);
  for (const [yr, d] of Object.entries(byYear).sort()) {
    const ywr = d.trades > 0 ? (d.wins / d.trades * 100).toFixed(0) : '0';
    console.log(`  ${yr}: ${d.trades} trades | ${ywr}% WR | PnL: $${d.pnl.toFixed(2)}`);
  }
  console.log(`\n── By Regime ─────────────────────────────────────`);
  for (const [rg, d] of Object.entries(byRegime).sort((a, b) => b[1].pnl - a[1].pnl)) {
    const rwr = d.trades > 0 ? (d.wins / d.trades * 100).toFixed(0) : '0';
    console.log(`  ${rg.padEnd(16)} ${d.trades} trades | ${rwr}% WR | PnL: $${d.pnl.toFixed(2)}`);
  }
  console.log(`\n── By Exit ───────────────────────────────────────`);
  for (const [ex, d] of Object.entries(byExit).sort((a, b) => b[1].pnl - a[1].pnl)) {
    const ewr = d.trades > 0 ? (d.wins / d.trades * 100).toFixed(0) : '0';
    console.log(`  ${ex.padEnd(16)} ${d.trades} trades | ${ewr}% WR | PnL: $${d.pnl.toFixed(2)}`);
  }
  console.log(`\n── Last 15 Trades ────────────────────────────────`);
  for (const t of trades.slice(-15)) {
    const emoji = t.pnl >= 0 ? '✅' : '❌';
    const date = new Date(t.entryTime).toISOString().slice(0, 10);
    console.log(`  ${emoji} ${date} ${(t.mode || '').padEnd(10)} ${t.side.toUpperCase().padEnd(5)} PnL: $${t.pnl.toFixed(2).padStart(8)} ${t.closeReason} ${t.signalType || ''}`);
  }
  console.log('');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
