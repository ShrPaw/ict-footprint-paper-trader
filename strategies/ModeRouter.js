// ── ModeRouter: Weekday-only, Daytrade mode ──────────────────────
// No weekend trading — no edge. Daytrade on 1H ICT + OrderFlowEngine is the only strategy.

import DaytradeMode from './DaytradeMode.js';

export default class ModeRouter {
  constructor(regimeDetector, ictAnalyzer, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.ict = ictAnalyzer;
    this.footprint = footprintAnalyzer;

    this.daytrade = new DaytradeMode(regimeDetector, ictAnalyzer, footprintAnalyzer);
    this.lastMode = {};
  }

  generateSignal(symbol, candleData, realFootprint = null) {
    const isWeekend = this._isWeekend();
    if (isWeekend) return null; // No weekends — no edge

    const candles1h = candleData['1h'] || [];
    const candles15m = candleData['15m'] || [];

    if (candles1h.length < 50) return null;

    const signal = this.daytrade.generateSignal(symbol, candles1h, candles15m, realFootprint);
    if (signal) {
      this.lastMode[symbol] = 'DAYTRADE';
      signal.sourceMode = 'DAYTRADE';
    }
    return signal;
  }

  getActiveMode(symbol) {
    if (this._isWeekend()) return 'WEEKEND_OFF';
    return this.lastMode[symbol] || 'IDLE';
  }

  getStatus() {
    return {
      isWeekend: this._isWeekend(),
      activeMode: this._isWeekend() ? 'WEEKEND_OFF' : 'DAYTRADE',
      daytradeSignals: this.daytrade.lastSignalTime,
    };
  }

  _isWeekend() {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6;
  }
}
