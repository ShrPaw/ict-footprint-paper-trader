// ═══════════════════════════════════════════════════════════════════
// PortfolioRiskManager.js — Global Risk Layer
// ═══════════════════════════════════════════════════════════════════
//
// PURPOSE: System-level risk control that OVERRIDES all models.
//
// Each bot runs independently, but the PORTFOLIO must be protected.
// This layer sits between models and execution.
//
// Design principles:
//   - Portfolio drawdown control (not just per-trade)
//   - Emergency stop clustering detection
//   - Cross-asset correlation awareness
//   - Confidence decay after consecutive losses
//   - Regime transition risk reduction
//
// Architecture:
//   Models generate signals → PortfolioRiskManager.validate() → Execute or Block

import config from '../config.js';

export default class PortfolioRiskManager {
  constructor(options = {}) {
    // ── Portfolio-Level Limits ───────────────────────────────────
    this.maxTotalDrawdown = options.maxTotalDrawdown ?? 0.10;       // 10% portfolio DD → pause ALL
    this.maxDailyPortfolioLoss = options.maxDailyPortfolioLoss ?? 0.05; // 5% daily loss → stop
    this.maxEmergencyStopsPerDay = options.maxEmergencyStopsPerDay ?? 3; // cluster detection
    this.maxConsecutiveLosses = options.maxConsecutiveLosses ?? 5;   // confidence decay trigger
    this.consecutiveLossPause = options.consecutiveLossPause ?? 7;   // pause after N consecutive losses
    this.correlationThreshold = options.correlationThreshold ?? 0.8; // high correlation warning

    // ── State Tracking ──────────────────────────────────────────
    this.startingBalance = options.startingBalance ?? config.engine.startingBalance;
    this.peakBalance = this.startingBalance;
    this.currentBalance = this.startingBalance;

    // Per-asset tracking
    this.assetState = {};

    // Global tracking
    this.emergencyStopsToday = [];
    this.dailyPnL = 0;
    this.lastResetDay = this._today();

    // Confidence decay state
    this.recentResults = []; // last N trade results (true=win, false=loss)

    // Regime transition tracking
    this.lastRegimes = {};

    // Risk state
    this.paused = false;
    this.pauseReason = null;
    this.pauseTimestamp = null;
  }

  /**
   * Master validation: should this trade be allowed?
   *
   * @param {string} symbol — Asset symbol
   * @param {object} signal — Trade signal from model
   * @param {object} context — Additional context (balance, positions, etc.)
   * @returns {{ allowed: boolean, reason: string, adjustments: object }}
   */
  validate(symbol, signal, context = {}) {
    this._resetDailyIfNewDay();

    const coin = this._extractCoin(symbol);
    const adjustments = {};

    // ── GATE 0: System Paused ───────────────────────────────────
    if (this.paused) {
      return {
        allowed: false,
        reason: `SYSTEM PAUSED: ${this.pauseReason}`,
        adjustments,
        riskLevel: 'BLOCKED',
      };
    }

    // ── GATE 1: Portfolio Drawdown ──────────────────────────────
    const portfolioDD = this._portfolioDrawdown(context.balance);
    if (portfolioDD > this.maxTotalDrawdown) {
      this._pauseSystem('portfolio_drawdown',
        `Portfolio DD ${(portfolioDD * 100).toFixed(1)}% > ${(this.maxTotalDrawdown * 100).toFixed(0)}% limit`);
      return {
        allowed: false,
        reason: `PORTFOLIO DRAWDOWN: ${(portfolioDD * 100).toFixed(1)}%`,
        adjustments,
        riskLevel: 'BLOCKED',
      };
    }

    // ── GATE 2: Daily Portfolio Loss ────────────────────────────
    const dailyLossRatio = Math.abs(Math.min(0, this.dailyPnL)) / this.startingBalance;
    if (dailyLossRatio > this.maxDailyPortfolioLoss) {
      return {
        allowed: false,
        reason: `DAILY LOSS LIMIT: ${(dailyLossRatio * 100).toFixed(1)}% > ${(this.maxDailyPortfolioLoss * 100).toFixed(0)}%`,
        adjustments,
        riskLevel: 'BLOCKED',
      };
    }

    // ── GATE 3: Emergency Stop Clustering ───────────────────────
    const recentStops = this._recentEmergencyStops(24 * 60 * 60 * 1000); // last 24h
    if (recentStops >= this.maxEmergencyStopsPerDay) {
      return {
        allowed: false,
        reason: `EMERGENCY STOP CLUSTER: ${recentStops} stops in 24h (max: ${this.maxEmergencyStopsPerDay})`,
        adjustments,
        riskLevel: 'BLOCKED',
      };
    }

    // ── GATE 4: Consecutive Loss Pause ──────────────────────────
    const consecutiveLosses = this._consecutiveLossCount();
    if (consecutiveLosses >= this.consecutiveLossPause) {
      return {
        allowed: false,
        reason: `CONSECUTIVE LOSSES: ${consecutiveLosses} in a row (max: ${this.consecutiveLossPause})`,
        adjustments,
        riskLevel: 'BLOCKED',
      };
    }

    // ── GATE 5: Per-Asset Emergency Stop Limit ──────────────────
    const assetState = this._getAssetState(coin);
    if (assetState.emergencyStopsToday >= 2) {
      return {
        allowed: false,
        reason: `ASSET EMERGENCY LIMIT: ${coin} has ${assetState.emergencyStopsToday} stops today`,
        adjustments,
        riskLevel: 'BLOCKED',
      };
    }

    // ── GATE 6: Regime Transition Risk ──────────────────────────
    const regimeTransition = this._checkRegimeTransition(symbol, signal.regime);
    if (regimeTransition.isTransitioning) {
      adjustments.positionSizeMultiplier = 0.5; // halve size during transitions
      adjustments.reason = `Regime transition: ${regimeTransition.from} → ${regimeTransition.to}`;
    }

    // ── ADJUSTMENT 1: Confidence Decay ──────────────────────────
    if (consecutiveLosses >= 3) {
      const decayFactor = Math.max(0.3, 1 - (consecutiveLosses - 2) * 0.15);
      adjustments.positionSizeMultiplier = (adjustments.positionSizeMultiplier ?? 1.0) * decayFactor;
      adjustments.confidenceDecay = decayFactor;
    }

    // ── ADJUSTMENT 2: Drawdown Proximity ────────────────────────
    if (portfolioDD > this.maxTotalDrawdown * 0.5) {
      // Within 50% of max DD → reduce size
      const ddFactor = 1 - ((portfolioDD / this.maxTotalDrawdown) - 0.5);
      adjustments.positionSizeMultiplier = (adjustments.positionSizeMultiplier ?? 1.0) * Math.max(0.25, ddFactor);
    }

    // ── ADJUSTMENT 3: High Correlation Warning ──────────────────
    const correlationState = this._checkCorrelation(context.activePositions);
    if (correlationState.highCorrelation) {
      adjustments.positionSizeMultiplier = (adjustments.positionSizeMultiplier ?? 1.0) * 0.7;
      adjustments.correlationWarning = true;
    }

    // ── RISK LEVEL CLASSIFICATION ───────────────────────────────
    const riskLevel = this._classifyRiskLevel(portfolioDD, consecutiveLosses, recentStops);

    return {
      allowed: true,
      reason: 'OK',
      adjustments,
      riskLevel,
      portfolioDD: (portfolioDD * 100).toFixed(2) + '%',
      consecutiveLosses,
      emergencyStopsToday: recentStops,
    };
  }

  /**
   * Record trade result for tracking.
   * Call after every trade close.
   */
  recordTrade(symbol, trade) {
    const coin = this._extractCoin(symbol);
    const state = this._getAssetState(coin);

    // Track daily PnL
    this.dailyPnL += trade.pnl;

    // Track consecutive results
    this.recentResults.push(trade.pnl > 0);
    if (this.recentResults.length > 20) this.recentResults.shift();

    // Track emergency stops
    if (trade.closeReason === 'emergency_stop') {
      this.emergencyStopsToday.push({ symbol, time: Date.now(), pnl: trade.pnl });
      state.emergencyStopsToday++;
      state.totalEmergencyStops++;
    }

    // Track wins/losses
    if (trade.pnl > 0) {
      state.wins++;
      state.consecutiveLosses = 0;
    } else {
      state.losses++;
      state.consecutiveLosses++;
    }

    state.totalPnL += trade.pnl;
    state.tradeCount++;

    // Update portfolio balance tracking
    if (trade.balance) {
      this.currentBalance = trade.balance;
      if (this.currentBalance > this.peakBalance) this.peakBalance = this.currentBalance;
    }

    // Auto-recovery: if system was paused and we have a winning streak, consider unpausing
    if (this.paused && this._consecutiveWinCount() >= 3) {
      this._unpauseSystem('winning_streak_recovery');
    }
  }

  /**
   * Update regime for transition detection.
   * Call when regime changes.
   */
  updateRegime(symbol, regime) {
    const prev = this.lastRegimes[symbol];
    if (prev && prev !== regime) {
      this.lastRegimes[symbol] = regime;
      return { from: prev, to: regime, isTransitioning: true };
    }
    this.lastRegimes[symbol] = regime;
    return { from: regime, to: regime, isTransitioning: false };
  }

  /**
   * Get current risk state for display/logging
   */
  getRiskState() {
    const portfolioDD = this._portfolioDrawdown(this.currentBalance);
    const consecutiveLosses = this._consecutiveLossCount();
    const recentStops = this._recentEmergencyStops(24 * 60 * 60 * 1000);

    return {
      paused: this.paused,
      pauseReason: this.pauseReason,
      portfolioDD: (portfolioDD * 100).toFixed(2) + '%',
      dailyPnL: this.dailyPnL.toFixed(2),
      consecutiveLosses,
      emergencyStopsLast24h: recentStops,
      riskLevel: this._classifyRiskLevel(portfolioDD, consecutiveLosses, recentStops),
      assetStates: Object.entries(this.assetState).map(([coin, state]) => ({
        coin,
        tradeCount: state.tradeCount,
        winRate: state.tradeCount > 0 ? ((state.wins / state.tradeCount) * 100).toFixed(1) + '%' : 'N/A',
        totalPnL: state.totalPnL.toFixed(2),
        emergencyStopsToday: state.emergencyStopsToday,
        consecutiveLosses: state.consecutiveLosses,
      })),
    };
  }

  // ── Internal Methods ─────────────────────────────────────────

  _portfolioDrawdown(balance) {
    if (balance > this.peakBalance) this.peakBalance = balance;
    return this.peakBalance > 0 ? (this.peakBalance - balance) / this.peakBalance : 0;
  }

  _recentEmergencyStops(windowMs) {
    const cutoff = Date.now() - windowMs;
    return this.emergencyStopsToday.filter(s => s.time > cutoff).length;
  }

  _consecutiveLossCount() {
    let count = 0;
    for (let i = this.recentResults.length - 1; i >= 0; i--) {
      if (!this.recentResults[i]) count++;
      else break;
    }
    return count;
  }

  _consecutiveWinCount() {
    let count = 0;
    for (let i = this.recentResults.length - 1; i >= 0; i--) {
      if (this.recentResults[i]) count++;
      else break;
    }
    return count;
  }

  _checkRegimeTransition(symbol, currentRegime) {
    const prev = this.lastRegimes[symbol];
    if (prev && prev !== currentRegime) {
      return { from: prev, to: currentRegime, isTransitioning: true };
    }
    return { from: currentRegime, to: currentRegime, isTransitioning: false };
  }

  _checkCorrelation(activePositions = []) {
    if (activePositions.length < 2) return { highCorrelation: false };

    // Simplified: if 3+ positions open simultaneously, assume high correlation
    // (crypto assets are highly correlated during stress events)
    if (activePositions.length >= 3) {
      return { highCorrelation: true, count: activePositions.length };
    }
    return { highCorrelation: false };
  }

  _classifyRiskLevel(portfolioDD, consecutiveLosses, emergencyStops) {
    if (portfolioDD > this.maxTotalDrawdown * 0.8) return 'CRITICAL';
    if (consecutiveLosses >= 5 || emergencyStops >= 3) return 'HIGH';
    if (portfolioDD > this.maxTotalDrawdown * 0.4 || consecutiveLosses >= 3) return 'ELEVATED';
    if (consecutiveLosses >= 2 || emergencyStops >= 1) return 'MODERATE';
    return 'NORMAL';
  }

  _pauseSystem(reason, detail) {
    this.paused = true;
    this.pauseReason = `${reason}: ${detail}`;
    this.pauseTimestamp = Date.now();
  }

  _unpauseSystem(reason) {
    this.paused = false;
    this.pauseReason = null;
    this.pauseTimestamp = null;
  }

  _getAssetState(coin) {
    if (!this.assetState[coin]) {
      this.assetState[coin] = {
        tradeCount: 0,
        wins: 0,
        losses: 0,
        totalPnL: 0,
        emergencyStopsToday: 0,
        totalEmergencyStops: 0,
        consecutiveLosses: 0,
      };
    }
    return this.assetState[coin];
  }

  _resetDailyIfNewDay() {
    const today = this._today();
    if (today !== this.lastResetDay) {
      this.dailyPnL = 0;
      this.emergencyStopsToday = [];
      for (const state of Object.values(this.assetState)) {
        state.emergencyStopsToday = 0;
      }
      this.lastResetDay = today;
    }
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }

  _extractCoin(symbol) {
    if (!symbol) return 'UNKNOWN';
    return symbol.split('/')[0].split(':')[0].toUpperCase();
  }
}
