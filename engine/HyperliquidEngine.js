import ccxt from 'ccxt';
import { EventEmitter } from 'events';
import config from '../config.js';

/**
 * Hyperliquid Testnet Engine
 * Executes real paper orders on Hyperliquid testnet via ccxt.
 * Replaces PaperEngine for live exchange fills with fake money.
 */
export default class HyperliquidEngine extends EventEmitter {
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
    const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        'HYPERLIQUID_PRIVATE_KEY not set in .env\n' +
        '1. Go to https://app.hyperliquid-testnet.xyz/\n' +
        '2. Connect/create a wallet\n' +
        '3. Export your private key\n' +
        '4. Add to .env: HYPERLIQUID_PRIVATE_KEY=0x...'
      );
    }

    this.exchange = new ccxt.hyperliquid({
      sandboxMode: true,  // testnet
      privateKey,
      options: {
        defaultType: 'swap',
      },
    });

    // Test connection
    try {
      const balance = await this.exchange.fetchBalance();
      const usdc = balance['USDC'] || balance['USDC'] || { free: 0 };
      this.balance = usdc.free || 0;
      this.startingBalance = this.balance;
      console.log(`[HyperliquidEngine] Connected to testnet | Balance: $${this.balance.toFixed(2)} USDC`);
      this.initialized = true;
    } catch (err) {
      throw new Error(`Hyperliquid connection failed: ${err.message}`);
    }
  }

  /**
   * Open a position on Hyperliquid testnet
   */
  async openPosition(symbol, side, size, price, stopLoss, takeProfit, regime, reason, atr = null, profile = null) {
    this._resetDailyIfNewDay();

    if (this.positions.has(symbol)) {
      return { ok: false, reason: 'already_in_position' };
    }

    // Hyperliquid uses coin names like "ETH", not "ETH/USDT:USDT"
    const market = this.exchange.market(symbol);
    const coin = market.id;

    try {
      // Round size to exchange precision
      const amount = parseFloat(this.exchange.amountToPrecision(symbol, size));
      const orderSide = side === 'long' ? 'buy' : 'sell';

      console.log(`[HyperliquidEngine] Placing ${orderSide.toUpperCase()} ${amount} ${coin} @ market...`);

      // Market order
      const order = await this.exchange.createOrder(
        symbol,
        'market',
        orderSide,
        amount,
        undefined,
        {
          // Hyperliquid-specific: reduce-only false for opening
          reduceOnly: false,
        }
      );

      const fillPrice = order.average || order.price || price;
      const filled = order.filled || amount;
      const fee = order.fee?.cost || (filled * fillPrice * 0.0005);

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
        profile,  // per-asset risk overrides
        orderId: order.id,
      };

      this.positions.set(symbol, position);

      // Refresh balance
      await this._refreshBalance();

      console.log(`[HyperliquidEngine] ✅ Filled ${orderSide.toUpperCase()} ${filled} ${coin} @ ${fillPrice}`);

      return { ok: true, position };

    } catch (err) {
      console.error(`[HyperliquidEngine] ❌ Order failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Close a position on Hyperliquid testnet
   */
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
      const fee = order.fee?.cost || (pos.size * fillPrice * 0.0005);

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

      // Refresh balance
      await this._refreshBalance();

      const emoji = pnl >= 0 ? '✅' : '❌';
      console.log(`${emoji} [HyperliquidEngine] CLOSED ${reason} | PnL: $${pnl.toFixed(2)}`);

      return { ok: true, trade };

    } catch (err) {
      console.error(`[HyperliquidEngine] ❌ Close failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Check SL/TP exits (same logic as PaperEngine but async)
   */
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
        if (pos.side === 'long' && high >= pos.entryPrice + activationDist) {
          pos.trailingActive = true;
        } else if (pos.side === 'short' && low <= pos.entryPrice - activationDist) {
          pos.trailingActive = true;
        }
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

    // Stop loss
    if (pos.side === 'long' && low <= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      return await this.closePosition(symbol, pos.stopLoss, reason);
    }
    if (pos.side === 'short' && high >= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      return await this.closePosition(symbol, pos.stopLoss, reason);
    }

    // Take profit
    if (pos.side === 'long' && high >= pos.takeProfit) {
      return await this.closePosition(symbol, pos.takeProfit, 'take_profit');
    }
    if (pos.side === 'short' && low <= pos.takeProfit) {
      return await this.closePosition(symbol, pos.takeProfit, 'take_profit');
    }

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
      const usdc = balance['USDC'] || { free: 0 };
      this.balance = usdc.free || 0;
    } catch (e) {
      // keep last known balance
    }
  }

  _resetDailyIfNewDay() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDay) {
      this.dailyPnL = 0;
      this.lastResetDay = today;
    }
  }
}
