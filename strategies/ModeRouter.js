// ── ModeRouter: Routes to the correct strategy based on day + market ──
// Detects weekday vs weekend, then delegates to:
//   - DaytradeMode (weekday, 1H, ICT + trend)
//   - WeekendMode (weekend, 5m-15m, footprint only)
//   - ScalpingProMode (weekday, 15m, hybrid scalping)
//
// Each mode is fully independent with its own logic.

import config from '../config.js';
import DaytradeMode from './DaytradeMode.js';
import WeekendMode from './WeekendMode.js';
import ScalpingProMode from './ScalpingProMode.js';

export default class ModeRouter {
  constructor(regimeDetector, ictAnalyzer, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.ict = ictAnalyzer;
    this.footprint = footprintAnalyzer;

    // Initialize all three modes
    this.daytrade = new DaytradeMode(regimeDetector, ictAnalyzer, footprintAnalyzer);
    this.weekend = new WeekendMode(regimeDetector, footprintAnalyzer);
    this.scalping = new ScalpingProMode(regimeDetector, footprintAnalyzer);

    // Track which mode generated the last signal
    this.lastMode = {};
  }

  /**
   * Generate a signal by routing to the correct mode.
   *
   * @param {string} symbol - Trading pair
   * @param {object} candleData - { '1h': [...], '15m': [...], '5m': [...] }
   * @param {object|null} realFootprint - Real order flow data
   * @returns {object|null} Signal or null
   */
  generateSignal(symbol, candleData, realFootprint = null) {
    const isWeekend = this._isWeekend();

    const candles1h = candleData['1h'] || [];
    const candles15m = candleData['15m'] || [];
    const candles5m = candleData['5m'] || [];

    let signal = null;
    let mode = null;

    // ── Weekday: Daytrade only (1H) ─────────────────────────────────
    // Scalping disabled — 44% WR, -$421. No edge on 15m.
    // Daytrade on 1H is cleaner and almost breakeven.
    if (!isWeekend) {
      if (candles1h.length >= 50) {
        signal = this.daytrade.generateSignal(symbol, candles1h, candles15m, realFootprint);
        mode = 'DAYTRADE';
      }
    } else {
      // Weekend: footprint/cluster only
      if (candles5m.length >= 30) {
        signal = this.weekend.generateSignal(symbol, candles5m, candles15m, realFootprint);
        mode = 'WEEKEND';
      }
    }

    if (signal) {
      this.lastMode[symbol] = mode;
      signal.sourceMode = mode;
    }

    return signal;
  }

  /**
   * Get current active mode for a symbol
   */
  getActiveMode(symbol) {
    const isWeekend = this._isWeekend();
    if (isWeekend) return 'WEEKEND';
    return this.lastMode[symbol] || 'IDLE';
  }

  /**
   * Get mode status for dashboard
   */
  getStatus() {
    const isWeekend = this._isWeekend();
    return {
      isWeekend,
      activeMode: isWeekend ? 'WEEKEND' : 'WEEKDAY',
      daytradeSignals: this.daytrade.lastSignalTime,
      weekendSignals: this.weekend.lastSignalTime,
      scalpingSignals: this.scalping.lastSignalTime,
    };
  }

  _isWeekend() {
    const now = new Date();
    const day = now.getUTCDay();
    return day === 0 || day === 6;
  }
}
