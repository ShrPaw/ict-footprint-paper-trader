import ccxt from 'ccxt';
import { EventEmitter } from 'events';
import config from '../config.js';

/**
 * Binance Futures Testnet Engine
 * Executes orders on Binance USDⓈ-M futures testnet via ccxt.
 * Replaces HyperliquidEngine for Binance-based live trading.
 *
 * Testnet: https://testnet.binancefuture.com/
 * API keys: https://testnet.binancefuture.com/en/settings/api-management
 */
export default class BinanceEngine extends EventEmitter {
  constructor() {
    super();
    this.exchange = null;
    this.positions = new Map();
    this.trades = [];
    this.balance = 0;
    this.startingBalance = config.engine.startingBalance;
    this.dailyPnL = 0;
    this.lastResetDay = new Date().toDateString();
    this.initialized = false;
  }

  async init() {
    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error(
        'BINANCE_API_KEY and BINANCE_API_SECRET not set in .env\n' +
        '1. Go to https://testnet.binancefuture.com/\n' +
        '2. Create API key pair\n' +
        '3. Add to .env:\n' +
        '   BINANCE_API_KEY=your_key\n' +
        '   BINANCE_API_SECRET=your_secret'
      );
    }

    this.exchange = new ccxt.binance({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });

    // Point to testnet
    this.exchange.urls['api'] = {
      public: 'https://testnet.binancefuture.com/fapi/v1',
      private: 'https://testnet.binancefuture.com/fapi/v1',
    };

    try {
      const balance = await this.exchange.fetchBalance();
      const usdt = balance['USDT'] || { free: 0 };
      this.balance = usdt.free || 0;
      this.startingBalance = this.balance;
      console.log(`[BinanceEngine] Connected to testnet | Balance: $${this.balance.toFixed(2)} USDT`);
      this.initialized = true;
    } catch (err) {
      throw new Error(`Binance testnet connection failed: ${err.message}`);
    }
  }

  async openPosition(symbol, side, size, price, stopLoss, takeProfit, regime, reason, atr = null, profile = null) {
    this._resetDailyIfNewDay();

    if (this.positions.has(symbol)) {
      return { ok: false, reason: 'already_in_position' };
    }

    try {
      const amount = parseFloat(this.exchange.amountToPrecision(symbol, size));
      const orderSide = side === 'long' ? 'buy' : 'sell';

      console.log(`[BinanceEngine] Placing ${orderSide.toUpperCase()} ${amount} ${symbol} @ market...`);

      const order = await this.exchange.createOrder(
        symbol,
        'market',
        orderSide,
        amount,
        undefined,
        { reduceOnly: false }
      );

      const fillPrice = order.average || order.price || price;
      const filled = order.filled || amount;
      const fee = order.fee?.cost || (filled * fillPrice * 0.0004);

      const position = {
        id: order.id,
        symbol,
        side,
        size: filled,
        entryPrice: fillPrice,
        originalStopLoss: stopLoss,
        stopLoss,
        takeProfit,
        regime,
        reason,
        entryTime: Date.now(),
        fee,
        unrealizedPnL: 0,
        atr: atr || Math.abs(takeProfit - fillPrice) / 2,
        highestPrice: fillPrice,
        lowestPrice: fillPrice,
        trailingActive: false,
        breakevenTriggered: false,
        partialTPDone: false,
        originalSize: filled,
        orderId: order.id,
        profile,  // per-asset risk overrides
      };

      this.positions.set(symbol, position);
      await this._refreshBalance();

      console.log(`[BinanceEngine] ✅ Filled ${orderSide.toUpperCase()} ${filled} ${symbol} @ ${fillPrice}`);
      return { ok: true, position };

    } catch (err) {
      console.error(`[BinanceEngine] ❌ Order failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  }

  async closePosition(symbol, price, reason = 'manual') {
    const pos = this.positions.get(symbol);
    if (!pos) return { ok: false, reason: 'no_position' };

    try {
      const orderSide = pos.side === 'long' ? 'sell' : 'buy';

      const order = await this.exchange.createOrder(
        symbol,
        'market',
        orderSide,
        pos.size,
        undefined,
        { reduceOnly: true }
      );

      const fillPrice = order.average || order.price || price;
      const fee = order.fee?.cost || (pos.size * fillPrice * 0.0004);

      const priceDiff = pos.side === 'long'
        ? fillPrice - pos.entryPrice
        : pos.entryPrice - fillPrice;

      const pnl = priceDiff * pos.size - pos.fee - fee;
      this.dailyPnL += pnl;

      const trade = {
        ...pos,
        exitPrice: fillPrice,
        exitTime: Date.now(),
        closeReason: reason,
        pnl,
        pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
        totalFees: pos.fee + fee,
        duration: Date.now() - pos.entryTime,
        durationMin: Math.round((Date.now() - pos.entryTime) / 60000),
      };

      this.trades.push(trade);
      this.positions.delete(symbol);
      await this._refreshBalance();

      const emoji = pnl >= 0 ? '✅' : '❌';
      console.log(`${emoji} [BinanceEngine] CLOSED ${reason} | PnL: $${pnl.toFixed(2)}`);
      return { ok: true, trade };

    } catch (err) {
      console.error(`[BinanceEngine] ❌ Close failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  }

  async checkExits(symbol, currentPrice, currentHigh = null, currentLow = null) {
    const pos = this.positions.get(symbol);
    if (!pos) return null;

    const high = currentHigh ?? currentPrice;
    const low = currentLow ?? currentPrice;

    if (high > pos.highestPrice) pos.highestPrice = high;
    if (low < pos.lowestPrice) pos.lowestPrice = low;

    pos.unrealizedPnL = pos.side === 'long'
      ? (currentPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - currentPrice) * pos.size;

    const atrDist = pos.atr;
    const ro = pos.profile?.riskOverrides;

    // Breakeven — per-asset override
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

    // Trailing stop — per-asset override
    if (config.engine.trailingStop.enabled) {
      const activationATR = ro?.trailingStop?.activationATR ?? config.engine.trailingStop.activationATR;
      const trailATR = ro?.trailingStop?.trailATR ?? config.engine.trailingStop.trailATR;
      const activationDist = atrDist * activationATR;
      const trailDist = atrDist * trailATR;

      if (!pos.trailingActive) {
        if (pos.side === 'long' && high >= pos.entryPrice + activationDist) pos.trailingActive = true;
        else if (pos.side === 'short' && low <= pos.entryPrice - activationDist) pos.trailingActive = true;
      }

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

    // SL
    if (pos.side === 'long' && low <= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      return await this.closePosition(symbol, pos.stopLoss, reason);
    }
    if (pos.side === 'short' && high >= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      return await this.closePosition(symbol, pos.stopLoss, reason);
    }

    // TP
    if (pos.side === 'long' && high >= pos.takeProfit) return await this.closePosition(symbol, pos.takeProfit, 'take_profit');
    if (pos.side === 'short' && low <= pos.takeProfit) return await this.closePosition(symbol, pos.takeProfit, 'take_profit');

    // Time exits REMOVED — 0% WR, -$16,205 bleed. Let trailing stops handle recovery.
    return null;
  }

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
      totalPnLPercent: this.startingBalance > 0 ? ((this.balance - this.startingBalance) / this.startingBalance) * 100 : 0,
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

  async _refreshBalance() {
    try {
      const balance = await this.exchange.fetchBalance();
      const usdt = balance['USDT'] || { free: 0 };
      this.balance = usdt.free || 0;
    } catch (e) { /* keep last known */ }
  }

  _resetDailyIfNewDay() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDay) {
      this.dailyPnL = 0;
      this.lastResetDay = today;
    }
  }
}
