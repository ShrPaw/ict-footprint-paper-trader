// ═══════════════════════════════════════════════════════════════════
// signal_dataset.js — Instrumented Backtest for Edge Discovery
// ═══════════════════════════════════════════════════════════════════
//
// PURPOSE: Research tool. Captures EVERY signal decision (accepted or rejected)
// with full feature context. No logic changes — pure instrumentation.
//
// OUTPUT: data/signal-dataset-{timestamp}.jsonl
// Each line = one signal evaluation with:
//   - All features at time of evaluation
//   - Decision (accepted/rejected + reason)
//   - Outcome (PnL, exit type) if trade was taken
//
// USAGE:
//   node audit/signal_dataset.js --symbol SOL/USDT:USDT --from 2022-01-01 --to 2022-12-31
//   node audit/signal_dataset.js --symbol SOL/USDT:USDT --from 2022-01-01 --to 2026-03-31

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';
import {
  computeEMA, computeATR, computeADX, computeBollinger,
  computeDelta, computeVolumeMetrics,
  extractRegimes, extractFVGs, extractOrderBlocks,
  extractLiquiditySweeps, extractOTEs,
} from '../engine/Precompute.js';
import ModelRouter from '../models/ModelRouter.js';
import ExhaustionDetector from '../engine/ExhaustionDetector.js';
import PortfolioRiskManager from '../engine/PortfolioRiskManager.js';
import OrderFlowEngine from '../engine/OrderFlowEngine.js';

class SignalDatasetBuilder {
  constructor(options = {}) {
    this.startingBalance = options.startingBalance || 10000;
    this.balance = this.startingBalance;
    this.symbols = options.symbols || ['SOL/USDT:USDT'];
    this.startDate = options.startDate || '2022-01-01';
    this.endDate = options.endDate || '2026-03-31';
    this.exchangeId = options.exchange || 'binance';

    // Signal trace log — every evaluation
    this.signalLog = [];
    // Trade log — only executed trades
    this.trades = [];
    this.position = null;

    // Counters
    this.counters = {
      totalCandles: 0,
      weekendBlocked: 0,
      killzoneBlocked: 0,
      sessionBlocked: 0,
      regimeBlocked: 0,
      emaBlocked: 0,
      cooldownBlocked: 0,
      contextNull: 0,
      modelEvaluations: 0,
      modelNull: 0,
      modelSignal: 0,
      exhaustionBlocked: 0,
      portfolioBlocked: 0,
      tradeOpened: 0,
    };

    // Per-gate counters for SOL specifically
    this.solGateCounters = {
      weekend: 0,
      killzone: 0,
      sessionGate: 0,
      regimeBlock: 0,
      featureNull: 0,
      atrZFilter: 0,      // atrZ > 2.0
      distFilter: 0,       // distFromMean > 2.0
      saturatedBlock: 0,   // orderflowState === 'SATURATED'
      noDirection: 0,      // !bullish && !bearish
      lowStacking: 0,      // stackedCount < 3
      exhaustionBlock: 0,
      thresholdBlock: 0,   // confidence < threshold
      signalGenerated: 0,
    };

    // Components
    this.modelRouter = new ModelRouter();
    this.exhaustion = new ExhaustionDetector();
    this.portfolioRisk = new PortfolioRiskManager({ startingBalance: this.startingBalance });
    this.orderFlowEngine = new OrderFlowEngine();

    this.lastSignalTime = {};
    this.dailyPnL = 0;
    this.dailyTradeCount = 0;
    this.lastResetDay = null;
  }

  async run() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   🔬 SIGNAL DATASET BUILDER — Edge Discovery         ║');
    console.log('║   Instrumented backtest with full signal tracing     ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    const exchange = new ccxt[this.exchangeId]({ enableRateLimit: true });

    for (const symbol of this.symbols) {
      console.log(`\n── Processing ${symbol} ──────────────────────────`);
      const profile = getProfile(symbol);
      const coin = profile.coin || symbol.split('/')[0];

      try {
        // Phase 1: Data
        const t0 = Date.now();
        const candles15m = await this._fetchCandles(exchange, symbol, '15m');
        const candles5m = await this._fetchCandles(exchange, symbol, '5m');
        const candles1h = await this._fetchCandles(exchange, symbol, '1h');
        console.log(`  📥 Data: 15m=${candles15m.length} | 5m=${candles5m.length} | 1h=${candles1h.length} (${((Date.now()-t0)/1000).toFixed(1)}s)`);

        // Phase 2: Precompute
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
        this.orderFlowEngine.setPrecomputed(indicators15m.delta.delta, indicators15m.delta.deltaPercent);
        console.log(`  📐 Indicators: ${((Date.now()-t1)/1000).toFixed(1)}s`);

        // Phase 3: Features
        const t2 = Date.now();
        const regimes = extractRegimes(candles1h, indicators1h);
        const fvgSignals = extractFVGs(candles1h);
        const obSignals = extractOrderBlocks(candles1h);
        const sweepSignals = extractLiquiditySweeps(candles1h);
        const oteSignals = extractOTEs(candles1h);
        console.log(`  🔍 Features: ${((Date.now()-t2)/1000).toFixed(1)}s`);

        // 15m→1h mapping
        const m15toH1 = new Array(candles15m.length);
        let hCursor = 0;
        for (let i = 0; i < candles15m.length; i++) {
          while (hCursor < candles1h.length - 1 && candles1h[hCursor + 1].timestamp <= candles15m[i].timestamp) {
            hCursor++;
          }
          m15toH1[i] = hCursor;
        }

        // Phase 4: Instrumented backtest loop
        const t3 = Date.now();
        console.log(`  🔄 Starting instrumented loop (${candles15m.length} candles)...`);

        for (let i = 50; i < candles15m.length; i++) {
          const candle15m = candles15m[i];
          const timestamp = candle15m.timestamp;
          const h1Idx = m15toH1[i];
          const day = new Date(timestamp).toDateString();

          if (day !== this.lastResetDay) {
            this.dailyPnL = 0;
            this.dailyTradeCount = 0;
            this.lastResetDay = day;
          }

          this.counters.totalCandles++;

          // Check exits
          if (this.position) {
            this._checkExit(candle15m, timestamp, i);
          }

          // Signal evaluation (only when flat)
          if (!this.position && h1Idx >= 50) {
            this._traceSignalEvaluation(
              i, h1Idx, candle15m, candles15m, candles1h,
              indicators1h, indicators15m,
              regimes, fvgSignals, obSignals, sweepSignals, oteSignals,
              symbol, timestamp, profile
            );
          }

          // Track equity (simplified)
          if (i % 10000 === 0) {
            const pct = ((i / candles15m.length) * 100).toFixed(0);
            console.log(`  ⏳ ${pct}% | signals: ${this.signalLog.length} | trades: ${this.trades.length}`);
          }
        }

        // Close remaining position
        if (this.position) {
          const last = candles15m[candles15m.length - 1];
          this._closePosition(last.close, last.timestamp, 'backtest_end');
        }

        console.log(`  ✅ Loop done: ${((Date.now()-t3)/1000).toFixed(1)}s`);

      } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
        console.error(err.stack);
      }
    }

    this._export();
    this._printSummary();
  }

  /**
   * Instrumented signal evaluation — traces every decision point.
   * This is the core of the research tool.
   */
  _traceSignalEvaluation(m15Idx, h1Idx, candle15m, candles15m, candles1h,
    indicators1h, indicators15m, regimes, fvgSignals, obSignals, sweepSignals, oteSignals,
    symbol, timestamp, profile) {

    const regimeData = regimes[h1Idx];
    if (!regimeData) { this.counters.contextNull++; return; }

    const regime = regimeData.regime;
    const deltaArr = indicators15m.delta.delta;

    // ── Gate 1: Weekend ──────────────────────────────────────────
    const day = new Date(timestamp).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (isWeekend) {
      this.counters.weekendBlocked++;
      this.solGateCounters.weekend++;
      return; // Don't log — too many, not informative
    }

    // ── Gate 2: Killzone ─────────────────────────────────────────
    const killzone = this._checkKillzone(timestamp);
    if (!killzone.allowed) {
      this.counters.killzoneBlocked++;
      this.solGateCounters.killzone++;
      return; // Don't log — too many
    }

    // ── Gate 3: Session gate ─────────────────────────────────────
    if (profile.allowedSessions && !profile.allowedSessions.includes(killzone.session)) {
      this.counters.sessionBlocked++;
      this.solGateCounters.sessionGate++;
      this._logSignal(timestamp, symbol, regime, 'SESSION_BLOCKED', null, {
        session: killzone.session, allowedSessions: profile.allowedSessions,
      });
      return;
    }

    // ── Gate 4: Regime block ─────────────────────────────────────
    if (profile.blockedRegimes?.includes(regime)) {
      this.counters.regimeBlocked++;
      this.solGateCounters.regimeBlock++;
      this._logSignal(timestamp, symbol, regime, 'REGIME_BLOCKED', null, {
        regime, blockedRegimes: profile.blockedRegimes,
      });
      return;
    }

    // ── Gate 5: EMA alignment ────────────────────────────────────
    const price = candles1h[h1Idx].close;
    const ema21 = indicators1h.ema21[h1Idx];
    const ema50 = indicators1h.ema50[h1Idx];
    const bullishEMA = price > ema21 && price > ema50;
    const bearishEMA = price < ema21 && price < ema50;
    if (!bullishEMA && !bearishEMA) {
      this.counters.emaBlocked++;
      return; // Don't log — too many
    }

    // ── Gate 6: Cooldown ─────────────────────────────────────────
    const lastTime = this.lastSignalTime[symbol];
    if (lastTime && timestamp - lastTime < config.strategy.signalCooldown) {
      this.counters.cooldownBlocked++;
      return; // Don't log — not informative
    }

    // ═══════════════════════════════════════════════════════════════
    // MODEL EVALUATION — Here we trace the SOL model specifically
    // ═══════════════════════════════════════════════════════════════

    // Build model context (same as backtest.js)
    const modelCtx = {
      candles15m, candles1h, index15m: m15Idx, index1h: h1Idx,
      indicators1h, deltaArr,
      timestamp, profile, regime, regimeResult: regimeData, killzone,
      sweepSignals: sweepSignals[h1Idx],
      obSignals: obSignals[h1Idx],
      oteSignals: oteSignals[h1Idx],
      symbol, price,
    };

    // Extract features (same as SOLModel._extractFeatures)
    const features = this._extractFeatures(modelCtx);
    if (!features) {
      this.counters.modelNull++;
      this.solGateCounters.featureNull++;
      this._logSignal(timestamp, symbol, regime, 'FEATURE_NULL', features, {
        reason: 'index < 20 or ATR = 0',
      });
      return;
    }

    this.counters.modelEvaluations++;

    // ── Model Filter 1: ATR z-score ──────────────────────────────
    if (features.atrZ > 2.0) {
      this.counters.modelNull++;
      this.solGateCounters.atrZFilter++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_ATRZ', features, {
        reason: `atrZ=${features.atrZ.toFixed(3)} > 2.0`,
      });
      return;
    }

    // ── Model Filter 2: Late move ────────────────────────────────
    if (features.distFromMean > 2.0) {
      this.counters.modelNull++;
      this.solGateCounters.distFilter++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_DIST', features, {
        reason: `distFromMean=${features.distFromMean.toFixed(3)} > 2.0`,
      });
      return;
    }

    // ── Model Filter 3: Context classification ───────────────────
    const flowCtx = this._classifyContext(features, regime);

    if (flowCtx.orderflowState === 'SATURATED') {
      this.counters.modelNull++;
      this.solGateCounters.saturatedBlock++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_SATURATED', features, {
        reason: `stacked=${features.stackedCount} >= 5, no divergence`,
        flowCtx,
      });
      return;
    }

    // ── Model Filter 4: Direction ────────────────────────────────
    const bullish = features.deltaTrend === 'bullish' && features.momentumDir === 'bullish';
    const bearish = features.deltaTrend === 'bearish' && features.momentumDir === 'bearish';

    if (!bullish && !bearish) {
      this.counters.modelNull++;
      this.solGateCounters.noDirection++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_NO_DIRECTION', features, {
        reason: `deltaTrend=${features.deltaTrend}, momentumDir=${features.momentumDir}`,
        flowCtx,
      });
      return;
    }

    // ── Model Filter 5: Stacking minimum ─────────────────────────
    if (features.stackedCount < 3) {
      this.counters.modelNull++;
      this.solGateCounters.lowStacking++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_LOW_STACKING', features, {
        reason: `stacked=${features.stackedCount} < 3`,
        flowCtx,
      });
      return;
    }

    // ── Confidence scoring (same as SOLModel._evaluateSignal) ────
    const direction = bullish ? 'bullish' : 'bearish';
    const action = bullish ? 'buy' : 'sell';
    let confidence = 0;

    if (features.stackedCount >= 5) confidence += 0.35;
    else if (features.stackedCount >= 3) confidence += 0.25;

    const absMom = Math.abs(features.momentum);
    if (absMom > 0.005) confidence += 0.20;
    else if (absMom > 0.002) confidence += 0.12;
    else confidence += 0.05;

    if (features.volRatio > 1.5) confidence += 0.15;
    else if (features.volRatio > 1.0) confidence += 0.08;

    if (regime === 'RANGING') {
      const pricePos = this._pricePositionInRange(candles1h, h1Idx, 20);
      if ((direction === 'bullish' && pricePos < 0.3) || (direction === 'bearish' && pricePos > 0.7)) {
        confidence += 0.15;
      } else {
        confidence += 0.05;
      }
    } else if (regime === 'TRENDING_UP') {
      if (features.stackedCount >= 4) confidence += 0.10;
    }

    const sessionWeight = profile.sessionWeights[killzone.session] || 1.0;
    confidence *= sessionWeight;

    const regimeMult = { VOL_EXPANSION: 0.90, TRENDING_UP: 1.05, RANGING: 0.95 };
    confidence *= (regimeMult[regime] ?? 1.0);

    // ── Exhaustion check ─────────────────────────────────────────
    const exhaustionResult = this.exhaustion.check({
      ...modelCtx, atrZ: features.atrZ, distFromMean: features.distFromMean,
      stackedCount: features.stackedCount, volumeRatio: features.volRatio,
    });

    if (exhaustionResult.blocked) {
      this.counters.exhaustionBlocked++;
      this.solGateCounters.exhaustionBlock++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_EXHAUSTION', features, {
        reason: exhaustionResult.reason,
        exhaustionChecks: exhaustionResult.checks,
        confidence,
        flowCtx,
      });
      return;
    }

    // ── Divergence check ─────────────────────────────────────────
    const hasDivergence = this._checkDivergence(features.deltaHistory, candles15m, m15Idx);
    if (hasDivergence) {
      confidence += config.strategy.confluenceBonus;
    }

    // ── Threshold check ──────────────────────────────────────────
    const minSolo = profile.daytrade.minSoloScore ?? 0.85;
    const minConfluence = profile.daytrade.minConfluenceScore ?? 0.75;
    const threshold = hasDivergence ? minConfluence : minSolo;

    if (confidence < threshold) {
      this.counters.modelNull++;
      this.solGateCounters.thresholdBlock++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_THRESHOLD', features, {
        reason: `confidence=${confidence.toFixed(3)} < threshold=${threshold}`,
        hasDivergence, threshold,
        flowCtx,
      });
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // SIGNAL GENERATED — Log it
    // ═══════════════════════════════════════════════════════════════
    this.counters.modelSignal++;
    this.solGateCounters.signalGenerated++;

    const signalType = hasDivergence ? 'SOL_MOMENTUM_DIV' : 'SOL_STACKED_IMBALANCE';

    this._logSignal(timestamp, symbol, regime, 'SIGNAL_GENERATED', features, {
      signalType, action, direction, confidence,
      hasDivergence, threshold,
      flowCtx,
    });

    // ── Portfolio risk check ──────────────────────────────────────
    const riskResult = this.portfolioRisk.validate(symbol, {
      type: signalType, action, direction, confidence, regime,
    }, {
      balance: this.balance,
      activePositions: this.position ? [this.position] : [],
    });

    if (!riskResult.allowed) {
      this.counters.portfolioBlocked++;
      this._logSignal(timestamp, symbol, regime, 'REJECTED_PORTFOLIO', features, {
        reason: 'portfolio risk blocked',
        signalType, confidence,
      });
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // TRADE OPENED
    // ═══════════════════════════════════════════════════════════════
    this.counters.tradeOpened++;
    this.lastSignalTime[symbol] = timestamp;

    const atr = features.atr;
    const slMult = (profile.riskOverrides?.slMultiplier ?? config.risk[regime]?.slMultiplier ?? 0.9) * profile.slTightness;
    const tpMult = config.risk[regime]?.tpMultiplier || 2.5;

    const stopLoss = action === 'buy' ? price - atr * slMult : price + atr * slMult;
    const takeProfit = action === 'buy' ? price + atr * tpMult : price - atr * tpMult;

    const riskPercent = (config.risk[regime]?.riskPercent || 0.5) * (profile.riskMultiplier ?? 1.0);
    const riskAmount = this.balance * (riskPercent / 100);
    const slDistance = Math.abs(price - stopLoss);
    const size = slDistance > 0 ? riskAmount / slDistance : 0;
    const fee = size * price * config.engine.makerFee;

    if (size === 0) return;

    this.position = {
      symbol, side: action === 'buy' ? 'long' : 'short',
      size, entryPrice: price, stopLoss, takeProfit,
      regime, signalType, signalSource: 'SOL_MODEL',
      entryTime: timestamp, fee, atr,
      highestPrice: price, lowestPrice: price,
      trailingActive: false, partialTPDone: false,
      originalSize: size, assetProfile: profile.name,
      profile, entryM15Idx: m15Idx,
      decayStage: 0, decayBarsLimit: null,
      _emergencyATRMult: 1.0,
      // Research: link to signal log entry
      _signalLogIdx: this.signalLog.length - 1,
    };

    this.balance -= fee;

    this._logSignal(timestamp, symbol, regime, 'TRADE_OPENED', features, {
      signalType, action, direction, confidence,
      entryPrice: price, stopLoss, takeProfit,
      size, fee, atr, slMult, tpMult,
    });
  }

  _checkExit(candle, timestamp, currentBarIdx) {
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
          pnl: partialPnL, duration: timestamp - pos.entryTime,
          durationMin: Math.round((timestamp - pos.entryTime) / 60000),
          assetProfile: pos.assetProfile,
          signalLogIdx: pos._signalLogIdx,
        });

        pos.size = remainingSize;
        pos.fee *= (1 - closePercent);
        pos.partialTPDone = true;
      }
    }

    // Trailing stop
    if (config.engine.trailingStop.enabled) {
      const activationATR = pos.profile?.riskOverrides?.trailingStop?.activationATR ?? config.engine.trailingStop.activationATR;
      const trailATR = pos.profile?.riskOverrides?.trailingStop?.trailATR ?? config.engine.trailingStop.trailATR;
      const activationDist = pos.atr * activationATR;
      const trailDist = pos.atr * trailATR;

      if (!pos.trailingActive) {
        if (side === 'long' && candle.high >= pos.entryPrice + activationDist) pos.trailingActive = true;
        else if (side === 'short' && candle.low <= pos.entryPrice - activationDist) pos.trailingActive = true;
      }

      if (pos.trailingActive) {
        if (side === 'long') {
          const newSL = pos.highestPrice - trailDist;
          if (newSL > pos.stopLoss) pos.stopLoss = newSL;
        } else {
          const newSL = pos.lowestPrice + trailDist;
          if (newSL < pos.stopLoss) pos.stopLoss = newSL;
        }
      }
    }

    // Decay engine (same as backtest.js)
    const barsSinceEntry = currentBarIdx - (pos.entryM15Idx || currentBarIdx);
    if (pos.decayBarsLimit === null) {
      const volBase = { 'LOW': 72, 'NORMAL': 48, 'HIGH': 24, 'EXTREME': 16 };
      const regimeMult = { 'VOL_EXPANSION': 0.75, 'TRENDING_UP': 1.0, 'TRENDING_DOWN': 1.0, 'RANGING': 1.5 };
      const base = volBase[pos.volatilityState] || 48;
      const mult = regimeMult[pos.regime] || 1.0;
      pos.decayBarsLimit = Math.round(base * mult);
    }

    if (!pos.trailingActive && barsSinceEntry > pos.decayBarsLimit) {
      const decayProgress = (barsSinceEntry - pos.decayBarsLimit) / pos.decayBarsLimit;
      if (decayProgress > 1.0 && pos.decayStage < 2) {
        pos.decayStage = 2;
        pos._emergencyATRMult = 0.4;
      } else if (pos.decayStage < 1) {
        pos.decayStage = 1;
        pos._emergencyATRMult = 0.7;
      }
    }

    // Emergency stop
    const baseEmergencyATR = pos.profile?.riskOverrides?.emergencyATR ?? 12.0;
    const emergencyATR = baseEmergencyATR * (pos._emergencyATRMult ?? 1.0);
    const emergencyDist = pos.atr * emergencyATR;
    const emergencySL = side === 'long' ? pos.entryPrice - emergencyDist : pos.entryPrice + emergencyDist;

    if (side === 'long' && candle.low <= emergencySL) { this._closePosition(emergencySL, timestamp, 'emergency_stop'); return; }
    if (side === 'short' && candle.high >= emergencySL) { this._closePosition(emergencySL, timestamp, 'emergency_stop'); return; }

    // TP check
    if (side === 'long' && candle.high >= pos.takeProfit) { this._closePosition(pos.takeProfit, timestamp, 'take_profit'); return; }
    if (side === 'short' && candle.low <= pos.takeProfit) { this._closePosition(pos.takeProfit, timestamp, 'take_profit'); return; }

    // Trailing SL check
    if (pos.trailingActive) {
      if (side === 'long' && candle.low <= pos.stopLoss) { this._closePosition(pos.stopLoss, timestamp, 'trailing_sl'); return; }
      if (side === 'short' && candle.high >= pos.stopLoss) { this._closePosition(pos.stopLoss, timestamp, 'trailing_sl'); return; }
    }
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

    const trade = {
      symbol: pos.symbol, side: pos.side, size: pos.size,
      entryPrice: pos.entryPrice, exitPrice: fillPrice,
      entryTime: pos.entryTime, exitTime: timestamp,
      closeReason: reason, regime: pos.regime, signalType: pos.signalType,
      pnl, pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
      duration: timestamp - pos.entryTime,
      durationMin: Math.round((timestamp - pos.entryTime) / 60000),
      assetProfile: pos.assetProfile,
      signalLogIdx: pos._signalLogIdx,
      // Research data from position
      decayStage: pos.decayStage || 0,
      trailingActivated: pos.trailingActive || false,
      barsSinceEntry: this._currentBarIndex ? (this._currentBarIndex - (pos.entryM15Idx || 0)) : 0,
    };

    this.trades.push(trade);

    // Update signal log entry with outcome
    if (pos._signalLogIdx != null && this.signalLog[pos._signalLogIdx]) {
      this.signalLog[pos._signalLogIdx].outcome = {
        pnl, closeReason: reason,
        duration: trade.durationMin,
        exitPrice: fillPrice,
      };
    }

    this.position = null;
  }

  // ── Feature extraction (mirrors SOLModel._extractFeatures) ────

  _extractFeatures(ctx) {
    const { candles15m, index15m, candles1h, index1h, indicators1h } = ctx;
    if (index15m < 20 || index1h < 20) return null;

    const price = candles1h[index1h].close;
    const atr = indicators1h.atr[index1h];
    if (!atr || atr === 0) return null;

    // Delta context
    const deltaHistory = [];
    for (let j = Math.max(0, index15m - 9); j <= index15m; j++) {
      deltaHistory.push(ctx.deltaArr?.[j] ?? this._estDelta(candles15m[j]));
    }
    const currentDelta = deltaHistory[deltaHistory.length - 1];
    const stackedCount = this._countStacked(deltaHistory);
    const deltaSum = deltaHistory.reduce((a, b) => a + b, 0);
    const deltaTrend = deltaSum > 0 ? 'bullish' : deltaSum < 0 ? 'bearish' : 'neutral';

    // Momentum
    const momentumLookback = 5;
    const mStart = Math.max(0, index15m - momentumLookback);
    const momentum = (candles15m[index15m].close - candles15m[mStart].close) / candles15m[mStart].close;
    const momentumDir = momentum > 0 ? 'bullish' : momentum < 0 ? 'bearish' : 'neutral';

    // Volatility
    const atrZ = this._computeATRzScore(candles1h, index1h);

    // Extension
    const distFromMean = this._priceDistanceFromMean(candles1h, index1h, 20);

    // Volume
    const volRatio = indicators1h.volumeMetrics?.volumeRatio?.[index1h] ?? 1.0;

    return {
      price, atr, deltaHistory, currentDelta, deltaSum, deltaTrend,
      stackedCount, momentum, momentumDir, atrZ, distFromMean, volRatio,
    };
  }

  _classifyContext(features, regime) {
    const f = features;
    return {
      extensionState: f.distFromMean < 1.2 ? 'LOW' : f.distFromMean < 2.0 ? 'MEDIUM' : 'HIGH',
      volatilityState: f.atrZ < 1.0 ? 'LOW' : f.atrZ < 1.5 ? 'NORMAL' : f.atrZ < 2.0 ? 'HIGH' : 'EXTREME',
      orderflowState: this._classifyOrderFlow(f),
      regimeState: regime,
    };
  }

  _classifyOrderFlow(f) {
    const hasDivergence = f.deltaHistory.length >= 6 && this._hasDivergenceInFeatures(f);
    if (hasDivergence) return 'DIVERGENT';
    if (f.stackedCount >= 5) return 'SATURATED';
    if (f.stackedCount >= 3) return 'DIRECTIONAL';
    return 'BALANCED';
  }

  _hasDivergenceInFeatures(f) {
    const deltas = f.deltaHistory;
    if (deltas.length < 6) return false;
    const recentDelta = deltas.slice(-3).reduce((a, b) => a + b, 0);
    const olderDelta = deltas.slice(-6, -3).reduce((a, b) => a + b, 0);
    return (f.deltaTrend === 'bullish' && recentDelta < olderDelta && recentDelta < 0) ||
           (f.deltaTrend === 'bearish' && recentDelta > olderDelta && recentDelta > 0);
  }

  _countStacked(deltas) {
    if (deltas.length < 2) return 0;
    let maxStack = 1, currentStack = 1;
    let lastSign = Math.sign(deltas[0]);
    for (let i = 1; i < deltas.length; i++) {
      const sign = Math.sign(deltas[i]);
      if (sign === lastSign && sign !== 0) { currentStack++; maxStack = Math.max(maxStack, currentStack); }
      else { currentStack = 1; lastSign = sign; }
    }
    return maxStack;
  }

  _checkDivergence(deltas, candles, index) {
    if (deltas.length < 6) return false;
    const priceUp = candles[index].close > candles[Math.max(0, index - 5)].close;
    const priceDown = candles[index].close < candles[Math.max(0, index - 5)].close;
    const recentDelta = deltas.slice(-3).reduce((a, b) => a + b, 0);
    const olderDelta = deltas.slice(-6, -3).reduce((a, b) => a + b, 0);
    if (priceDown && recentDelta > olderDelta && recentDelta > 0) return true;
    if (priceUp && recentDelta < olderDelta && recentDelta < 0) return true;
    return false;
  }

  _pricePositionInRange(candles, index, lookback) {
    const start = Math.max(0, index - lookback);
    let high = -Infinity, low = Infinity;
    for (let i = start; i <= index; i++) {
      if (candles[i].high > high) high = candles[i].high;
      if (candles[i].low < low) low = candles[i].low;
    }
    const range = high - low;
    return range > 0 ? (candles[index].close - low) / range : 0.5;
  }

  _estDelta(candle) {
    const range = candle.high - candle.low;
    if (range === 0) return 0;
    return ((candle.close - candle.low) / range - 0.5) * 2 * candle.volume;
  }

  _computeATRzScore(candles, index, period = 14, lookback = 50) {
    if (index < period + lookback) return 0;
    const tr = [];
    for (let i = Math.max(1, index - period); i <= index; i++) {
      tr.push(Math.max(candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i-1].close),
        Math.abs(candles[i].low - candles[i-1].close)));
    }
    const currentATR = tr.reduce((a, b) => a + b, 0) / tr.length;
    const atrs = [];
    for (let start = Math.max(period, index - lookback); start <= index - period; start += Math.max(1, Math.floor(period / 2))) {
      const htr = [];
      for (let i = start; i < start + period && i <= index; i++) {
        htr.push(Math.max(candles[i].high - candles[i].low,
          Math.abs(candles[i].high - candles[Math.max(0, i-1)].close),
          Math.abs(candles[i].low - candles[Math.max(0, i-1)].close)));
      }
      if (htr.length === period) atrs.push(htr.reduce((a, b) => a + b, 0) / htr.length);
    }
    if (atrs.length < 5) return 0;
    const mean = atrs.reduce((a, b) => a + b, 0) / atrs.length;
    const std = Math.sqrt(atrs.reduce((s, v) => s + (v - mean) ** 2, 0) / atrs.length);
    return std > 0 ? (currentATR - mean) / std : 0;
  }

  _priceDistanceFromMean(candles, index, period = 20) {
    if (index < period) return 0;
    let sum = 0;
    for (let i = index - period + 1; i <= index; i++) sum += candles[i].close;
    const mean = sum / period;
    const tr = [];
    for (let i = Math.max(1, index - 13); i <= index; i++) {
      tr.push(Math.max(candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[Math.max(0, i-1)].close),
        Math.abs(candles[i].low - candles[Math.max(0, i-1)].close)));
    }
    const atr = tr.reduce((a, b) => a + b, 0) / tr.length;
    return atr > 0 ? Math.abs(candles[index].close - mean) / atr : 0;
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
    return { allowed: true, session };
  }

  _logSignal(timestamp, symbol, regime, decision, features, details) {
    this.signalLog.push({
      timestamp,
      date: new Date(timestamp).toISOString().slice(0, 19),
      symbol,
      regime,
      decision,
      features: features ? {
        stackedCount: features.stackedCount,
        deltaTrend: features.deltaTrend,
        momentumDir: features.momentumDir,
        momentum: features.momentum,
        atrZ: features.atrZ,
        distFromMean: features.distFromMean,
        volRatio: features.volRatio,
        currentDelta: features.currentDelta,
        deltaSum: features.deltaSum,
        price: features.price,
        atr: features.atr,
      } : null,
      details,
      outcome: null, // Filled in after trade closes
    });
  }

  async _fetchCandles(exchange, symbol, timeframe) {
    const all = [];
    let since = new Date(this.startDate).getTime();
    const endTime = new Date(this.endDate).getTime();
    const limit = 1000;
    while (true) {
      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit);
        if (ohlcv.length === 0) break;
        all.push(...ohlcv.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })));
        const lastTs = ohlcv[ohlcv.length - 1][0];
        if (lastTs >= endTime || ohlcv.length < limit) break;
        since = lastTs + 1;
        await new Promise(r => setTimeout(r, exchange.rateLimit));
      } catch (err) { console.error(`  Fetch error: ${err.message}`); break; }
    }
    return all.filter(c => c.timestamp <= endTime);
  }

  _export() {
    const outDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Signal log as JSONL
    const signalPath = path.join(outDir, `signal-dataset-${ts}.jsonl`);
    fs.writeFileSync(signalPath, this.signalLog.map(s => JSON.stringify(s)).join('\n'));

    // Trades as JSON
    const tradesPath = path.join(outDir, `trade-outcomes-${ts}.json`);
    fs.writeFileSync(tradesPath, JSON.stringify(this.trades, null, 2));

    // Counters as JSON
    const countersPath = path.join(outDir, `signal-counters-${ts}.json`);
    fs.writeFileSync(countersPath, JSON.stringify({
      backtest: this.counters,
      solGates: this.solGateCounters,
    }, null, 2));

    console.log(`\n📁 Exported:`);
    console.log(`  Signals: ${signalPath} (${this.signalLog.length} entries)`);
    console.log(`  Trades:  ${tradesPath} (${this.trades.length} trades)`);
    console.log(`  Counters: ${countersPath}`);
  }

  _printSummary() {
    const c = this.counters;
    const g = this.solGateCounters;
    const totalAttempted = c.totalCandles;

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   📊 SIGNAL TRACE SUMMARY                            ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    console.log('── Funnel (all candles) ──────────────────────────');
    console.log(`  Total candles analyzed:     ${totalAttempted}`);
    console.log(`  Weekend blocked:            ${c.weekendBlocked} (${(c.weekendBlocked/totalAttempted*100).toFixed(1)}%)`);
    console.log(`  Killzone blocked:           ${c.killzoneBlocked}`);
    console.log(`  Session blocked:            ${c.sessionBlocked}`);
    console.log(`  Regime blocked:             ${c.regimeBlocked}`);
    console.log(`  EMA blocked:                ${c.emaBlocked}`);
    console.log(`  Cooldown blocked:           ${c.cooldownBlocked}`);
    console.log(`  Context null:               ${c.contextNull}`);
    console.log(`  ─────────────────────────────────────────────────`);
    console.log(`  Model evaluations:          ${c.modelEvaluations}`);
    console.log(`  Model null (features):      ${c.modelNull}`);
    console.log(`  Model signals generated:    ${c.modelSignal}`);
    console.log(`  Exhaustion blocked:         ${c.exhaustionBlocked}`);
    console.log(`  Portfolio blocked:          ${c.portfolioBlocked}`);
    console.log(`  ─────────────────────────────────────────────────`);
    console.log(`  TRADES OPENED:              ${c.tradeOpened}`);

    console.log('\n── SOL Model Gate Breakdown ─────────────────────');
    console.log(`  Weekend:                    ${g.weekend}`);
    console.log(`  Killzone:                   ${g.killzone}`);
    console.log(`  Session gate:               ${g.sessionGate}`);
    console.log(`  Regime block:               ${g.regimeBlock}`);
    console.log(`  Feature null:               ${g.featureNull}`);
    console.log(`  ATR-z > 2.0:                ${g.atrZFilter}`);
    console.log(`  Dist > 2.0:                 ${g.distFilter}`);
    console.log(`  Saturated (stacked >= 5):   ${g.saturatedBlock}`);
    console.log(`  No direction:               ${g.noDirection}`);
    console.log(`  Low stacking (< 3):         ${g.lowStacking}`);
    console.log(`  Exhaustion:                 ${g.exhaustionBlock}`);
    console.log(`  Below threshold:            ${g.thresholdBlock}`);
    console.log(`  ─────────────────────────────────────────────────`);
    console.log(`  Signals generated:          ${g.signalGenerated}`);

    console.log('\n── Signal Decision Breakdown ───────────────────');
    const decisionCounts = {};
    for (const s of this.signalLog) {
      decisionCounts[s.decision] = (decisionCounts[s.decision] || 0) + 1;
    }
    for (const [dec, count] of Object.entries(decisionCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${dec.padEnd(30)} ${count}`);
    }

    console.log('\n── Trade Outcomes ──────────────────────────────');
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    const totalPnL = this.trades.reduce((s, t) => s + t.pnl, 0);
    console.log(`  Trades: ${this.trades.length} (${wins.length}W / ${losses.length}L)`);
    console.log(`  Win rate: ${this.trades.length > 0 ? (wins.length / this.trades.length * 100).toFixed(1) : 0}%`);
    console.log(`  Total PnL: $${totalPnL.toFixed(2)}`);

    const byExit = {};
    for (const t of this.trades) {
      if (!byExit[t.closeReason]) byExit[t.closeReason] = { count: 0, wins: 0, pnl: 0 };
      byExit[t.closeReason].count++;
      if (t.pnl > 0) byExit[t.closeReason].wins++;
      byExit[t.closeReason].pnl += t.pnl;
    }
    console.log('\n── By Exit Reason ─────────────────────────────');
    for (const [reason, data] of Object.entries(byExit).sort((a, b) => b[1].pnl - a[1].pnl)) {
      const wr = (data.wins / data.count * 100).toFixed(0);
      console.log(`  ${reason.padEnd(16)} ${data.count} trades | ${wr}% WR | $${data.pnl.toFixed(2)}`);
    }

    const bySignal = {};
    for (const t of this.trades) {
      if (!bySignal[t.signalType]) bySignal[t.signalType] = { count: 0, wins: 0, pnl: 0 };
      bySignal[t.signalType].count++;
      if (t.pnl > 0) bySignal[t.signalType].wins++;
      bySignal[t.signalType].pnl += t.pnl;
    }
    console.log('\n── By Signal Type ─────────────────────────────');
    for (const [type, data] of Object.entries(bySignal).sort((a, b) => b[1].pnl - a[1].pnl)) {
      const wr = (data.wins / data.count * 100).toFixed(0);
      console.log(`  ${(type || 'unknown').padEnd(24)} ${data.count} trades | ${wr}% WR | $${data.pnl.toFixed(2)}`);
    }
  }
}

// ── CLI ──
const options = { symbols: ['SOL/USDT:USDT'] };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--symbol' && args[i + 1]) options.symbols = [args[++i]];
  if (args[i] === '--from' && args[i + 1]) options.startDate = args[++i];
  if (args[i] === '--to' && args[i + 1]) options.endDate = args[++i];
  if (args[i] === '--exchange' && args[i + 1]) options.exchange = args[++i];
}

const builder = new SignalDatasetBuilder(options);
builder.run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
