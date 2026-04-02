// ═══════════════════════════════════════════════════════════════════
// walkforward.js — Walk-Forward Analysis Engine
// ═══════════════════════════════════════════════════════════════════
//
// Rolling train/OOS windows to validate edge robustness.
//
// Two modes:
//   1. FIXED parameters (current config) — test if edge holds OOS
//   2. OPTIMIZED per window — find best regime blocking per period
//
// Usage:
//   node engine/walkforward.js --symbol ETH/USDT:USDT
//   node engine/walkforward.js --symbol ETH/USDT:USDT --optimize
//   node engine/walkforward.js --all

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
} from './Precompute.js';

// ── Window Generator ──────────────────────────────────────────────
function generateWindows(startDate, endDate, trainMonths = 12, oosMonths = 3, stepMonths = 3) {
  const windows = [];
  let cursor = new Date(startDate);
  const end = new Date(endDate);

  while (true) {
    const trainStart = new Date(cursor);
    const trainEnd = new Date(cursor);
    trainEnd.setMonth(trainEnd.getMonth() + trainMonths);

    const oosStart = new Date(trainEnd);
    const oosEnd = new Date(trainEnd);
    oosEnd.setMonth(oosEnd.getMonth() + oosMonths);

    if (oosEnd > end) break;

    windows.push({
      trainStart: trainStart.toISOString().slice(0, 10),
      trainEnd: trainEnd.toISOString().slice(0, 10),
      oosStart: oosStart.toISOString().slice(0, 10),
      oosEnd: oosEnd.toISOString().slice(0, 10),
    });

    cursor.setMonth(cursor.getMonth() + stepMonths);
  }

  return windows;
}

// ── Regime Blocking Combinations ───────────────────────────────────
const BLOCKING_COMBOS = [
  { label: 'none',       blocked: [] },
  { label: 'trend_down', blocked: ['TRENDING_DOWN'] },
  { label: 'trend+low',  blocked: ['TRENDING_DOWN', 'LOW_VOL'] },
  { label: 'trend+rang', blocked: ['TRENDING_DOWN', 'RANGING'] },
  { label: 'aggressive', blocked: ['TRENDING_DOWN', 'LOW_VOL', 'RANGING'] },
  { label: 'volatile_only', blocked: ['TRENDING_DOWN', 'LOW_VOL', 'RANGING', 'TRENDING_UP'] },
];

// ═══════════════════════════════════════════════════════════════════
// Mini Backtest — runs on precomputed data with date filtering
// ═══════════════════════════════════════════════════════════════════
class WindowBacktester {
  constructor(symbol, profile, options = {}) {
    this.symbol = symbol;
    this.profile = profile;
    this.startingBalance = options.startingBalance || config.engine.startingBalance;
    this.blockedRegimes = options.blockedRegimes || profile.blockedRegimes || [];
    this.startDate = options.startDate ? new Date(options.startDate).getTime() : null;
    this.endDate = options.endDate ? new Date(options.endDate).getTime() : null;
    this.verbose = options.verbose || false;

    this.balance = this.startingBalance;
    this.trades = [];
    this.position = null;
    this.peak = this.startingBalance;
    this.maxDrawdownPercent = 0;
    this.dailyPnL = 0;
    this.lastResetDay = null;
    this.lastSignalTime = null;
    this.regimeTimeTracker = {};
    this.totalCandlesAnalyzed = 0;
  }

  run(candles15m, candles1h, m15toH1, indicators1h, indicators15m, regimes, fvgSignals, obSignals, sweepSignals, oteSignals) {
    const startTs = this.startDate || 0;
    const endTs = this.endDate || Infinity;
    let signalCount = 0;

    for (let i = 50; i < candles15m.length; i++) {
      const candle15m = candles15m[i];
      const timestamp = candle15m.timestamp;

      // Date filter
      if (timestamp < startTs || timestamp > endTs) {
        // Still update position tracking if we're in a position
        if (this.position && timestamp >= startTs) {
          this._checkExit(candle15m, timestamp);
        }
        continue;
      }

      const h1Idx = m15toH1[i];

      // Track regime distribution
      if (h1Idx >= 50 && regimes[h1Idx]) {
        const r = regimes[h1Idx].regime;
        this.regimeTimeTracker[r] = (this.regimeTimeTracker[r] || 0) + 1;
        this.totalCandlesAnalyzed++;
      }

      // Daily reset
      const day = new Date(timestamp).toDateString();
      if (day !== this.lastResetDay) {
        this.dailyPnL = 0;
        this.lastResetDay = day;
      }

      // Check exits
      if (this.position) {
        this._checkExit(candle15m, timestamp);
      }

      // Generate signal
      if (!this.position && h1Idx >= 50) {
        const ctx = this._buildContext(i, h1Idx, candles15m, candles1h, indicators1h, indicators15m,
          regimes, fvgSignals, obSignals, sweepSignals, oteSignals, timestamp);
        if (ctx) {
          const signal = this._evaluateSignal(ctx);
          if (signal) {
            this._openPosition(signal, candle15m.close, timestamp);
            signalCount++;
          }
        }
      }
    }

    // Close remaining
    if (this.position) {
      const last = candles15m[candles15m.length - 1];
      this._closePosition(last.close, last.timestamp, 'backtest_end');
    }

    return this._computeStats();
  }

  _buildContext(m15Idx, h1Idx, candles15m, candles1h, indicators1h, indicators15m,
    regimes, fvgSignals, obSignals, sweepSignals, oteSignals, timestamp) {

    const regimeData = regimes[h1Idx];
    if (!regimeData) return null;

    const killzone = this._checkKillzone(timestamp);
    if (!killzone.allowed) return null;

    const day = new Date(timestamp).getUTCDay();
    if (day === 0 || day === 6) return null;

    const regime = regimeData.regime;
    if (regime === 'LOW_VOL') return null;
    if (regime === 'TRENDING_DOWN') return null;
    if (this.blockedRegimes.includes(regime)) return null;

    const price = candles1h[h1Idx].close;
    const ema21 = indicators1h.ema21[h1Idx];
    const ema50 = indicators1h.ema50[h1Idx];
    const bullish = price > ema21 && price > ema50;
    const bearish = price < ema21 && price < ema50;
    if (!bullish && !bearish) return null;

    const lastTime = this.lastSignalTime;
    if (lastTime && timestamp - lastTime < config.strategy.signalCooldown) return null;

    return {
      symbol: this.symbol, price, timestamp, m15Idx, h1Idx,
      regime, regimeData, profile: this.profile, killzone,
      bullish, bearish,
      ema9: indicators1h.ema9[h1Idx], ema21, ema50,
      atr: indicators1h.atr[h1Idx],
      adx: indicators1h.adx[h1Idx],
      bb: {
        upper: indicators1h.bollinger.upper[h1Idx],
        middle: indicators1h.bollinger.middle[h1Idx],
        lower: indicators1h.bollinger.lower[h1Idx],
      },
      volumeRatio: indicators1h.volumeMetrics.volumeRatio[h1Idx],
      delta: indicators15m.delta.delta[m15Idx],
      deltaPercent: indicators15m.delta.deltaPercent[m15Idx],
      fvgSignals: fvgSignals[h1Idx],
      obSignals: obSignals[h1Idx],
      sweepSignals: sweepSignals[h1Idx],
      oteSignals: oteSignals[h1Idx],
    };
  }

  _evaluateSignal(ctx) {
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
      if (sig.type === 'ORDER_BLOCK') {
        const normalized = (sig.confidence / ictWeight) * 0.5;
        allScored.push({ ...sig, combinedScore: normalized, source: 'ict' });
        continue;
      }
      const normalized = sig.confidence / ictWeight;
      allScored.push({ ...sig, combinedScore: normalized, source: 'ict' });
    }

    if (ctx.delta !== undefined) {
      const divSignal = this._checkDeltaDivergence(ctx);
      if (divSignal) {
        let score = divSignal.confidence / fpWeight;
        if (divSignal.type === 'DELTA_DIVERGENCE') score *= 1.5;
        allScored.push({ ...divSignal, combinedScore: score, source: 'footprint' });
      }
    }

    if (allScored.length === 0) return null;

    allScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = allScored[0];

    if (best.action === 'buy' && !ctx.bullish) return null;
    if (best.action === 'sell' && !ctx.bearish) return null;

    if (best.source === 'ict' && (ctx.regime === 'TRENDING_UP' || ctx.regime === 'TRENDING_DOWN')) {
      best.combinedScore *= 1.3;
    }
    if (best.type === 'DELTA_DIVERGENCE' && ctx.regime === 'ABSORPTION') best.combinedScore *= 1.3;
    if (best.type === 'STACKED_IMBALANCE' && (ctx.regime === 'TRENDING_UP' || ctx.regime === 'TRENDING_DOWN')) {
      best.combinedScore *= 1.4;
    }

    const sessionWeight = ctx.profile.sessionWeights[ctx.killzone.session] || 1.0;
    best.combinedScore *= sessionWeight;

    const confluenceSignals = allScored.filter(s => s.action === best.action && s.source !== best.source);
    const hasConfluence = confluenceSignals.length > 0;

    const minConfluenceScore = ctx.profile.daytrade.minConfluenceScore ?? config.strategy.minConfluenceScore;
    const minSoloScore = ctx.profile.daytrade.minSoloScore ?? config.strategy.minSoloScore;

    if (hasConfluence) {
      best.combinedScore += config.strategy.confluenceBonus;
      best.confluence = true;
      best.reason = `${best.reason} (+ ${confluenceSignals[0].type} confluence)`;
      if (best.combinedScore >= minConfluenceScore) return this._buildTradeSignal(ctx, best);
    }

    if (best.type === 'ORDER_BLOCK' && !hasConfluence) return null;
    if (best.combinedScore >= minSoloScore) return this._buildTradeSignal(ctx, best);
    return null;
  }

  _buildTradeSignal(ctx, best) {
    const atr = ctx.atr;
    const slMult = (ctx.profile.riskOverrides?.slMultiplier ?? config.risk[ctx.regime]?.slMultiplier ?? 0.9) * ctx.profile.slTightness;
    const tpMult = config.risk[ctx.regime]?.tpMultiplier || 2.5;

    const sl = best.action === 'buy' ? ctx.price - atr * slMult : ctx.price + atr * slMult;
    const tp = best.action === 'buy' ? ctx.price + atr * tpMult : ctx.price - atr * tpMult;

    this.lastSignalTime = ctx.timestamp;

    return {
      ...best, mode: 'DAYTRADE', regime: ctx.regime,
      regimeConfidence: ctx.regimeData.confidence,
      price: ctx.price, stopLoss: sl, takeProfit: tp, atr,
      isWeekend: false, assetProfile: ctx.profile.name, profile: ctx.profile,
      session: ctx.killzone.session,
    };
  }

  _checkDeltaDivergence(ctx) {
    const priceRising = ctx.bullish;
    const deltaNegative = ctx.delta < 0;
    if (priceRising && deltaNegative) {
      return { type: 'DELTA_DIVERGENCE', direction: 'bearish', action: 'sell', confidence: 0.55,
        reason: 'Bearish delta divergence' };
    }
    if (!priceRising && !deltaNegative && ctx.bearish) {
      return { type: 'DELTA_DIVERGENCE', direction: 'bullish', action: 'buy', confidence: 0.55,
        reason: 'Bullish delta divergence' };
    }
    if (Math.abs(ctx.deltaPercent) > 60) {
      return { type: 'STACKED_IMBALANCE', direction: ctx.deltaPercent > 0 ? 'bullish' : 'bearish',
        action: ctx.deltaPercent > 0 ? 'buy' : 'sell', confidence: 0.5,
        reason: `Extreme delta: ${ctx.deltaPercent.toFixed(1)}%` };
    }
    return null;
  }

  _openPosition(signal, price, timestamp) {
    const riskParams = config.risk[signal.regime] || config.risk.RANGING;
    const slDistance = Math.abs(price - signal.stopLoss);
    if (slDistance === 0) return;

    const riskPercent = riskParams.riskPercent;
    const riskAmount = this.balance * (riskPercent / 100);
    const size = riskAmount / slDistance;
    const fee = size * price * config.engine.takerFee;
    const margin = (size * price) / 10;

    if (margin + fee > this.balance) return;
    if (Math.abs(this.dailyPnL) / this.startingBalance >= config.engine.maxDailyLoss) return;

    const slippage = price * config.engine.slippage * (signal.action === 'buy' ? 1 : -1);
    const fillPrice = price + slippage;

    this.position = {
      symbol: this.symbol, side: signal.action === 'buy' ? 'long' : 'short',
      size, entryPrice: fillPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
      regime: signal.regime, reason: signal.reason || signal.type, signalType: signal.type,
      mode: 'DAYTRADE', entryTime: timestamp, fee,
      atr: signal.atr || Math.abs(signal.takeProfit - fillPrice) / 2,
      highestPrice: fillPrice, lowestPrice: fillPrice,
      breakevenTriggered: false, trailingActive: false, isWeekend: false,
      entryPattern: null, partialTPDone: false, originalSize: size,
      assetProfile: signal.assetProfile || 'unknown', profile: signal.profile || null,
    };

    this.balance -= fee;
  }

  _checkExit(candle, timestamp) {
    const pos = this.position;
    const price = candle.close;
    const side = pos.side;

    if (side === 'long') { if (candle.high > pos.highestPrice) pos.highestPrice = candle.high; }
    else { if (candle.low < pos.lowestPrice) pos.lowestPrice = candle.low; }

    // Partial TP
    if (config.engine.partialTP?.enabled && !pos.partialTPDone) {
      const tp1Dist = pos.atr * config.engine.partialTP.tpMultiplier;
      const closePercent = config.engine.partialTP.closePercent;
      let hitTP1 = false;
      if (side === 'long' && candle.high >= pos.entryPrice + tp1Dist) hitTP1 = true;
      if (side === 'short' && candle.low <= pos.entryPrice - tp1Dist) hitTP1 = true;

      if (hitTP1) {
        const partialSize = pos.size * closePercent;
        const remainingSize = pos.size * (1 - closePercent);
        const tp1Price = side === 'long' ? pos.entryPrice + tp1Dist : pos.entryPrice - tp1Dist;
        const slippage = tp1Price * config.engine.slippage * (side === 'long' ? -1 : 1);
        const fillPrice = tp1Price + slippage;
        const fee = partialSize * fillPrice * config.engine.takerFee;
        const priceDiff = side === 'long' ? fillPrice - pos.entryPrice : pos.entryPrice - fillPrice;
        const partialPnL = priceDiff * partialSize - (pos.fee * closePercent) - fee;

        this.balance += partialPnL;
        this.dailyPnL += partialPnL;
        this.trades.push({
          symbol: pos.symbol, side: pos.side, size: partialSize,
          entryPrice: pos.entryPrice, exitPrice: fillPrice,
          entryTime: pos.entryTime, exitTime: timestamp,
          closeReason: 'partial_tp', regime: pos.regime, signalType: pos.signalType,
          pnl: partialPnL, pnlPercent: partialPnL / (partialSize * pos.entryPrice) * 100,
          totalFees: pos.fee * closePercent + fee,
          duration: timestamp - pos.entryTime, durationMin: Math.round((timestamp - pos.entryTime) / 60000),
          assetProfile: pos.assetProfile,
        });

        pos.size = remainingSize;
        pos.fee *= (1 - closePercent);
        pos.partialTPDone = true;
      }
    }

    // Trailing stop
    const ro = pos.profile?.riskOverrides;
    if (config.engine.trailingStop.enabled) {
      const activationATR = ro?.trailingStop?.activationATR ?? config.engine.trailingStop.activationATR;
      const trailATR = ro?.trailingStop?.trailATR ?? config.engine.trailingStop.trailATR;
      const activationDist = pos.atr * activationATR;
      const trailDist = pos.atr * trailATR;

      if (!pos.trailingActive) {
        if (side === 'long' && candle.high >= pos.entryPrice + activationDist) pos.trailingActive = true;
        else if (side === 'short' && candle.low <= pos.entryPrice - activationDist) pos.trailingActive = true;
      }
      if (pos.trailingActive) {
        if (side === 'long') { const ns = pos.highestPrice - trailDist; if (ns > pos.stopLoss) pos.stopLoss = ns; }
        else { const ns = pos.lowestPrice + trailDist; if (ns < pos.stopLoss) pos.stopLoss = ns; }
      }
    }

    // Breakeven
    if (config.engine.breakeven?.enabled && !pos.breakevenTriggered) {
      const beATR = ro?.breakeven?.activationATR ?? config.engine.breakeven.activationATR;
      const beDist = pos.atr * beATR;
      const offset = pos.entryPrice * (config.engine.breakeven.offset || 0);
      if (side === 'long' && candle.high >= pos.entryPrice + beDist) {
        pos.stopLoss = pos.entryPrice + offset; pos.breakevenTriggered = true;
      } else if (side === 'short' && candle.low <= pos.entryPrice - beDist) {
        pos.stopLoss = pos.entryPrice - offset; pos.breakevenTriggered = true;
      }
    }

    // SL check
    if (side === 'long' && candle.low <= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      this._closePosition(pos.stopLoss, timestamp, reason); return;
    }
    if (side === 'short' && candle.high >= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      this._closePosition(pos.stopLoss, timestamp, reason); return;
    }

    // TP check
    if (side === 'long' && candle.high >= pos.takeProfit) { this._closePosition(pos.takeProfit, timestamp, 'take_profit'); return; }
    if (side === 'short' && candle.low <= pos.takeProfit) { this._closePosition(pos.takeProfit, timestamp, 'take_profit'); return; }
  }

  _closePosition(price, timestamp, reason) {
    const pos = this.position;
    const slippage = price * config.engine.slippage * (pos.side === 'long' ? -1 : 1);
    const fillPrice = price + slippage;
    const fee = pos.size * fillPrice * config.engine.takerFee;
    const priceDiff = pos.side === 'long' ? fillPrice - pos.entryPrice : pos.entryPrice - fillPrice;
    const pnl = priceDiff * pos.size - pos.fee - fee;

    this.balance += pnl;
    this.dailyPnL += pnl;

    this.trades.push({
      symbol: pos.symbol, side: pos.side, size: pos.size,
      entryPrice: pos.entryPrice, exitPrice: fillPrice,
      entryTime: pos.entryTime, exitTime: timestamp,
      closeReason: reason, regime: pos.regime, signalType: pos.signalType,
      mode: 'DAYTRADE', pnl, pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
      totalFees: pos.fee + fee,
      duration: timestamp - pos.entryTime, durationMin: Math.round((timestamp - pos.entryTime) / 60000),
      assetProfile: pos.assetProfile,
    });

    this.position = null;
  }

  _checkKillzone(timestamp) {
    const now = new Date(timestamp);
    const time = now.getUTCHours() + now.getUTCMinutes() / 60;
    const kz = config.killzones;
    if (kz.deadzones.some(dz => time >= dz.start && time < dz.end)) return { allowed: false, session: 'dead' };
    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = (time >= kz.asia.start || time < kz.asia.end);
    const session = inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session';
    if (session === 'off-session') return { allowed: false, session };
    return { allowed: true, overlap: inOverlap, session };
  }

  _computeStats() {
    const trades = this.trades;
    if (trades.length === 0) {
      return {
        trades: 0, wins: 0, losses: 0, winRate: 0, totalPnL: 0,
        profitFactor: 0, avgWin: 0, avgLoss: 0, maxDrawdown: 0,
        finalBalance: this.balance, fees: 0, byRegime: {}, byExit: {},
        regimeDistribution: {},
      };
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
    const totalFees = trades.reduce((s, t) => s + t.totalFees, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const winRate = trades.length ? wins.length / trades.length : 0;

    // Max DD from equity curve
    let peak = this.startingBalance;
    let maxDD = 0;
    let running = this.startingBalance;
    for (const t of trades) {
      running += t.pnl;
      if (running > peak) peak = running;
      const dd = (peak - running) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    // By regime
    const byRegime = {};
    for (const t of trades) {
      if (!byRegime[t.regime]) byRegime[t.regime] = { trades: 0, wins: 0, pnl: 0 };
      byRegime[t.regime].trades++;
      if (t.pnl > 0) byRegime[t.regime].wins++;
      byRegime[t.regime].pnl += t.pnl;
    }

    // By exit
    const byExit = {};
    for (const t of trades) {
      if (!byExit[t.closeReason]) byExit[t.closeReason] = { trades: 0, wins: 0, pnl: 0 };
      byExit[t.closeReason].trades++;
      if (t.pnl > 0) byExit[t.closeReason].wins++;
      byExit[t.closeReason].pnl += t.pnl;
    }

    // Regime distribution
    const regimeDistribution = {};
    for (const [regime, count] of Object.entries(this.regimeTimeTracker)) {
      regimeDistribution[regime] = this.totalCandlesAnalyzed > 0
        ? ((count / this.totalCandlesAnalyzed) * 100).toFixed(1) : '0';
    }

    return {
      trades: trades.length, wins: wins.length, losses: losses.length,
      winRate: (winRate * 100).toFixed(1),
      totalPnL: totalPnL.toFixed(2),
      profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
      avgWin: avgWin.toFixed(2), avgLoss: avgLoss.toFixed(2),
      maxDrawdown: (maxDD * 100).toFixed(2),
      finalBalance: this.balance.toFixed(2),
      fees: totalFees.toFixed(2),
      largestWin: wins.length ? Math.max(...wins.map(t => t.pnl)).toFixed(2) : '0',
      byRegime, byExit, regimeDistribution,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN — Walk-Forward Analysis
// ═══════════════════════════════════════════════════════════════════

class WalkForwardAnalyzer {
  constructor(options = {}) {
    this.symbols = options.symbols || config.symbols;
    this.exchangeId = options.exchange || config.data.exchange;
    this.trainMonths = options.trainMonths || 12;
    this.oosMonths = options.oosMonths || 3;
    this.stepMonths = options.stepMonths || 3;
    this.optimize = options.optimize || false;
    this.startDate = options.startDate || '2022-01-01';
    this.endDate = options.endDate || '2026-03-31';
  }

  async run() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║   🔬 WALK-FORWARD ANALYSIS ENGINE                          ║');
    console.log('║   Train: {}mo | OOS: {}mo | Step: {}mo                      ║'
      .replace('{}', this.trainMonths).replace('{}', this.oosMonths).replace('{}', this.stepMonths));
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const exchange = new ccxt[this.exchangeId]({ enableRateLimit: true });
    const allResults = {};

    for (const symbol of this.symbols) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  WALK-FORWARD: ${symbol}`);
      console.log(`${'═'.repeat(60)}`);

      const profile = getProfile(symbol);

      try {
        // ── Load data ONCE ──────────────────────────────────────
        console.log('\n  📥 Loading data...');
        const t0 = Date.now();

        const candles15m = await this._fetchCandles(exchange, symbol, '15m');
        const candles1h = await this._fetchCandles(exchange, symbol, '1h');

        console.log(`  ✅ Loaded: 15m=${candles15m.length} | 1h=${candles1h.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

        if (candles15m.length < 100 || candles1h.length < 50) {
          console.log('  ⚠️  Not enough data, skipping');
          continue;
        }

        // ── Precompute ONCE ─────────────────────────────────────
        console.log('  📐 Precomputing indicators...');
        const t1 = Date.now();

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

        console.log(`  🔍 Extracting features...`);
        const regimes = extractRegimes(candles1h, indicators1h);
        const fvgSignals = extractFVGs(candles1h);
        const obSignals = extractOrderBlocks(candles1h);
        const sweepSignals = extractLiquiditySweeps(candles1h);
        const oteSignals = extractOTEs(candles1h);

        console.log(`  ✅ Precompute done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

        // ── Build 15m→1h mapping ────────────────────────────────
        const m15toH1 = new Array(candles15m.length);
        let hCursor = 0;
        for (let i = 0; i < candles15m.length; i++) {
          while (hCursor < candles1h.length - 1 && candles1h[hCursor + 1].timestamp <= candles15m[i].timestamp) {
            hCursor++;
          }
          m15toH1[i] = hCursor;
        }

        // ── Generate windows ────────────────────────────────────
        const dataStart = new Date(candles1h[50].timestamp).toISOString().slice(0, 10);
        const dataEnd = new Date(candles1h[candles1h.length - 1].timestamp).toISOString().slice(0, 10);

        const windows = generateWindows(dataStart, dataEnd, this.trainMonths, this.oosMonths, this.stepMonths);
        console.log(`\n  📅 ${windows.length} walk-forward windows (${dataStart} → ${dataEnd})`);

        if (windows.length === 0) {
          console.log('  ⚠️  Not enough data for any windows');
          continue;
        }

        // ── Run each window ─────────────────────────────────────
        const windowResults = [];

        for (let w = 0; w < windows.length; w++) {
          const win = windows[w];
          console.log(`\n  ── Window ${w + 1}/${windows.length} ─────────────────────`);
          console.log(`     Train: ${win.trainStart} → ${win.trainEnd}`);
          console.log(`     OOS:   ${win.oosStart} → ${win.oosEnd}`);

          let bestCombo = null;
          let bestTrainPF = 0;

          if (this.optimize) {
            // ── TRAINING: Find best regime blocking ─────────────
            for (const combo of BLOCKING_COMBOS) {
              // Merge with profile's existing blocked regimes
              const mergedBlocked = [...new Set([...(profile.blockedRegimes || []), ...combo.blocked])];

              const bt = new WindowBacktester(symbol, profile, {
                blockedRegimes: mergedBlocked,
                startDate: win.trainStart,
                endDate: win.trainEnd,
              });

              const stats = bt.run(candles15m, candles1h, m15toH1, indicators1h, indicators15m,
                regimes, fvgSignals, obSignals, sweepSignals, oteSignals);

              const pf = parseFloat(stats.profitFactor) || 0;
              if (pf > bestTrainPF) {
                bestTrainPF = pf;
                bestCombo = combo;
              }
            }

            console.log(`     Best train blocking: ${bestCombo.label} (PF: ${bestTrainPF.toFixed(2)})`);
          } else {
            bestCombo = { label: 'current', blocked: profile.blockedRegimes || [] };
          }

          // ── OOS TEST ──────────────────────────────────────────
          const mergedBlocked = [...new Set([...(profile.blockedRegimes || []), ...bestCombo.blocked])];

          const oosBt = new WindowBacktester(symbol, profile, {
            blockedRegimes: mergedBlocked,
            startDate: win.oosStart,
            endDate: win.oosEnd,
          });

          const oosStats = oosBt.run(candles15m, candles1h, m15toH1, indicators1h, indicators15m,
            regimes, fvgSignals, obSignals, sweepSignals, oteSignals);

          const oosPnL = parseFloat(oosStats.totalPnL);
          const oosPF = parseFloat(oosStats.profitFactor) || 0;
          const oosWR = parseFloat(oosStats.winRate) || 0;

          console.log(`     OOS: ${oosStats.trades} trades | ${oosStats.winRate}% WR | PF: ${oosStats.profitFactor} | PnL: $${oosStats.totalPnL} | DD: ${oosStats.maxDrawdown}%`);

          windowResults.push({
            window: w + 1,
            trainStart: win.trainStart, trainEnd: win.trainEnd,
            oosStart: win.oosStart, oosEnd: win.oosEnd,
            blockingUsed: bestCombo.label,
            oosTrades: oosStats.trades,
            oosWinRate: oosWR,
            oosProfitFactor: oosPF,
            oosPnL: oosPnL,
            oosMaxDD: parseFloat(oosStats.maxDrawdown),
            oosFees: parseFloat(oosStats.fees),
            oosLargestWin: parseFloat(oosStats.largestWin),
            oosByRegime: oosStats.byRegime,
            oosByExit: oosStats.byExit,
          });
        }

        // ── Aggregate OOS Results ───────────────────────────────
        allResults[symbol] = this._aggregateResults(symbol, windowResults);

      } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
        console.error(err.stack);
      }
    }

    // ── Final Report ────────────────────────────────────────────
    this._printFinalReport(allResults);
    this._exportResults(allResults);
  }

  _aggregateResults(symbol, windowResults) {
    const profitable = windowResults.filter(w => w.oosPnL > 0);
    const withTrades = windowResults.filter(w => w.oosTrades > 0);
    const totalPnL = windowResults.reduce((s, w) => s + w.oosPnL, 0);
    const totalTrades = windowResults.reduce((s, w) => s + w.oosTrades, 0);
    const totalFees = windowResults.reduce((s, w) => s + w.oosFees, 0);

    const pfs = windowResults.filter(w => w.oosProfitFactor > 0 && w.oosProfitFactor < Infinity).map(w => w.oosProfitFactor);
    const avgPF = pfs.length > 0 ? pfs.reduce((a, b) => a + b, 0) / pfs.length : 0;
    const medianPF = pfs.length > 0 ? [...pfs].sort((a, b) => a - b)[Math.floor(pfs.length / 2)] : 0;

    const wrs = withTrades.map(w => w.oosWinRate);
    const avgWR = wrs.length > 0 ? wrs.reduce((a, b) => a + b, 0) / wrs.length : 0;

    const maxDD = Math.max(...windowResults.map(w => w.oosMaxDD), 0);

    // Exit analysis across all windows
    const combinedExits = {};
    for (const w of windowResults) {
      for (const [exit, data] of Object.entries(w.oosByExit || {})) {
        if (!combinedExits[exit]) combinedExits[exit] = { trades: 0, wins: 0, pnl: 0 };
        combinedExits[exit].trades += data.trades;
        combinedExits[exit].wins += data.wins;
        combinedExits[exit].pnl += data.pnl;
      }
    }

    // Regime analysis across all windows
    const combinedRegimes = {};
    for (const w of windowResults) {
      for (const [regime, data] of Object.entries(w.oosByRegime || {})) {
        if (!combinedRegimes[regime]) combinedRegimes[regime] = { trades: 0, wins: 0, pnl: 0 };
        combinedRegimes[regime].trades += data.trades;
        combinedRegimes[regime].wins += data.wins;
        combinedRegimes[regime].pnl += data.pnl;
      }
    }

    return {
      symbol,
      windows: windowResults,
      totalWindows: windowResults.length,
      profitableWindows: profitable.length,
      profitableRate: ((profitable.length / windowResults.length) * 100).toFixed(0),
      totalPnL: totalPnL.toFixed(2),
      totalTrades,
      totalFees: totalFees.toFixed(2),
      avgPF: avgPF.toFixed(2),
      medianPF: medianPF.toFixed(2),
      avgWR: (avgWR).toFixed(1),
      maxOOSDD: maxDD.toFixed(2),
      combinedExits,
      combinedRegimes,
    };
  }

  _printFinalReport(allResults) {
    console.log('\n\n' + '═'.repeat(70));
    console.log('   🔬 WALK-FORWARD ANALYSIS — FINAL REPORT');
    console.log('═'.repeat(70));

    for (const [symbol, result] of Object.entries(allResults)) {
      console.log(`\n── ${symbol} ──────────────────────────────────────────────`);
      console.log(`  Windows: ${result.totalWindows} | Profitable OOS: ${result.profitableWindows}/${result.totalWindows} (${result.profitableRate}%)`);
      console.log(`  Total OOS PnL: $${result.totalPnL} | Trades: ${result.totalTrades} | Fees: $${result.totalFees}`);
      console.log(`  Avg PF: ${result.avgPF} | Median PF: ${result.medianPF} | Avg WR: ${result.avgWR}%`);
      console.log(`  Max OOS DD: ${result.maxOOSDD}%`);

      console.log(`\n  Per-Window OOS:`);
      for (const w of result.windows) {
        const emoji = w.oosPnL >= 0 ? '🟢' : '🔴';
        console.log(`    ${emoji} ${w.oosStart} → ${w.oosEnd} | ${String(w.oosTrades).padStart(3)} trades | ${String(w.oosWinRate).padStart(5)}% WR | PF: ${String(w.oosProfitFactor).padStart(5)} | PnL: $${w.oosPnL.toFixed(2).padStart(8)} | DD: ${w.oosMaxDD}%`);
      }

      console.log(`\n  OOS Exit Analysis:`);
      for (const [exit, data] of Object.entries(result.combinedExits).sort((a, b) => b[1].pnl - a[1].pnl)) {
        const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
        console.log(`    ${exit.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr.padStart(3)}% WR | PnL: $${data.pnl.toFixed(2).padStart(10)}`);
      }

      console.log(`\n  OOS Regime Analysis:`);
      for (const [regime, data] of Object.entries(result.combinedRegimes).sort((a, b) => b[1].pnl - a[1].pnl)) {
        const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
        console.log(`    ${regime.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr.padStart(3)}% WR | PnL: $${data.pnl.toFixed(2).padStart(10)}`);
      }
    }

    // ── Verdict ─────────────────────────────────────────────────
    console.log('\n\n' + '═'.repeat(70));
    console.log('   📋 VERDICT');
    console.log('═'.repeat(70));

    for (const [symbol, result] of Object.entries(allResults)) {
      const rate = parseInt(result.profitableRate);
      const pf = parseFloat(result.medianPF);
      const pnl = parseFloat(result.totalPnL);

      let verdict = '❓ INCONCLUSIVE';
      if (rate >= 70 && pf >= 1.2 && pnl > 0) verdict = '✅ ROBUST — Edge holds out-of-sample';
      else if (rate >= 50 && pf >= 1.0 && pnl > 0) verdict = '⚠️ MARGINAL — Some OOS edge but fragile';
      else if (pnl <= 0) verdict = '❌ FAILED — No OOS edge, likely curve-fitted';
      else verdict = '⚠️ MIXED — Inconsistent OOS performance';

      console.log(`\n  ${symbol}: ${verdict}`);
      console.log(`    ${result.profitableRate}% windows profitable | Median PF: ${result.medianPF} | Total OOS: $${result.totalPnL}`);
    }

    console.log('\n');
  }

  _exportResults(allResults) {
    const outputDir = path.join(process.cwd(), 'backtest-results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // CSV: all windows
    const csvRows = ['symbol,window,trainStart,trainEnd,oosStart,oosEnd,blockingUsed,oosTrades,oosWinRate,oosProfitFactor,oosPnL,oosMaxDD,oosFees'];
    for (const [symbol, result] of Object.entries(allResults)) {
      for (const w of result.windows) {
        csvRows.push([
          symbol, w.window, w.trainStart, w.trainEnd, w.oosStart, w.oosEnd,
          w.blockingUsed, w.oosTrades, w.oosWinRate, w.oosProfitFactor,
          w.oosPnL, w.oosMaxDD, w.oosFees,
        ].join(','));
      }
    }
    fs.writeFileSync(path.join(outputDir, `walkforward-${timestamp}.csv`), csvRows.join('\n'));

    // JSON: full results
    fs.writeFileSync(path.join(outputDir, `walkforward-${timestamp}.json`), JSON.stringify(allResults, null, 2));

    console.log(`📁 Results exported to backtest-results/walkforward-${timestamp}.{csv,json}`);
  }

  async _fetchCandles(exchange, symbol, timeframe) {
    const allCandles = [];
    let since = new Date(this.startDate).getTime();
    const endTime = new Date(this.endDate).getTime();
    const limit = 1000;

    while (true) {
      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit);
        if (ohlcv.length === 0) break;

        const candles = ohlcv.map(c => ({
          timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
        }));
        allCandles.push(...candles);

        const lastTs = ohlcv[ohlcv.length - 1][0];
        if (lastTs >= endTime || ohlcv.length < limit) break;
        since = lastTs + 1;
        await new Promise(r => setTimeout(r, exchange.rateLimit));
      } catch (err) {
        console.error(`  Fetch error (${timeframe}): ${err.message}`);
        break;
      }
    }

    return allCandles.filter(c => c.timestamp <= endTime);
  }
}

// ── CLI ───────────────────────────────────────────────────────────
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--symbol' && args[i + 1]) options.symbols = [args[++i]];
  if (args[i] === '--all') options.symbols = config.symbols;
  if (args[i] === '--from' && args[i + 1]) options.startDate = args[++i];
  if (args[i] === '--to' && args[i + 1]) options.endDate = args[++i];
  if (args[i] === '--optimize' || args[i] === '-o') options.optimize = true;
  if (args[i] === '--train' && args[i + 1]) options.trainMonths = parseInt(args[++i]);
  if (args[i] === '--oos' && args[i + 1]) options.oosMonths = parseInt(args[++i]);
  if (args[i] === '--step' && args[i + 1]) options.stepMonths = parseInt(args[++i]);
  if (args[i] === '--exchange' && args[i + 1]) options.exchange = args[++i];
}

// Default: run all symbols
if (!options.symbols) options.symbols = config.symbols;

const wfa = new WalkForwardAnalyzer(options);
wfa.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
