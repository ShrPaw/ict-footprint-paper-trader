// ═══════════════════════════════════════════════════════════════════
// backtest.js — Precomputed + Lookup-Based Backtesting Engine v3.0
// ═══════════════════════════════════════════════════════════════════
//
// Architecture (3-layer):
//   Phase 1 — Precompute: All indicators calculated once, O(n) total
//   Phase 2 — Feature extraction: Regime, FVGs, OBs, OTE, sweeps precomputed once
//   Phase 3 — Backtest loop: Pure O(1) indexed lookups, zero heavy math
//
// Performance: O(n) total, not O(n²). ~37K iterations with instant context access.

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
import OrderFlowEngine from './OrderFlowEngine.js';
import ModelRouter from '../models/ModelRouter.js';
import ExhaustionDetector from './ExhaustionDetector.js';
import PortfolioRiskManager from './PortfolioRiskManager.js';

class Backtester {
  constructor(options = {}) {
    this.startingBalance = options.startingBalance || config.engine.startingBalance;
    this.balance = this.startingBalance;
    this.trades = [];
    this.equityCurve = [{ timestamp: 0, equity: this.startingBalance, balance: this.startingBalance }];
    this.peak = this.startingBalance;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
    this.position = null;
    this.dailyPnL = 0;
    this.dailyTradeCount = 0;
    this.lastResetDay = null;
    this.stats = null;

    // Risk tracking
    this.exhaustionBlocks = 0;
    this.portfolioRiskBlocks = 0;

    // Config
    this.symbols = options.symbols || config.symbols;
    this.startDate = options.startDate || null;
    this.endDate = options.endDate || null;
    this.verbose = options.verbose ?? false;
    this.exchangeId = options.exchange || config.data.exchange;
    this.fundingRate = options.fundingRate ?? null;
    this.fundingIntervalMs = 8 * 60 * 60 * 1000;

    // Regime time tracking
    this.regimeTimeTracker = {};
    this.totalCandlesAnalyzed = 0;

    // Signal cooldown (per-symbol)
    this.lastSignalTime = {};

    // Institutional OrderFlowEngine (6-step pipeline)
    this.orderFlowEngine = new OrderFlowEngine();

    // Per-asset Model Router (multi-model architecture)
    this.modelRouter = new ModelRouter();

    // Exhaustion detector — entry quality engine
    this.exhaustion = new ExhaustionDetector();

    // Portfolio risk manager — global risk layer
    this.portfolioRisk = new PortfolioRiskManager({
      startingBalance: this.startingBalance,
    });
  }

  async run() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   📊 BACKTEST ENGINE v3.0 — Precomputed             ║');
    console.log('║   O(n) precompute + O(1) lookup loop                ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.log(`  Exchange: ${this.exchangeId} | Symbols: ${this.symbols.join(', ')}`);
    console.log(`  Period: ${this.startDate || 'start'} → ${this.endDate || 'now'}\n`);

    const exchange = new ccxt[this.exchangeId]({ enableRateLimit: true });

    for (const symbol of this.symbols) {
      console.log(`\n── Backtesting ${symbol} ─────────────────────────`);

      try {
        // ═══════════════════════════════════════════════════════════
        // PHASE 1: DATA LOADING
        // ═══════════════════════════════════════════════════════════
        const t0 = Date.now();

        const candles15m = await this._fetchHistoricalCandles(exchange, symbol, '15m');
        const candles5m = await this._fetchHistoricalCandles(exchange, symbol, '5m');
        const candles1h = await this._fetchHistoricalCandles(exchange, symbol, '1h');

        console.log(`  📥 Data: 15m=${candles15m.length} | 5m=${candles5m.length} | 1h=${candles1h.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

        if (candles15m.length < 100 || candles1h.length < 50) {
          console.log(`  ⚠️  Not enough data, skipping`);
          continue;
        }

        // ═══════════════════════════════════════════════════════════
        // PHASE 2: PRECOMPUTE ALL INDICATORS — O(n) each
        // ═══════════════════════════════════════════════════════════
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

        const indicators15m = {
          delta: computeDelta(candles15m),
        };

        console.log(`  📐 Indicators: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

        // Set precomputed delta on OrderFlowEngine for cluster analysis
        this.orderFlowEngine.setPrecomputed(indicators15m.delta.delta, indicators15m.delta.deltaPercent);

        // ═══════════════════════════════════════════════════════════
        // PHASE 3: FEATURE EXTRACTION — Precompute domain logic
        // ═══════════════════════════════════════════════════════════
        const t2 = Date.now();

        const regimes = extractRegimes(candles1h, indicators1h);
        const fvgSignals = extractFVGs(candles1h);
        const obSignals = extractOrderBlocks(candles1h);
        const sweepSignals = extractLiquiditySweeps(candles1h);
        const oteSignals = extractOTEs(candles1h);

        console.log(`  🔍 Features: ${((Date.now() - t2) / 1000).toFixed(1)}s`);

        // Pre-compute regime time distribution from 1h candles
        for (let i = 50; i < candles1h.length; i++) {
          if (regimes[i]) {
            const r = regimes[i].regime;
            this.regimeTimeTracker[r] = (this.regimeTimeTracker[r] || 0) + 1;
            this.totalCandlesAnalyzed++;
          }
        }

        // ═══════════════════════════════════════════════════════════
        // PHASE 4: BACKTEST LOOP — O(1) per iteration, pure lookups
        // ═══════════════════════════════════════════════════════════
        const t3 = Date.now();
        let hIdx = 0;
        let signalCount = 0;

        // Pre-build 15m→1h index mapping (which 1h candle each 15m belongs to)
        const m15toH1 = new Array(candles15m.length);
        let hCursor = 0;
        for (let i = 0; i < candles15m.length; i++) {
          while (hCursor < candles1h.length - 1 && candles1h[hCursor + 1].timestamp <= candles15m[i].timestamp) {
            hCursor++;
          }
          m15toH1[i] = hCursor;
        }

        console.log(`  🔄 Starting loop (${candles15m.length} candles)...`);

        for (let i = 50; i < candles15m.length; i++) {
          const candle15m = candles15m[i];
          const timestamp = candle15m.timestamp;
          const h1Idx = m15toH1[i]; // O(1) lookup

          // Reset daily PnL and trade count
          const day = new Date(timestamp).toDateString();
          if (day !== this.lastResetDay) {
            this.dailyPnL = 0;
            this.dailyTradeCount = 0;
            this.lastResetDay = day;
          }

          // ── Check exits (no computation, just price checks) ──
          if (this.position) {
            this._checkExit(candle15m, timestamp);
          }

          // ── Generate signal — ALL precomputed, zero math ──
          if (!this.position && h1Idx >= 50) {
            const context = this._buildContext(i, h1Idx, candles15m, candles1h, indicators1h, indicators15m,
              regimes, fvgSignals, obSignals, sweepSignals, oteSignals, symbol, timestamp);

            if (context) {
              // ═══════════════════════════════════════════════════════════
              // MULTI-MODEL ARCHITECTURE: Route to per-asset model
              // Each asset has its OWN feature set, signal logic, and thresholds.
              // This is model separation, not parameter tuning.
              // ═══════════════════════════════════════════════════════════

              // Enrich context with delta array and model-expected field names
              const modelCtx = {
                ...context,
                // Map backtest field names → model-expected field names
                index1h: context.h1Idx,
                index15m: context.m15Idx,
                deltaArr: indicators15m.delta.delta,
                timestamp: candle15m.timestamp,
                profile: context.profile,
                regime: context.regime,
                regimeResult: regimes[h1Idx],
                killzone: context.killzone,
                sweepSignals: context.sweepSignals,
                obSignals: context.obSignals,
                oteSignals: context.oteSignals,
                volumeRatio: context.volumeRatio,
              };

              let signal = this.modelRouter.evaluate(symbol, modelCtx);

              // ═══════════════════════════════════════════════════════════
              // FALLBACK: Legacy + OrderFlowEngine (transition period)
              // If model returns null, try the legacy pipeline.
              // Remove this once all models are validated.
              // ═══════════════════════════════════════════════════════════
              if (!signal) {
                // Legacy ICT + Footprint signal
                const legacySignal = this._evaluateSignal(context);

                // OrderFlowEngine signal (6-step institutional pipeline)
                let ofSignal = null;
                if (config.orderFlow?.enabled !== false) {
                  const ofCtx = {
                    candles1h, candles15m,
                    index15m: i, index1h: h1Idx,
                    indicators1h: {
                      ema9: indicators1h.ema9,
                      ema21: indicators1h.ema21,
                      ema50: indicators1h.ema50,
                      atr: indicators1h.atr,
                    },
                    profile: context.profile,
                    regime: context.regime,
                    ictSignals: [
                      ...(context.fvgSignals || []),
                      ...(context.obSignals || []),
                      ...(context.sweepSignals || []),
                      ...(context.oteSignals || []),
                    ].filter(s => s.type !== 'FVG'),
                    oteSignals: context.oteSignals,
                    sweepSignals: context.sweepSignals,
                  };

                  const ofResult = this.orderFlowEngine.evaluate(ofCtx);
                  if (ofResult.signal) {
                    ofSignal = {
                      ...ofResult.signal,
                      source: 'order_flow',
                      combinedScore: ofResult.signal.confidence,
                    };
                  }
                }

                // Pick best legacy signal
                if (ofSignal && legacySignal) {
                  signal = ofSignal.combinedScore >= legacySignal.combinedScore ? ofSignal : legacySignal;
                } else {
                  signal = ofSignal || legacySignal;
                }

                if (signal) signal.source = signal.source || 'legacy_fallback';
              }

              if (signal) {
                // ═══════════════════════════════════════════════════════════
                // EXHAUSTION GATE: Block entries in exhaustion zones
                // Prevents the core failure mode: confusing exhaustion for momentum
                // ═══════════════════════════════════════════════════════════
                const exhaustionResult = this.exhaustion.check({
                  ...context,
                  ...modelCtx,
                  atrZ: this._computeATRz(indicators1h.atr, h1Idx),
                });

                if (exhaustionResult.blocked) {
                  signal = null; // Hard block
                  this.exhaustionBlocks++;
                }
              }

              if (signal) {
                // ═══════════════════════════════════════════════════════════
                // PORTFOLIO RISK: Global risk validation before entry
                // ═══════════════════════════════════════════════════════════
                const riskResult = this.portfolioRisk.validate(symbol, signal, {
                  balance: this.balance,
                  activePositions: this.position ? [this.position] : [],
                });

                if (!riskResult.allowed) {
                  signal = null; // Portfolio risk blocked
                  this.portfolioRiskBlocks++;
                } else if (riskResult.adjustments.positionSizeMultiplier) {
                  // Apply position size adjustment from risk manager
                  signal._riskSizeMultiplier = riskResult.adjustments.positionSizeMultiplier;
                }
              }

              if (signal) {
                this._openPosition(symbol, signal, candle15m.close, timestamp);
                signalCount++;
              }
            }
          }

          // Track equity
          const unrealizedPnL = this.position ? this._calcUnrealizedPnL(candle15m.close) : 0;
          const equity = this.balance + unrealizedPnL;
          this.equityCurve.push({ timestamp, equity, balance: this.balance });

          if (equity > this.peak) this.peak = equity;
          const dd = (this.peak - equity) / this.peak;
          if (dd > this.maxDrawdownPercent) {
            this.maxDrawdownPercent = dd;
            this.maxDrawdown = this.peak - equity;
          }

          // Progress
          if (i % 10000 === 0) {
            const pct = ((i / candles15m.length) * 100).toFixed(0);
            console.log(`  ⏳ ${pct}% (${i}/${candles15m.length}) | trades: ${this.trades.length} | signals: ${signalCount} | bal: $${this.balance.toFixed(0)}`);
          }
        }

        // Close remaining position
        if (this.position) {
          const lastCandle = candles15m[candles15m.length - 1];
          this._closePosition(lastCandle.close, lastCandle.timestamp, 'backtest_end');
        }

        console.log(`  ✅ Loop done: ${((Date.now() - t3) / 1000).toFixed(1)}s | ${signalCount} signals | ${this.trades.length} trades`);

      } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
      }
    }

    this._computeStats();
    this._printReport();
    this._exportResults();

    return this.stats;
  }

  // ═══════════════════════════════════════════════════════════════
  // CONTEXT BUILDER — Gathers all precomputed data for current candle
  // ═══════════════════════════════════════════════════════════════

  _buildContext(m15Idx, h1Idx, candles15m, candles1h, indicators1h, indicators15m,
    regimes, fvgSignals, obSignals, sweepSignals, oteSignals, symbol, timestamp) {

    const regimeData = regimes[h1Idx];
    if (!regimeData) return null;

    const regime = regimeData.regime;
    const profile = getProfile(symbol);

    // Killzone check (lightweight — just hour math)
    const killzone = this._checkKillzone(timestamp);
    if (!killzone.allowed) return null;

    // Session hard-gate — per-asset allowed sessions (if configured)
    if (profile.allowedSessions && !profile.allowedSessions.includes(killzone.session)) {
      return null;
    }

    // Weekend filter
    const day = new Date(timestamp).getUTCDay();
    if (day === 0 || day === 6) return null;

    // Regime filtering — fully per-asset via blockedRegimes in assetProfiles.js
    // LOW_VOL + TRENDING_DOWN now in each profile's blockedRegimes (was global before)
    if (profile.blockedRegimes?.includes(regime)) return null;

    // EMA alignment (direct array lookup)
    const price = candles1h[h1Idx].close;
    const ema21 = indicators1h.ema21[h1Idx];
    const ema50 = indicators1h.ema50[h1Idx];
    const bullish = price > ema21 && price > ema50;
    const bearish = price < ema21 && price < ema50;
    if (!bullish && !bearish) return null;

    // Cooldown check
    const lastTime = this.lastSignalTime[symbol];
    if (lastTime && timestamp - lastTime < config.strategy.signalCooldown) return null;

    // Build context object — everything is a precomputed lookup
    return {
      symbol, price, timestamp, m15Idx, h1Idx,
      regime, regimeData, profile, killzone,
      bullish, bearish,
      // Indicators (O(1) array access)
      ema9: indicators1h.ema9[h1Idx],
      ema21, ema50,
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
      // Array refs for divergence detection (zero-cost — just pointers)
      _allDeltas: indicators15m.delta.delta,
      _allPrices: candles15m,
      // Features (precomputed signal arrays, O(1) access)
      fvgSignals: fvgSignals[h1Idx],
      obSignals: obSignals[h1Idx],
      sweepSignals: sweepSignals[h1Idx],
      oteSignals: oteSignals[h1Idx],
      // For OrderFlowEngine — pass candle arrays + indices
      candles1h, candles15m, indicators1h,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SIGNAL EVALUATOR — Pure logic, zero computation
  // Reproduces exact scoring from DaytradeMode._scoreSignal()
  // ═══════════════════════════════════════════════════════════════

  _evaluateSignal(ctx) {
    const ictWeight = ctx.profile.daytrade.ictWeight;
    const fpWeight = ctx.profile.daytrade.footprintWeight;

    // Collect all available signals
    const allScored = [];

    // ICT signals from precomputed arrays
    const ictSignals = [];
    if (ctx.fvgSignals) ictSignals.push(...ctx.fvgSignals);
    if (ctx.obSignals) ictSignals.push(...ctx.obSignals);
    if (ctx.sweepSignals) ictSignals.push(...ctx.sweepSignals);
    if (ctx.oteSignals) ictSignals.push(...ctx.oteSignals);

    for (const sig of ictSignals) {
      if (sig.type === 'FVG') continue; // FVG killed — 24% WR
      // Raw confidence scoring — matches live DaytradeMode._scoreSignal()
      if (sig.type === 'ORDER_BLOCK') {
        allScored.push({ ...sig, combinedScore: sig.confidence * 0.5, source: 'ict' });
        continue;
      }
      allScored.push({ ...sig, combinedScore: sig.confidence, source: 'ict' });
    }

    // Footprint signals from precomputed delta
    if (ctx.delta !== undefined) {
      const divSignal = this._checkDeltaDivergence(ctx);
      if (divSignal) {
        let score = divSignal.confidence;
        if (divSignal.type === 'DELTA_DIVERGENCE') score *= 1.5;
        allScored.push({ ...divSignal, combinedScore: score, source: 'footprint' });
      }
    }

    if (allScored.length === 0) return null;

    // Sort by score, pick best
    allScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = allScored[0];

    // Direction filter
    if (best.action === 'buy' && !ctx.bullish) return null;
    if (best.action === 'sell' && !ctx.bearish) return null;

    // Regime boosts (exact same multipliers as DaytradeMode)
    if (best.source === 'ict' && (ctx.regime === 'TRENDING_UP' || ctx.regime === 'TRENDING_DOWN')) {
      best.combinedScore *= 1.3;
    }
    if (best.type === 'DELTA_DIVERGENCE' && ctx.regime === 'ABSORPTION') {
      best.combinedScore *= 1.3;
    }
    if (best.type === 'STACKED_IMBALANCE' && (ctx.regime === 'TRENDING_UP' || ctx.regime === 'TRENDING_DOWN')) {
      best.combinedScore *= 1.4;
    }

    // Session weight
    const sessionWeight = ctx.profile.sessionWeights[ctx.killzone.session] || 1.0;
    best.combinedScore *= sessionWeight;

    // Regime-specific threshold multiplier
    // VOL_EXP: higher bar — these trades produce emergency stops
    // TRENDING_UP: lower bar — ICT works better in trends
    const regimeMultipliers = {
      VOL_EXPANSION: 0.90,  // +11% effective threshold — filter noise
      TRENDING_UP: 1.05,    // -5% effective threshold — ICT edge in trends
      RANGING: 0.95,         // +5% — moderate bar
      TRENDING_DOWN: 0.90,  // globally blocked anyway, but just in case
      LOW_VOL: 1.0,
    };
    best.combinedScore *= (regimeMultipliers[ctx.regime] ?? 1.0);

    // Confluence check (cross-source)
    const confluenceSignals = allScored.filter(s => s.action === best.action && s.source !== best.source);
    const hasConfluence = confluenceSignals.length > 0;

    // Per-asset thresholds (fallback to global config if not set)
    const minConfluenceScore = ctx.profile.daytrade.minConfluenceScore ?? config.strategy.minConfluenceScore;
    const minSoloScore = ctx.profile.daytrade.minSoloScore ?? config.strategy.minSoloScore;

    if (hasConfluence) {
      best.combinedScore += config.strategy.confluenceBonus;
      best.confluence = true;
      best.reason = `${best.reason} (+ ${confluenceSignals[0].type} confluence)`;
      if (best.combinedScore >= minConfluenceScore) {
        return this._buildTradeSignal(ctx, best);
      }
    }

    // OB requires confluence
    if (best.type === 'ORDER_BLOCK' && !hasConfluence) return null;

    // Solo score threshold — per-asset
    if (best.combinedScore >= minSoloScore) {
      return this._buildTradeSignal(ctx, best);
    }

    return null;
  }

  _buildTradeSignal(ctx, best) {
    const atr = ctx.atr;
    const slMult = (ctx.profile.riskOverrides?.slMultiplier ?? config.risk[ctx.regime]?.slMultiplier ?? 0.9) * ctx.profile.slTightness;
    const tpMult = config.risk[ctx.regime]?.tpMultiplier || 2.5;

    const sl = best.action === 'buy'
      ? ctx.price - atr * slMult
      : ctx.price + atr * slMult;

    const tp = best.action === 'buy'
      ? ctx.price + atr * tpMult
      : ctx.price - atr * tpMult;

    this.lastSignalTime[ctx.symbol] = ctx.timestamp;

    return {
      ...best,
      mode: 'DAYTRADE',
      regime: ctx.regime,
      regimeConfidence: ctx.regimeData.confidence,
      price: ctx.price,
      stopLoss: sl,
      takeProfit: tp,
      atr,
      isWeekend: false,
      assetProfile: ctx.profile.name,
      profile: ctx.profile,
      session: ctx.killzone.session,
    };
  }

  /**
   * Delta divergence check — uses precomputed delta history.
   * Matches RealFootprintAnalyzer._detectDeltaDivergence() logic:
   * compares 10-candle price trend vs 10-candle delta trend.
   */
  _checkDeltaDivergence(ctx) {
    const signals = [];
    const lookback = 10;

    // Get delta history from precomputed arrays
    const deltaHistory = [];
    const priceHistory = [];
    for (let j = Math.max(0, ctx.m15Idx - lookback + 1); j <= ctx.m15Idx; j++) {
      deltaHistory.push(ctx._allDeltas?.[j] ?? 0);
      priceHistory.push(ctx._allPrices?.[j]?.close ?? ctx.price);
    }

    if (deltaHistory.length < 5) return null;

    const priceRising = priceHistory[priceHistory.length - 1] > priceHistory[0];
    const deltaRising = deltaHistory[deltaHistory.length - 1] > deltaHistory[0];

    // Divergence: price and delta moving in opposite directions
    if (priceRising && !deltaRising) {
      const strength = this._divergenceStrength(deltaHistory);
      return {
        type: 'DELTA_DIVERGENCE',
        direction: 'bearish',
        action: 'sell',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bearish delta divergence — price rising but buying pressure fading',
      };
    }

    if (!priceRising && deltaRising && ctx.bearish) {
      const strength = this._divergenceStrength(deltaHistory);
      return {
        type: 'DELTA_DIVERGENCE',
        direction: 'bullish',
        action: 'buy',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bullish delta divergence — price falling but buying pressure building',
      };
    }

    // Stacked imbalance: extreme delta for current candle
    if (Math.abs(ctx.deltaPercent) > 60) {
      return {
        type: 'STACKED_IMBALANCE',
        direction: ctx.deltaPercent > 0 ? 'bullish' : 'bearish',
        action: ctx.deltaPercent > 0 ? 'buy' : 'sell',
        confidence: 0.5,
        reason: `Extreme delta imbalance: ${ctx.deltaPercent.toFixed(1)}%`,
      };
    }

    return null;
  }

  _divergenceStrength(deltas) {
    const max = Math.max(...deltas.map(Math.abs));
    if (max === 0) return 0;
    const last = Math.abs(deltas[deltas.length - 1]);
    const avg = deltas.reduce((a, b) => a + Math.abs(b), 0) / deltas.length;
    return Math.min(last / avg, 2.0);
  }

  // ═══════════════════════════════════════════════════════════════
  // POSITION MANAGEMENT — Unchanged logic, lightweight
  // ═══════════════════════════════════════════════════════════════

  _openPosition(symbol, signal, price, timestamp) {
    const riskParams = config.risk[signal.regime] || config.risk.RANGING;
    const slDistance = Math.abs(price - signal.stopLoss);
    if (slDistance === 0) return;

    const riskPercent = riskParams.riskPercent * (signal.profile?.riskMultiplier ?? 1.0);
    const riskAmount = this.balance * (riskPercent / 100);
    let size = riskAmount / slDistance;

    // Apply portfolio risk position size multiplier (confidence decay, DD proximity, etc.)
    if (signal._riskSizeMultiplier) {
      size *= signal._riskSizeMultiplier;
    }
    // Maker fee for entries — limit orders at mid ± offset.
    // Taker fee for exits (urgent). Saves ~60% on entry fees.
    const entrySlippageRate = config.engine.slippageByRegime?.[signal.regime] ?? config.engine.slippage;
    const slippage = price * entrySlippageRate * (signal.action === 'buy' ? 1 : -1);
    const fillPrice = price + slippage;
    const fee = size * fillPrice * config.engine.makerFee;
    const margin = (size * fillPrice) / 10;

    if (margin + fee > this.balance) return;
    if (Math.abs(this.dailyPnL) / this.startingBalance >= config.engine.maxDailyLoss) return;
    if (this.dailyTradeCount >= config.engine.maxDailyTrades) return;

    this.dailyTradeCount++;
    this.position = {
      symbol,
      side: signal.action === 'buy' ? 'long' : 'short',
      size,
      entryPrice: fillPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      regime: signal.regime,
      reason: signal.reason || signal.type,
      signalType: signal.type,
      signalSource: signal.source || 'unknown',
      mode: signal.mode || 'DAYTRADE',
      entryTime: timestamp,
      fee,
      atr: signal.atr || Math.abs(signal.takeProfit - fillPrice) / 2,
      highestPrice: fillPrice,
      lowestPrice: fillPrice,
      breakevenTriggered: false,
      trailingActive: false,
      isWeekend: signal.isWeekend || false,
      entryPattern: signal.entryPattern || null,
      partialTPDone: false,
      originalSize: size,
      assetProfile: signal.assetProfile || 'unknown',
      profile: signal.profile || null,  // per-asset risk overrides
    };

    this.balance -= fee;

    if (this.verbose) {
      const emoji = signal.action === 'buy' ? '📈' : '📉';
      console.log(`  ${emoji} ${signal.action.toUpperCase()} ${symbol} @ ${fillPrice.toFixed(4)} | SL: ${signal.stopLoss.toFixed(4)} | TP: ${signal.takeProfit.toFixed(4)} | ${signal.regime}`);
    }
  }

  _checkExit(candle, timestamp) {
    const pos = this.position;
    const price = candle.close;
    const side = pos.side;

    if (side === 'long') {
      if (candle.high > pos.highestPrice) pos.highestPrice = candle.high;
    } else {
      if (candle.low < pos.lowestPrice) pos.lowestPrice = candle.low;
    }

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
        const partialSlippageRate = config.engine.slippageByRegime?.[pos.regime] ?? config.engine.slippage;
        const slippage = tp1Price * partialSlippageRate * (side === 'long' ? -1 : 1);
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
          mode: pos.mode, reason: pos.reason,
          pnl: partialPnL, pnlPercent: partialPnL / (partialSize * pos.entryPrice) * 100,
          totalFees: pos.fee * closePercent + fee,
          duration: timestamp - pos.entryTime,
          durationMin: Math.round((timestamp - pos.entryTime) / 60000),
          isWeekend: pos.isWeekend, entryPattern: pos.entryPattern,
          assetProfile: pos.assetProfile,
        });

        pos.size = remainingSize;
        pos.fee *= (1 - closePercent);
        pos.partialTPDone = true;
      }
    }

    // Trailing stop — per-asset override
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
        if (side === 'long') {
          const newSL = pos.highestPrice - trailDist;
          if (newSL > pos.stopLoss) pos.stopLoss = newSL;
        } else {
          const newSL = pos.lowestPrice + trailDist;
          if (newSL < pos.stopLoss) pos.stopLoss = newSL;
        }
      }
    }

    // Breakeven — per-asset override
    if (config.engine.breakeven?.enabled && !pos.breakevenTriggered) {
      const beActivationATR = ro?.breakeven?.activationATR ?? config.engine.breakeven.activationATR;
      const beDist = pos.atr * beActivationATR;
      const offset = pos.entryPrice * (config.engine.breakeven.offset || 0);

      if (side === 'long' && candle.high >= pos.entryPrice + beDist) {
        pos.stopLoss = pos.entryPrice + offset;
        pos.breakevenTriggered = true;
      } else if (side === 'short' && candle.low <= pos.entryPrice - beDist) {
        pos.stopLoss = pos.entryPrice - offset;
        pos.breakevenTriggered = true;
      }
    }

    // SL check — EMERGENCY CIRCUIT BREAKER ONLY (per-asset, default 12 ATR)
    // Regular SL removed: stop_loss has 0% WR — pure noise trap.
    // Trailing stops and partial TP handle all exits.
    // Configurable per-asset via riskOverrides.emergencyATR.
    const emergencyATR = pos.profile?.riskOverrides?.emergencyATR ?? 12.0;
    const emergencyDist = pos.atr * emergencyATR;
    const emergencySL = side === 'long'
      ? pos.entryPrice - emergencyDist
      : pos.entryPrice + emergencyDist;

    if (side === 'long' && candle.low <= emergencySL) {
      this._closePosition(emergencySL, timestamp, 'emergency_stop');
      return;
    }
    if (side === 'short' && candle.high >= emergencySL) {
      this._closePosition(emergencySL, timestamp, 'emergency_stop');
      return;
    }

    // TP check
    if (side === 'long' && candle.high >= pos.takeProfit) {
      this._closePosition(pos.takeProfit, timestamp, 'take_profit');
      return;
    }
    if (side === 'short' && candle.low <= pos.takeProfit) {
      this._closePosition(pos.takeProfit, timestamp, 'take_profit');
      return;
    }

    // Time exits REMOVED — 0% WR, -$16,205 bleed. Let trailing stops handle recovery.
  }

  _closePosition(price, timestamp, reason) {
    const pos = this.position;
    const exitSlippageRate = config.engine.slippageByRegime?.[pos.regime] ?? config.engine.slippage;
    const slippage = price * exitSlippageRate * (pos.side === 'long' ? -1 : 1);
    const fillPrice = price + slippage;
    const fee = pos.size * fillPrice * config.engine.takerFee;
    const priceDiff = pos.side === 'long' ? fillPrice - pos.entryPrice : pos.entryPrice - fillPrice;
    let pnl = priceDiff * pos.size - pos.fee - fee;

    // Funding rate
    let fundingCost = 0;
    if (this.fundingRate !== null) {
      const duration = timestamp - pos.entryTime;
      const fundingPeriods = Math.floor(duration / this.fundingIntervalMs);
      const notional = pos.size * pos.entryPrice;
      fundingCost = notional * this.fundingRate * fundingPeriods * (pos.side === 'long' ? 1 : -1);
      pnl -= fundingCost;
    }

    this.balance += pnl;
    this.dailyPnL += pnl;

    const trade = {
      symbol: pos.symbol, side: pos.side, size: pos.size,
      entryPrice: pos.entryPrice, exitPrice: fillPrice,
      entryTime: pos.entryTime, exitTime: timestamp,
      closeReason: reason, regime: pos.regime, signalType: pos.signalType,
      mode: pos.mode, reason: pos.reason,
      pnl, pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
      totalFees: pos.fee + fee,
      duration: timestamp - pos.entryTime,
      durationMin: Math.round((timestamp - pos.entryTime) / 60000),
      isWeekend: pos.isWeekend, entryPattern: pos.entryPattern,
      assetProfile: pos.assetProfile,
      fundingCost: this.fundingRate !== null ? fundingCost : undefined,
      balance: this.balance,
    };

    this.trades.push(trade);

    // Record with portfolio risk manager for global risk tracking
    this.portfolioRisk.recordTrade(pos.symbol, trade);

    this.position = null;

    if (this.verbose) {
      const emoji = pnl >= 0 ? '✅' : '❌';
      console.log(`  ${emoji} CLOSE ${this.trades[this.trades.length-1].side.toUpperCase()} @ ${fillPrice.toFixed(4)} | PnL: $${pnl.toFixed(2)} | ${reason}`);
    }
  }

  _calcUnrealizedPnL(currentPrice) {
    if (!this.position) return 0;
    return this.position.side === 'long'
      ? (currentPrice - this.position.entryPrice) * this.position.size
      : (this.position.entryPrice - currentPrice) * this.position.size;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Compute ATR z-score for exhaustion detection.
   * Returns how many standard deviations the current ATR is from its mean.
   */
  _computeATRz(atrArray, index, lookback = 50) {
    if (!atrArray || index == null || index < lookback) return 0;

    const currentATR = atrArray[index];
    if (!currentATR || currentATR === 0) return 0;

    let sum = 0, sumSq = 0;
    const start = Math.max(0, index - lookback);
    const count = index - start + 1;

    for (let j = start; j <= index; j++) {
      const v = atrArray[j] || 0;
      sum += v;
      sumSq += v * v;
    }

    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    const std = Math.sqrt(variance);

    return std > 0 ? (currentATR - mean) / std : 0;
  }

  _checkKillzone(timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
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

  async _fetchHistoricalCandles(exchange, symbol, timeframe) {
    const allCandles = [];
    let since = this.startDate ? new Date(this.startDate).getTime() : undefined;
    const endTime = this.endDate ? new Date(this.endDate).getTime() : Date.now();
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

  // ═══════════════════════════════════════════════════════════════
  // STATS & REPORTING — Unchanged from v2
  // ═══════════════════════════════════════════════════════════════

  _computeStats() {
    const trades = this.trades;
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
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // Sharpe
    const dayMap = {};
    for (const point of this.equityCurve) {
      const day = new Date(point.timestamp).toDateString();
      dayMap[day] = point.equity;
    }
    const days = Object.values(dayMap);
    const dailyReturns = [];
    for (let i = 1; i < days.length; i++) dailyReturns.push((days[i] - days[i - 1]) / days[i - 1]);
    const avgReturn = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdDev = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1)) : 0;
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;

    // Breakdowns
    const byRegime = {}, bySignal = {}, byExit = {}, byMode = {}, byAsset = {}, bySource = {};
    for (const t of trades) {
      for (const [group, key] of [[byRegime, t.regime], [bySignal, t.signalType || 'unknown'],
        [byExit, t.closeReason], [byMode, t.mode || 'UNKNOWN'], [byAsset, t.assetProfile || t.symbol?.split('/')[0] || 'unknown'],
        [bySource, t.signalSource || 'unknown']]) {
        if (!group[key]) group[key] = { trades: 0, wins: 0, pnl: 0 };
        group[key].trades++;
        if (t.pnl > 0) group[key].wins++;
        group[key].pnl += t.pnl;
      }
    }

    // Year-by-year
    const byYear = {};
    for (const t of trades) {
      const year = new Date(t.entryTime).getFullYear();
      if (!byYear[year]) byYear[year] = { trades: 0, wins: 0, pnl: 0, fees: 0, funding: 0 };
      byYear[year].trades++;
      if (t.pnl > 0) byYear[year].wins++;
      byYear[year].pnl += t.pnl;
      byYear[year].fees += t.totalFees;
      if (t.fundingCost) byYear[year].funding += t.fundingCost;
    }

    // Monthly
    const byMonth = {};
    for (const t of trades) {
      const key = new Date(t.entryTime).toISOString().slice(0, 7);
      if (!byMonth[key]) byMonth[key] = { trades: 0, wins: 0, pnl: 0 };
      byMonth[key].trades++;
      if (t.pnl > 0) byMonth[key].wins++;
      byMonth[key].pnl += t.pnl;
    }

    const monthlyPnls = Object.values(byMonth).map(m => m.pnl);
    const sortedMonthly = [...monthlyPnls].sort((a, b) => a - b);
    const profitableMonths = monthlyPnls.filter(p => p > 0).length;

    // Consecutive streaks
    let maxConsecWins = 0, maxConsecLosses = 0, curWins = 0, curLosses = 0;
    for (const t of trades) {
      if (t.pnl > 0) { curWins++; curLosses = 0; } else { curLosses++; curWins = 0; }
      maxConsecWins = Math.max(maxConsecWins, curWins);
      maxConsecLosses = Math.max(maxConsecLosses, curLosses);
    }

    const largestWin = wins.length ? Math.max(...wins.map(t => t.pnl)) : 0;

    // Regime distribution
    const regimeDistribution = {};
    for (const [regime, count] of Object.entries(this.regimeTimeTracker)) {
      regimeDistribution[regime] = {
        candles: count,
        percent: this.totalCandlesAnalyzed > 0 ? ((count / this.totalCandlesAnalyzed) * 100).toFixed(1) : '0',
      };
    }

    const totalFunding = trades.reduce((s, t) => s + (t.fundingCost || 0), 0);
    const weekendTrades = trades.filter(t => t.isWeekend);
    const weekdayTrades = trades.filter(t => !t.isWeekend);

    this.stats = {
      startingBalance: this.startingBalance,
      finalBalance: this.balance,
      totalPnL, totalPnLPercent: ((this.balance - this.startingBalance) / this.startingBalance) * 100,
      totalTrades: trades.length, wins: wins.length, losses: losses.length,
      winRate: (winRate * 100).toFixed(1),
      grossProfit, grossLoss,
      profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
      expectancy: expectancy.toFixed(2),
      avgWin: avgWin.toFixed(2), avgLoss: avgLoss.toFixed(2),
      largestWin: largestWin.toFixed(2),
      largestLoss: losses.length ? Math.min(...losses.map(t => t.pnl)).toFixed(2) : 0,
      pnlWithoutLargest: (totalPnL - largestWin).toFixed(2),
      maxDrawdown: this.maxDrawdown.toFixed(2),
      maxDrawdownPercent: (this.maxDrawdownPercent * 100).toFixed(2),
      sharpeRatio: sharpe.toFixed(2),
      maxConsecutiveWins: maxConsecWins,
      maxConsecutiveLosses: maxConsecLosses,
      totalFees: totalFees.toFixed(2),
      totalFunding: totalFunding.toFixed(4),
      fundingRateUsed: this.fundingRate,
      byRegime, bySignal, byExit, byMode, byAsset, bySource,
      byYear,
      byMonth,
      monthlyStats: {
        median: sortedMonthly.length > 0 ? sortedMonthly[Math.floor(sortedMonthly.length / 2)].toFixed(2) : '0',
        profitableMonths,
        totalMonths: monthlyPnls.length,
        winRate: monthlyPnls.length > 0 ? ((profitableMonths / monthlyPnls.length) * 100).toFixed(0) : '0',
        best: sortedMonthly.length > 0 ? sortedMonthly[sortedMonthly.length - 1].toFixed(2) : '0',
        worst: sortedMonthly.length > 0 ? sortedMonthly[0].toFixed(2) : '0',
      },
      regimeDistribution,
      weekend: {
        trades: weekendTrades.length,
        wins: weekendTrades.filter(t => t.pnl > 0).length,
        winRate: weekendTrades.length ? ((weekendTrades.filter(t => t.pnl > 0).length / weekendTrades.length) * 100).toFixed(1) : '0',
        pnl: weekendTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      },
      weekday: {
        trades: weekdayTrades.length,
        wins: weekdayTrades.filter(t => t.pnl > 0).length,
        winRate: weekdayTrades.length ? ((weekdayTrades.filter(t => t.pnl > 0).length / weekdayTrades.length) * 100).toFixed(1) : '0',
        pnl: weekdayTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      },
    };
  }

  _printReport() {
    const s = this.stats;
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   📊 BACKTEST REPORT v3.0                            ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    console.log('── Performance ───────────────────────────────────');
    console.log(`  Starting:  $${s.startingBalance.toFixed(2)}  →  Final: $${s.finalBalance.toFixed(2)}`);
    console.log(`  PnL:       $${s.totalPnL.toFixed(2)} (${s.totalPnLPercent}%)`);
    console.log(`  Fees:      $${s.totalFees}`);

    console.log('\n── Trade Stats ───────────────────────────────────');
    console.log(`  Trades:    ${s.totalTrades} (${s.wins}W / ${s.losses}L)`);
    console.log(`  Win Rate:  ${s.winRate}%`);
    console.log(`  PF:        ${s.profitFactor} | Expectancy: $${s.expectancy}/trade`);
    console.log(`  Avg Win:   $${s.avgWin} | Avg Loss: $${s.avgLoss}`);
    console.log(`  Best:      $${s.largestWin} | Worst: $${s.largestLoss}`);
    console.log(`  Max DD:    $${s.maxDrawdown} (${s.maxDrawdownPercent}%)`);
    console.log(`  Sharpe:    ${s.sharpeRatio}`);
    console.log(`  Streaks:   ${s.maxConsecutiveWins}W / ${s.maxConsecutiveLosses}L`);

    console.log('\n── By Asset ──────────────────────────────────────');
    for (const [asset, data] of Object.entries(s.byAsset)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${asset.padEnd(8)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Source (Model vs Legacy) ──────────────────');
    for (const [source, data] of Object.entries(s.bySource)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${source.padEnd(24)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Regime ─────────────────────────────────────');
    for (const [regime, data] of Object.entries(s.byRegime)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${regime.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Exit Reason ────────────────────────────────');
    for (const [reason, data] of Object.entries(s.byExit)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${reason.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── Year-by-Year PnL ─────────────────────────────');
    for (const [year, data] of Object.entries(s.byYear).sort()) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      const fundInfo = s.fundingRateUsed !== null ? ` | Fund: $${data.funding.toFixed(2)}` : '';
      console.log(`  ${year}  ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2).padStart(10)} | Fees: $${data.fees.toFixed(2)}${fundInfo}`);
    }

    console.log('\n── Monthly Returns ──────────────────────────────');
    for (const [month, data] of Object.entries(s.byMonth).sort()) {
      const emoji = data.pnl >= 0 ? '🟢' : '🔴';
      console.log(`  ${emoji} ${month}  ${String(data.trades).padStart(3)} trades | ${data.wins}W | PnL: $${data.pnl.toFixed(2).padStart(8)}`);
    }
    console.log(`  Median: $${s.monthlyStats.median}/mo | ${s.monthlyStats.profitableMonths}/${s.monthlyStats.totalMonths} profitable (${s.monthlyStats.winRate}%)`);
    console.log(`  Best: $${s.monthlyStats.best} | Worst: $${s.monthlyStats.worst}`);

    console.log('\n── Regime Time Distribution ─────────────────────');
    for (const [regime, data] of Object.entries(s.regimeDistribution).sort((a, b) => b[1].candles - a[1].candles)) {
      const bar = '█'.repeat(Math.round(parseFloat(data.percent) / 2));
      console.log(`  ${regime.padEnd(16)} ${data.percent.padStart(5)}% ${bar}`);
    }

    if (s.fundingRateUsed !== null) {
      console.log(`\n── Funding Rate Impact ──────────────────────────`);
      console.log(`  Rate: ${(s.fundingRateUsed * 100).toFixed(4)}% per 8h (${(s.fundingRateUsed * 3 * 365 * 100).toFixed(1)}% annualized)`);
      console.log(`  Total funding cost: $${s.totalFunding}`);
    }

    console.log(`\n── Robustness Checks ────────────────────────────`);
    console.log(`  Largest win: $${s.largestWin} | PnL without it: $${s.pnlWithoutLargest}`);
    if (parseFloat(s.pnlWithoutLargest) < 0) {
      console.log(`  ⚠️  System is NEGATIVE without largest single trade!`);
    } else {
      console.log(`  ✅ System remains profitable without largest trade`);
    }
    console.log(`  Max consecutive losses: ${s.maxConsecutiveLosses} | Max consecutive wins: ${s.maxConsecutiveWins}`);

    console.log('\n── Risk Management ───────────────────────────────');
    console.log(`  Exhaustion blocks:  ${this.exhaustionBlocks} (entries rejected as exhaustion)`);
    console.log(`  Portfolio blocks:   ${this.portfolioRiskBlocks} (entries rejected by risk manager)`);
    const totalBlocks = this.exhaustionBlocks + this.portfolioRiskBlocks;
    const totalAttempted = s.totalTrades + totalBlocks;
    const filterRate = totalAttempted > 0 ? ((totalBlocks / totalAttempted) * 100).toFixed(1) : '0';
    console.log(`  Filter rate:        ${filterRate}% (${totalBlocks}/${totalAttempted} potential trades blocked)`);
    const riskState = this.portfolioRisk.getRiskState();
    console.log(`  Final risk level:   ${riskState.riskLevel}`);
    console.log(`  Emergency stops:    ${riskState.emergencyStopsLast24h} (last 24h window)`);

    // Emergency stop analysis
    const emergencyTrades = this.trades.filter(t => t.closeReason === 'emergency_stop');
    if (emergencyTrades.length > 0) {
      const emergencyPnL = emergencyTrades.reduce((s, t) => s + t.pnl, 0);
      const avgLoss = emergencyPnL / emergencyTrades.length;
      console.log(`  Emergency analysis: ${emergencyTrades.length} stops | Total: $${emergencyPnL.toFixed(2)} | Avg: $${avgLoss.toFixed(2)}/stop`);

      // Regime breakdown of emergency stops
      const byRegime = {};
      for (const t of emergencyTrades) {
        if (!byRegime[t.regime]) byRegime[t.regime] = { count: 0, pnl: 0 };
        byRegime[t.regime].count++;
        byRegime[t.regime].pnl += t.pnl;
      }
      for (const [regime, data] of Object.entries(byRegime)) {
        console.log(`    ${regime.padEnd(16)} ${data.count} stops | $${data.pnl.toFixed(2)}`);
      }
    }

    console.log('\n── Last 10 Trades ────────────────────────────────');
    for (const t of this.trades.slice(-10)) {
      const emoji = t.pnl >= 0 ? '✅' : '❌';
      const date = new Date(t.entryTime).toISOString().slice(0, 16);
      console.log(`  ${emoji} ${date} ${(t.mode || '').padEnd(10)} ${t.side.toUpperCase().padEnd(5)} ${(t.assetProfile || '').padEnd(4)} PnL: $${t.pnl.toFixed(2).padStart(8)} ${t.closeReason}`);
    }

    console.log('\n');
  }

  _exportResults() {
    const outputDir = path.join(process.cwd(), 'backtest-results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const tradesCSV = [
      'symbol,side,mode,assetProfile,entryPrice,exitPrice,entryTime,exitTime,pnl,pnlPercent,regime,signalType,closeReason,durationMin,totalFees,isWeekend,entryPattern',
      ...this.trades.map(t =>
        `${t.symbol},${t.side},${t.mode},${t.assetProfile},${t.entryPrice},${t.exitPrice},${new Date(t.entryTime).toISOString()},${new Date(t.exitTime).toISOString()},${t.pnl.toFixed(4)},${t.pnlPercent.toFixed(4)},${t.regime},${t.signalType},${t.closeReason},${t.durationMin},${t.totalFees.toFixed(4)},${t.isWeekend},${t.entryPattern || ''}`
      ),
    ].join('\n');
    fs.writeFileSync(path.join(outputDir, `trades-${timestamp}.csv`), tradesCSV);

    const equityCSV = [
      'timestamp,equity,balance',
      ...this.equityCurve.map(e =>
        `${new Date(e.timestamp).toISOString()},${e.equity.toFixed(2)},${e.balance.toFixed(2)}`
      ),
    ].join('\n');
    fs.writeFileSync(path.join(outputDir, `equity-${timestamp}.csv`), equityCSV);

    fs.writeFileSync(path.join(outputDir, `stats-${timestamp}.json`), JSON.stringify(this.stats, null, 2));

    console.log(`📁 Results exported to backtest-results/`);
  }
}

// ── CLI ──
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--symbol' && args[i + 1]) options.symbols = [args[++i]];
  if (args[i] === '--from' && args[i + 1]) options.startDate = args[++i];
  if (args[i] === '--to' && args[i + 1]) options.endDate = args[++i];
  if (args[i] === '--balance' && args[i + 1]) options.startingBalance = parseFloat(args[++i]);
  if (args[i] === '--exchange' && args[i + 1]) options.exchange = args[++i];
  if (args[i] === '--verbose' || args[i] === '-v') options.verbose = true;
  if (args[i] === '--funding' && args[i + 1]) options.fundingRate = parseFloat(args[++i]);
}

const bt = new Backtester(options);
bt.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
