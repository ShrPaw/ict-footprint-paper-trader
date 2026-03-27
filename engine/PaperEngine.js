import config from '../config.js';

export default class PaperEngine {
  constructor() {
    this.balance = config.engine.startingBalance;
    this.startingBalance = config.engine.startingBalance;
    this.positions = new Map();       // symbol -> position
    this.trades = [];                 // completed trades log
    this.openOrders = [];             // limit orders waiting to fill
    this.dailyPnL = 0;
    this.dailyTradeCount = 0;
    this.lastResetDay = new Date().toDateString();
  }

  // ── Order Management ──────────────────────────────────────────────
  openPosition(symbol, side, size, price, stopLoss, takeProfit, regime, reason) {
    this._resetDailyIfNewDay();

    if (this.positions.size >= config.engine.maxOpenPositions) {
      return { ok: false, reason: 'max_positions' };
    }
    if (Math.abs(this.dailyPnL) / this.startingBalance >= config.engine.maxDailyLoss) {
      return { ok: false, reason: 'daily_loss_limit' };
    }
    if (this.positions.has(symbol)) {
      return { ok: false, reason: 'already_in_position' };
    }

    const slippage = price * config.engine.slippage * (side === 'long' ? 1 : -1);
    const fillPrice = price + slippage;
    const fee = size * fillPrice * config.engine.takerFee;
    const margin = (size * fillPrice) / 10; // 10x leverage

    if (margin + fee > this.balance) {
      return { ok: false, reason: 'insufficient_balance' };
    }

    const position = {
      id: `${Date.now()}-${symbol}`,
      symbol,
      side,
      size,
      entryPrice: fillPrice,
      stopLoss,
      takeProfit,
      regime,
      reason,
      entryTime: Date.now(),
      fee,
      unrealizedPnL: 0,
    };

    this.positions.set(symbol, position);
    this.balance -= fee;

    return { ok: true, position };
  }

  closePosition(symbol, price, reason = 'manual') {
    const pos = this.positions.get(symbol);
    if (!pos) return { ok: false, reason: 'no_position' };

    const slippage = price * config.engine.slippage * (pos.side === 'long' ? -1 : 1);
    const fillPrice = price + slippage;
    const fee = pos.size * fillPrice * config.engine.takerFee;

    const priceDiff = pos.side === 'long'
      ? fillPrice - pos.entryPrice
      : pos.entryPrice - fillPrice;

    const pnl = priceDiff * pos.size - pos.fee - fee;
    const pnlPercent = pnl / (pos.size * pos.entryPrice) * 100;

    this.balance += pnl;
    this.dailyPnL += pnl;

    const trade = {
      ...pos,
      exitPrice: fillPrice,
      exitTime: Date.now(),
      closeReason: reason,
      pnl,
      pnlPercent,
      totalFees: pos.fee + fee,
      duration: Date.now() - pos.entryTime,
    };

    this.trades.push(trade);
    this.positions.delete(symbol);

    return { ok: true, trade };
  }

  // ── Tick Check (call on every new price) ──────────────────────────
  checkExits(symbol, currentPrice) {
    const pos = this.positions.get(symbol);
    if (!pos) return null;

    pos.unrealizedPnL = pos.side === 'long'
      ? (currentPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - currentPrice) * pos.size;

    if (pos.side === 'long') {
      if (currentPrice <= pos.stopLoss) return this.closePosition(symbol, pos.stopLoss, 'stop_loss');
      if (currentPrice >= pos.takeProfit) return this.closePosition(symbol, pos.takeProfit, 'take_profit');
    } else {
      if (currentPrice >= pos.stopLoss) return this.closePosition(symbol, pos.stopLoss, 'stop_loss');
      if (currentPrice <= pos.takeProfit) return this.closePosition(symbol, pos.takeProfit, 'take_profit');
    }

    return null;
  }

  // ── Stats ─────────────────────────────────────────────────────────
  getStats() {
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    const totalPnL = this.trades.reduce((s, t) => s + t.pnl, 0);

    return {
      balance: this.balance,
      totalPnL,
      totalPnLPercent: ((this.balance - this.startingBalance) / this.startingBalance) * 100,
      totalTrades: this.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: this.trades.length ? (wins.length / this.trades.length * 100).toFixed(1) : 0,
      avgWin: wins.length ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? (losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2) : 0,
      totalFees: this.trades.reduce((s, t) => s + t.totalFees, 0),
      openPositions: this.positions.size,
      dailyPnL: this.dailyPnL,
    };
  }

  getPosition(symbol) {
    return this.positions.get(symbol) || null;
  }

  // ── Internal ──────────────────────────────────────────────────────
  _resetDailyIfNewDay() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDay) {
      this.dailyPnL = 0;
      this.dailyTradeCount = 0;
      this.lastResetDay = today;
    }
  }
}
