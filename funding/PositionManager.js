// ═══════════════════════════════════════════════════════════════════
// PositionManager — Sizing & Exposure
// ═══════════════════════════════════════════════════════════════════
// Responsibilities:
//   - Calculate position size based on worst-case MAE
//   - Fixed 1% capital risk per trade
//   - Enforce max concurrent positions (3)
//   - Track exposure across assets
// ═══════════════════════════════════════════════════════════════════

import FundingConfig from './FundingConfig.js';

export default class PositionManager {
  constructor(startingCapital = 10000) {
    this.capital = startingCapital;
    this.startingCapital = startingCapital;
    this.positions = new Map();       // key -> position object
    this.tradeLog = [];               // completed trades
    this.peakCapital = startingCapital;
    this.maxDrawdown = 0;
    this.consecutiveLosses = 0;
    this.maxConsecutiveLosses = 0;
  }

  // ── Position Sizing ──────────────────────────────────────────────

  calculateSize(label, entryPrice) {
    const assetRisk = FundingConfig.assetRisk[label];
    if (!assetRisk) return 0;

    const worstMAE = assetRisk.worstMAE;
    const riskAmount = this.capital * FundingConfig.risk.riskPerTrade;
    const positionValue = riskAmount / worstMAE;

    // Convert to units
    const units = positionValue / entryPrice;
    return units;
  }

  // ── Open Position ────────────────────────────────────────────────

  openPosition(signal) {
    const key = signal.label;

    // Check constraints
    if (this.positions.size >= FundingConfig.risk.maxConcurrentPositions) {
      return { ok: false, reason: 'max_concurrent' };
    }
    if (this.positions.has(key)) {
      return { ok: false, reason: 'already_in_position' };
    }

    // Check drawdown halt
    const currentDD = (this.peakCapital - this.capital) / this.peakCapital;
    if (currentDD >= FundingConfig.risk.maxDrawdownHalt) {
      return { ok: false, reason: 'drawdown_halt' };
    }

    const entryPrice = signal.entryPrice;
    const size = this.calculateSize(key, entryPrice);
    if (size <= 0) {
      return { ok: false, reason: 'zero_size' };
    }

    // Entry fee (taker)
    const fee = size * entryPrice * FundingConfig.fees.takerFee;

    const position = {
      id: `${Date.now()}-${key}`,
      label: key,
      symbol: signal.symbol || key,
      signalType: signal.signalType,
      fundingRate: signal.fundingRate,
      cumulativeFunding: signal.cumulativeFunding,
      fundingTimestamp: signal.fundingTimestamp,
      side: 'long', // funding signals are always long (buy pressure recovery)
      size,
      entryPrice,
      entryTime: signal.entryTimestamp || Date.now(),
      entryIdx: signal.entryIdx,
      fee,
      holdHours: FundingConfig.exit.holdHours,
      exitTime: (signal.entryTimestamp || Date.now()) + FundingConfig.exit.holdHours * 3600000,
    };

    this.positions.set(key, position);
    this.capital -= fee;

    return { ok: true, position };
  }

  // ── Close Position ───────────────────────────────────────────────

  closePosition(label, exitPrice, exitReason = 'time_exit', currentTimestamp = null) {
    const pos = this.positions.get(label);
    if (!pos) return { ok: false, reason: 'no_position' };

    // Exit fee (taker)
    const fee = pos.size * exitPrice * FundingConfig.fees.takerFee;

    const priceDiff = exitPrice - pos.entryPrice;
    const pnl = priceDiff * pos.size - pos.fee - fee;
    const pnlPercent = pnl / (pos.size * pos.entryPrice) * 100;

    this.capital += pnl;

    // Track drawdown
    if (this.capital > this.peakCapital) this.peakCapital = this.capital;
    const dd = (this.peakCapital - this.capital) / this.peakCapital;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;

    // Track consecutive losses
    if (pnl < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses > this.maxConsecutiveLosses) {
        this.maxConsecutiveLosses = this.consecutiveLosses;
      }
    } else {
      this.consecutiveLosses = 0;
    }

    const holdHours = currentTimestamp
      ? (currentTimestamp - pos.entryTime) / 3600000
      : FundingConfig.exit.holdHours;

    const trade = {
      ...pos,
      exitPrice,
      exitTime: currentTimestamp || pos.exitTime,
      exitReason,
      pnl,
      pnlPercent,
      totalFees: pos.fee + fee,
      holdHours: Math.round(holdHours),
      grossReturn: priceDiff / pos.entryPrice,
      netReturn: pnl / (pos.size * pos.entryPrice),
    };

    this.tradeLog.push(trade);
    this.positions.delete(label);

    return { ok: true, trade };
  }

  // ── Check Time Exits ─────────────────────────────────────────────

  checkTimeExits(currentTimestamp, candleData) {
    const exits = [];

    for (const [label, pos] of this.positions) {
      const elapsed = currentTimestamp - pos.entryTime;
      const holdMs = FundingConfig.exit.holdHours * 3600000;

      if (elapsed >= holdMs) {
        // Find exit price from candle data
        const candles = candleData?.get(label);
        let exitPrice = pos.entryPrice; // fallback

        if (candles) {
          const exitIdx = pos.entryIdx + FundingConfig.exit.holdHours;
          if (exitIdx < candles.length) {
            exitPrice = candles[exitIdx].close;
          } else {
            exitPrice = candles[candles.length - 1].close;
          }
        }

        const result = this.closePosition(label, exitPrice, 'time_exit', currentTimestamp);
        if (result.ok) exits.push(result.trade);
      }
    }

    return exits;
  }

  // ── Stats ────────────────────────────────────────────────────────

  getStats() {
    const wins = this.tradeLog.filter(t => t.pnl > 0);
    const losses = this.tradeLog.filter(t => t.pnl <= 0);
    const totalPnL = this.tradeLog.reduce((s, t) => s + t.pnl, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    return {
      capital: this.capital,
      startingCapital: this.startingCapital,
      totalPnL,
      totalReturnPct: ((this.capital - this.startingCapital) / this.startingCapital) * 100,
      totalTrades: this.tradeLog.length,
      wins: wins.length,
      losses: losses.length,
      winRate: this.tradeLog.length ? (wins.length / this.tradeLog.length * 100).toFixed(1) : 0,
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞',
      avgWin: wins.length ? (grossProfit / wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? (grossLoss / losses.length).toFixed(2) : 0,
      maxDrawdown: (this.maxDrawdown * 100).toFixed(2) + '%',
      maxDrawdownPct: this.maxDrawdown * 100,
      totalFees: this.tradeLog.reduce((s, t) => s + t.totalFees, 0),
      openPositions: this.positions.size,
      consecutiveLosses: this.consecutiveLosses,
      maxConsecutiveLosses: this.maxConsecutiveLosses,
    };
  }
}
