// ═══════════════════════════════════════════════════════════════════
// RiskMonitor — Tracking & Alerts
// ═══════════════════════════════════════════════════════════════════
// Responsibilities:
//   - Track real-time drawdown
//   - Track consecutive losses
//   - Track capital exposure
//   - ALERT ONLY (no auto intervention)
// ═══════════════════════════════════════════════════════════════════

import FundingConfig from './FundingConfig.js';
import { EventEmitter } from 'events';

export default class RiskMonitor extends EventEmitter {
  constructor(positionManager) {
    super();
    this.pm = positionManager;
    this.alerts = [];
  }

  // ── Check All Risk Metrics ───────────────────────────────────────

  check() {
    const stats = this.pm.getStats();
    const alerts = [];

    // Drawdown check
    if (stats.maxDrawdownPct >= FundingConfig.risk.maxDrawdownHalt * 100) {
      alerts.push({
        level: 'CRITICAL',
        type: 'drawdown_halt',
        message: `Portfolio DD ${stats.maxDrawdownPct.toFixed(1)}% ≥ ${(FundingConfig.risk.maxDrawdownHalt * 100).toFixed(0)}% halt threshold`,
        value: stats.maxDrawdownPct,
      });
    } else if (stats.maxDrawdownPct >= FundingConfig.risk.maxDrawdownHalt * 100 * 0.7) {
      alerts.push({
        level: 'WARNING',
        type: 'drawdown_warning',
        message: `Portfolio DD ${stats.maxDrawdownPct.toFixed(1)}% approaching halt threshold`,
        value: stats.maxDrawdownPct,
      });
    }

    // Consecutive losses
    if (stats.consecutiveLosses >= FundingConfig.risk.maxConsecutiveLosses) {
      alerts.push({
        level: 'WARNING',
        type: 'consecutive_losses',
        message: `${stats.consecutiveLosses} consecutive losses (max: ${stats.maxConsecutiveLosses})`,
        value: stats.consecutiveLosses,
      });
    }

    // Exposure check
    if (stats.openPositions >= FundingConfig.risk.maxConcurrentPositions) {
      alerts.push({
        level: 'INFO',
        type: 'max_exposure',
        message: `At max concurrent positions (${stats.openPositions})`,
        value: stats.openPositions,
      });
    }

    // Monthly consistency check
    const monthlyReturns = this._computeMonthlyReturns();
    const negativeMonths = monthlyReturns.filter(m => m < 0).length;
    const totalMonths = monthlyReturns.length;
    if (totalMonths >= 3 && negativeMonths / totalMonths > 0.6) {
      alerts.push({
        level: 'WARNING',
        type: 'monthly_consistency',
        message: `${negativeMonths}/${totalMonths} negative months (${(negativeMonths / totalMonths * 100).toFixed(0)}%)`,
        value: negativeMonths / totalMonths,
      });
    }

    // Emit alerts
    for (const alert of alerts) {
      this.alerts.push({ ...alert, timestamp: Date.now() });
      this.emit('alert', alert);
    }

    return alerts;
  }

  // ── Monthly Returns ──────────────────────────────────────────────

  _computeMonthlyReturns() {
    const trades = this.pm.tradeLog;
    if (trades.length === 0) return [];

    const monthlyPnL = {};
    for (const t of trades) {
      const d = new Date(t.exitTime);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthlyPnL[key] = (monthlyPnL[key] || 0) + t.pnl;
    }

    return Object.values(monthlyPnL);
  }

  // ── Summary Report ───────────────────────────────────────────────

  getReport() {
    const stats = this.pm.getStats();
    const monthlyReturns = this._computeMonthlyReturns();
    const profitableMonths = monthlyReturns.filter(m => m > 0).length;

    return {
      ...stats,
      monthlyStats: {
        totalMonths: monthlyReturns.length,
        profitableMonths,
        profitablePct: monthlyReturns.length > 0
          ? (profitableMonths / monthlyReturns.length * 100).toFixed(1)
          : 0,
        avgMonthlyReturn: monthlyReturns.length > 0
          ? (monthlyReturns.reduce((s, x) => s + x, 0) / monthlyReturns.length).toFixed(2)
          : 0,
      },
      alertCount: this.alerts.length,
      recentAlerts: this.alerts.slice(-5),
    };
  }
}
