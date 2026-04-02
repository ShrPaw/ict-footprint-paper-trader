import config from '../config.js';

export default class PaperEngine {
  constructor() {
    this.balance = config.engine.startingBalance;
    this.startingBalance = config.engine.startingBalance;
    this.positions = new Map();
    this.trades = [];
    this.openOrders = [];
    this.dailyPnL = 0;
    this.dailyTradeCount = 0;
    this.lastResetDay = new Date().toDateString();
  }

  // ── Order Management ──────────────────────────────────────────────
  openPosition(symbol, side, size, price, stopLoss, takeProfit, regime, reason, atr = null, profile = null) {
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
    if (this.dailyTradeCount >= config.engine.maxDailyTrades) {
      return { ok: false, reason: 'daily_trade_limit' };
    }

    const slippageRate = config.engine.slippageByRegime?.[regime] ?? config.engine.slippage;
    const slippage = price * slippageRate * (side === 'long' ? 1 : -1);
    const fillPrice = price + slippage;
    const fee = size * fillPrice * config.engine.takerFee;
    const margin = (size * fillPrice) / 10;

    if (margin + fee > this.balance) {
      return { ok: false, reason: 'insufficient_balance' };
    }

    const position = {
      id: `${Date.now()}-${symbol}`,
      symbol,
      side,
      size,
      entryPrice: fillPrice,
      originalStopLoss: stopLoss,
      stopLoss,
      takeProfit,
      regime,
      reason,
      entryTime: Date.now(),
      fee,
      unrealizedPnL: 0,
      // Use actual ATR for BE/trailing (not TP-derived)
      atr: atr || Math.abs(takeProfit - fillPrice) / 2,
      // Trailing stop state
      highestPrice: fillPrice,
      lowestPrice: fillPrice,
      trailingActive: false,
      breakevenTriggered: false,
      partialTPDone: false,
      originalSize: size,
      profile,  // per-asset risk overrides
    };

    this.positions.set(symbol, position);
    this.balance -= fee;
    this.dailyTradeCount++;

    return { ok: true, position };
  }

  closePosition(symbol, price, reason = 'manual') {
    const pos = this.positions.get(symbol);
    if (!pos) return { ok: false, reason: 'no_position' };

    const closeSlippageRate = config.engine.slippageByRegime?.[pos.regime] ?? config.engine.slippage;
    const slippage = price * closeSlippageRate * (pos.side === 'long' ? -1 : 1);
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
      durationMin: Math.round((Date.now() - pos.entryTime) / 60000),
    };

    this.trades.push(trade);
    this.positions.delete(symbol);

    return { ok: true, trade };
  }

  // ── Tick Check (call on every new price) ──────────────────────────
  checkExits(symbol, currentPrice, currentHigh = null, currentLow = null) {
    const pos = this.positions.get(symbol);
    if (!pos) return null;

    const high = currentHigh ?? currentPrice;
    const low = currentLow ?? currentPrice;

    // Update extremes
    if (high > pos.highestPrice) pos.highestPrice = high;
    if (low < pos.lowestPrice) pos.lowestPrice = low;

    // Unrealized PnL
    pos.unrealizedPnL = pos.side === 'long'
      ? (currentPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - currentPrice) * pos.size;

    // Use actual ATR for stop management
    const atrDist = pos.atr;

    // ── Partial Take Profit ───────────────────────────────────────
    if (config.engine.partialTP?.enabled && !pos.partialTPDone) {
      const tp1Dist = atrDist * config.engine.partialTP.tpMultiplier;
      const closePercent = config.engine.partialTP.closePercent;

      let hitTP1 = false;
      if (pos.side === 'long' && high >= pos.entryPrice + tp1Dist) hitTP1 = true;
      if (pos.side === 'short' && low <= pos.entryPrice - tp1Dist) hitTP1 = true;

      if (hitTP1) {
        const partialSize = pos.size * closePercent;
        const remainingSize = pos.size * (1 - closePercent);
        const tp1Price = pos.side === 'long' ? pos.entryPrice + tp1Dist : pos.entryPrice - tp1Dist;

        // Close partial position
        const partialSlippageRate = config.engine.slippageByRegime?.[pos.regime] ?? config.engine.slippage;
        const slippage = tp1Price * partialSlippageRate * (pos.side === 'long' ? -1 : 1);
        const fillPrice = tp1Price + slippage;
        const fee = partialSize * fillPrice * config.engine.takerFee;

        const priceDiff = pos.side === 'long'
          ? fillPrice - pos.entryPrice
          : pos.entryPrice - fillPrice;

        const partialPnL = priceDiff * partialSize - (pos.fee * closePercent) - fee;

        this.balance += partialPnL;
        this.dailyPnL += partialPnL;

        this.trades.push({
          ...pos,
          size: partialSize,
          exitPrice: fillPrice,
          exitTime: Date.now(),
          closeReason: 'partial_tp',
          pnl: partialPnL,
          pnlPercent: partialPnL / (partialSize * pos.entryPrice) * 100,
          totalFees: pos.fee * closePercent + fee,
          duration: Date.now() - pos.entryTime,
          durationMin: Math.round((Date.now() - pos.entryTime) / 60000),
        });

        // Update remaining position
        pos.size = remainingSize;
        pos.fee *= (1 - closePercent);
        pos.partialTPDone = true;

        return { ok: true, trade: this.trades[this.trades.length - 1], partial: true };
      }
    }

    // ── Breakeven Logic — per-asset override ───────────────────────
    const ro = pos.profile?.riskOverrides;
    if (config.engine.breakeven.enabled && !pos.breakevenTriggered) {
      const beActivationATR = ro?.breakeven?.activationATR ?? config.engine.breakeven.activationATR;
      const beActivation = atrDist * beActivationATR;
      const offset = pos.entryPrice * config.engine.breakeven.offset;

      if (pos.side === 'long' && high >= pos.entryPrice + beActivation) {
        pos.stopLoss = pos.entryPrice + offset;
        pos.breakevenTriggered = true;
      } else if (pos.side === 'short' && low <= pos.entryPrice - beActivation) {
        pos.stopLoss = pos.entryPrice - offset;
        pos.breakevenTriggered = true;
      }
    }

    // ── Trailing Stop Logic — per-asset override ───────────────────
    if (config.engine.trailingStop.enabled) {
      const activationATR = ro?.trailingStop?.activationATR ?? config.engine.trailingStop.activationATR;
      const trailATR = ro?.trailingStop?.trailATR ?? config.engine.trailingStop.trailATR;

      const activationDist = atrDist * activationATR;
      const trailDist = atrDist * trailATR;

      // Activate trailing
      if (!pos.trailingActive) {
        if (pos.side === 'long' && high >= pos.entryPrice + activationDist) {
          pos.trailingActive = true;
        } else if (pos.side === 'short' && low <= pos.entryPrice - activationDist) {
          pos.trailingActive = true;
        }
      }

      // Update trailing stop
      if (pos.trailingActive) {
        if (pos.side === 'long') {
          const newSL = pos.highestPrice - trailDist;
          if (newSL > pos.stopLoss) pos.stopLoss = newSL;
        } else {
          const newSL = pos.lowestPrice + trailDist;
          if (newSL < pos.stopLoss) pos.stopLoss = newSL;
        }
      }
    }

    // ── Exit Checks ─────────────────────────────────────────────────

    // Stop loss
    if (pos.side === 'long' && low <= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      return this.closePosition(symbol, pos.stopLoss, reason);
    }
    if (pos.side === 'short' && high >= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      return this.closePosition(symbol, pos.stopLoss, reason);
    }

    // Take profit
    if (pos.side === 'long' && high >= pos.takeProfit) {
      return this.closePosition(symbol, pos.takeProfit, 'take_profit');
    }
    if (pos.side === 'short' && low <= pos.takeProfit) {
      return this.closePosition(symbol, pos.takeProfit, 'take_profit');
    }

    // Time exits REMOVED — 0% WR, -$16,205 bleed. Let trailing stops handle recovery.
    return null;
  }

  // ── Stats ─────────────────────────────────────────────────────────
  getStats() {
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    const totalPnL = this.trades.reduce((s, t) => s + t.pnl, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    let peak = this.startingBalance;
    let maxDD = 0;
    let runningBalance = this.startingBalance;
    for (const t of this.trades) {
      runningBalance += t.pnl;
      if (runningBalance > peak) peak = runningBalance;
      const dd = (peak - runningBalance) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      balance: this.balance,
      totalPnL,
      totalPnLPercent: ((this.balance - this.startingBalance) / this.startingBalance) * 100,
      totalTrades: this.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: this.trades.length ? (wins.length / this.trades.length * 100).toFixed(1) : 0,
      avgWin: wins.length ? (grossProfit / wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? (grossLoss / losses.length).toFixed(2) : 0,
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞',
      maxDrawdown: (maxDD * 100).toFixed(2) + '%',
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
