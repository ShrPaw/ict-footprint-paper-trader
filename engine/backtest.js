import ccxt from 'ccxt';
import config from '../config.js';
import RegimeDetector from '../analysis/RegimeDetector.js';
import ICTAnalyzer from '../analysis/ICTAnalyzer.js';
import RealFootprintAnalyzer from '../analysis/RealFootprintAnalyzer.js';
import DaytradeMode from '../strategies/DaytradeMode.js';
import WeekendMode from '../strategies/WeekendMode.js';
import ScalpingProMode from '../strategies/ScalpingProMode.js';
import fs from 'fs';
import path from 'path';

class Backtester {
  constructor(options = {}) {
    this.startingBalance = options.startingBalance || config.engine.startingBalance;
    this.balance = this.startingBalance;
    this.trades = [];
    this.equityCurve = [{ timestamp: 0, equity: this.startingBalance, balance: this.startingBalance }];
    this.peak = this.startingBalance;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
    this.regime = new RegimeDetector();
    this.ict = new ICTAnalyzer();
    this.footprint = new RealFootprintAnalyzer();
    this.position = null;
    this.dailyPnL = 0;
    this.lastResetDay = null;
    this.stats = null;

    // Three independent modes
    this.daytradeMode = new DaytradeMode(this.regime, this.ict, this.footprint);
    this.weekendMode = new WeekendMode(this.regime, this.footprint);
    this.scalpingMode = new ScalpingProMode(this.regime, this.footprint);

    // Config
    this.symbols = options.symbols || config.symbols;
    this.startDate = options.startDate || null;
    this.endDate = options.endDate || null;
    this.verbose = options.verbose ?? false;
    this.exchangeId = options.exchange || config.data.exchange;
  }

  async run() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   📊 BACKTEST ENGINE v2.0 — 3-Mode System           ║');
    console.log('║   Daytrade(1H) + Weekend(Footprint) + Scalping(15m) ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.log(`  Exchange: ${this.exchangeId} | Symbols: ${this.symbols.join(', ')}`);
    console.log(`  Period: ${this.startDate || 'start'} → ${this.endDate || 'now'}\n`);

    const exchange = new ccxt[this.exchangeId]({ enableRateLimit: true });

    for (const symbol of this.symbols) {
      console.log(`\n── Backtesting ${symbol} ─────────────────────────`);

      try {
        // Fetch candles for all timeframes
        const candles15m = await this._fetchHistoricalCandles(exchange, symbol, '15m');
        const candles5m = await this._fetchHistoricalCandles(exchange, symbol, '5m');
        const candles1h = await this._fetchHistoricalCandles(exchange, symbol, '1h');
        console.log(`  15m: ${candles15m.length} | 5m: ${candles5m.length} | 1h: ${candles1h.length}`);

        if (candles15m.length < 100) {
          console.log(`  ⚠️  Not enough data, skipping`);
          continue;
        }

        // Walk forward on 15m candles (primary timeframe for signal generation)
        for (let i = 50; i < candles15m.length; i++) {
          const window15m = candles15m.slice(0, i + 1);
          const candle15m = candles15m[i];
          const timestamp = candle15m.timestamp;

          // Build 5m window up to current timestamp
          const window5m = candles5m.filter(c => c.timestamp <= timestamp);
          // Build 1h window up to current timestamp
          const window1h = candles1h.filter(c => c.timestamp <= timestamp);

          // Reset daily PnL
          const day = new Date(timestamp).toDateString();
          if (day !== this.lastResetDay) {
            this.dailyPnL = 0;
            this.lastResetDay = day;
          }

          // Check exits on current candle
          if (this.position) {
            this._checkExit(candle15m, timestamp);
          }

          // Generate signal if no position — route to correct mode
          if (!this.position) {
            const signal = this._routeSignal(symbol, window15m, window5m, window1h, timestamp);
            if (signal) {
              this._openPosition(symbol, signal, candle15m.close, timestamp);
            }
          }

          // Track equity
          const unrealizedPnL = this.position ? this._calcUnrealizedPnL(candle15m.close) : 0;
          const equity = this.balance + unrealizedPnL;
          this.equityCurve.push({ timestamp, equity, balance: this.balance });

          // Track drawdown
          if (equity > this.peak) this.peak = equity;
          const dd = (this.peak - equity) / this.peak;
          if (dd > this.maxDrawdownPercent) {
            this.maxDrawdownPercent = dd;
            this.maxDrawdown = this.peak - equity;
          }
        }

        // Close remaining position
        if (this.position) {
          const lastCandle = candles15m[candles15m.length - 1];
          this._closePosition(lastCandle.close, lastCandle.timestamp, 'backtest_end');
        }

      } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
      }
    }

    this._computeStats();
    this._printReport();
    this._exportResults();

    return this.stats;
  }

  // ── Mode Router (mirrors ModeRouter logic for backtesting) ───────
  _routeSignal(symbol, window15m, window5m, window1h, timestamp) {
    const day = new Date(timestamp).getUTCDay();
    const isWeekend = day === 0 || day === 6;

    if (isWeekend) {
      // Weekend: footprint only
      if (window5m.length >= 30) {
        return this.weekendMode.generateSignal(symbol, window5m, window15m, null);
      }
      return null;
    }

    // Weekday: Daytrade first (1H), then Scalping (15m)
    if (window1h.length >= 50) {
      const signal = this.daytradeMode.generateSignal(symbol, window1h, window15m, null);
      if (signal) return signal;
    }

    // Fallback to scalping
    if (window15m.length >= 50 && window5m.length >= 30) {
      return this.scalpingMode.generateSignal(symbol, window15m, window5m, null);
    }

    return null;
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
          timestamp: c[0],
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5],
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

  _openPosition(symbol, signal, price, timestamp) {
    const riskParams = config.risk[signal.regime] || config.risk.RANGING;
    const slDistance = Math.abs(price - signal.stopLoss);
    if (slDistance === 0) return;

    let riskPercent = riskParams.riskPercent;
    if (signal.isWeekend) riskPercent *= config.weekend.riskMultiplier;
    const riskAmount = this.balance * (riskPercent / 100);
    const size = riskAmount / slDistance;
    const fee = size * price * config.engine.takerFee;
    const margin = (size * price) / 10;

    if (margin + fee > this.balance) return;
    if (Math.abs(this.dailyPnL) / this.startingBalance >= config.engine.maxDailyLoss) return;

    const slippage = price * config.engine.slippage * (signal.action === 'buy' ? 1 : -1);
    const fillPrice = price + slippage;

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
      mode: signal.sourceMode || signal.mode || 'UNKNOWN',
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
    };

    this.balance -= fee;

    if (this.verbose) {
      const emoji = signal.action === 'buy' ? '📈' : '📉';
      const mode = signal.sourceMode || signal.mode || '';
      const wknd = signal.isWeekend ? ' [WKND]' : '';
      const pat = signal.entryPattern ? ` [${signal.entryPattern}]` : '';
      console.log(`  ${emoji} ${mode} ${signal.action.toUpperCase()} ${symbol} @ ${fillPrice.toFixed(4)} | SL: ${signal.stopLoss.toFixed(4)} | TP: ${signal.takeProfit.toFixed(4)} | ${signal.regime}${wknd}${pat}`);
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
        const slippage = tp1Price * config.engine.slippage * (side === 'long' ? -1 : 1);
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

        if (this.verbose) {
          console.log(`  💰 PARTIAL TP @ ${fillPrice.toFixed(4)} | 50% closed | PnL: $${partialPnL.toFixed(2)}`);
        }
      }
    }

    // Trailing stop
    if (config.engine.trailingStop.enabled) {
      const activationATR = config.engine.trailingStop.activationATR;
      const trailATR = config.engine.trailingStop.trailATR;
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

    // SL check
    if (side === 'long' && candle.low <= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : 'stop_loss';
      this._closePosition(pos.stopLoss, timestamp, reason);
      return;
    }
    if (side === 'short' && candle.high >= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : 'stop_loss';
      this._closePosition(pos.stopLoss, timestamp, reason);
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

    // Time exit (4h for non-profitable)
    const elapsed = timestamp - pos.entryTime;
    if (elapsed > 4 * 60 * 60 * 1000) {
      const unrealized = side === 'long' ? (price - pos.entryPrice) : (pos.entryPrice - price);
      if (unrealized < 0) {
        this._closePosition(price, timestamp, 'time_exit');
      }
    }
  }

  _closePosition(price, timestamp, reason) {
    const pos = this.position;
    const slippage = price * config.engine.slippage * (pos.side === 'long' ? -1 : 1);
    const fillPrice = price + slippage;
    const fee = pos.size * fillPrice * config.engine.takerFee;
    const priceDiff = pos.side === 'long' ? fillPrice - pos.entryPrice : pos.entryPrice - fillPrice;
    const pnl = priceDiff * pos.size - pos.fee - fee;
    const pnlPercent = pnl / (pos.size * pos.entryPrice) * 100;

    this.balance += pnl;
    this.dailyPnL += pnl;

    const trade = {
      symbol: pos.symbol, side: pos.side, size: pos.size,
      entryPrice: pos.entryPrice, exitPrice: fillPrice,
      entryTime: pos.entryTime, exitTime: timestamp,
      closeReason: reason, regime: pos.regime, signalType: pos.signalType,
      mode: pos.mode, reason: pos.reason,
      pnl, pnlPercent, totalFees: pos.fee + fee,
      duration: timestamp - pos.entryTime,
      durationMin: Math.round((timestamp - pos.entryTime) / 60000),
      isWeekend: pos.isWeekend, entryPattern: pos.entryPattern,
      assetProfile: pos.assetProfile,
    };

    this.trades.push(trade);
    this.position = null;

    if (this.verbose) {
      const emoji = pnl >= 0 ? '✅' : '❌';
      console.log(`  ${emoji} CLOSE ${trade.side.toUpperCase()} @ ${fillPrice.toFixed(4)} | PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) | ${reason} | ${trade.mode}`);
    }
  }

  _calcUnrealizedPnL(currentPrice) {
    if (!this.position) return 0;
    return this.position.side === 'long'
      ? (currentPrice - this.position.entryPrice) * this.position.size
      : (this.position.entryPrice - currentPrice) * this.position.size;
  }

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
    const byRegime = {};
    const bySignal = {};
    const byExit = {};
    const byMode = {};
    const byAsset = {};
    const byPattern = {};

    for (const t of trades) {
      // By regime
      if (!byRegime[t.regime]) byRegime[t.regime] = { trades: 0, wins: 0, pnl: 0 };
      byRegime[t.regime].trades++;
      if (t.pnl > 0) byRegime[t.regime].wins++;
      byRegime[t.regime].pnl += t.pnl;

      // By signal
      const sig = t.signalType || 'unknown';
      if (!bySignal[sig]) bySignal[sig] = { trades: 0, wins: 0, pnl: 0 };
      bySignal[sig].trades++;
      if (t.pnl > 0) bySignal[sig].wins++;
      bySignal[sig].pnl += t.pnl;

      // By exit
      if (!byExit[t.closeReason]) byExit[t.closeReason] = { trades: 0, wins: 0, pnl: 0 };
      byExit[t.closeReason].trades++;
      if (t.pnl > 0) byExit[t.closeReason].wins++;
      byExit[t.closeReason].pnl += t.pnl;

      // By mode
      const mode = t.mode || 'UNKNOWN';
      if (!byMode[mode]) byMode[mode] = { trades: 0, wins: 0, pnl: 0 };
      byMode[mode].trades++;
      if (t.pnl > 0) byMode[mode].wins++;
      byMode[mode].pnl += t.pnl;

      // By asset
      const asset = t.assetProfile || t.symbol?.split('/')[0] || 'unknown';
      if (!byAsset[asset]) byAsset[asset] = { trades: 0, wins: 0, pnl: 0 };
      byAsset[asset].trades++;
      if (t.pnl > 0) byAsset[asset].wins++;
      byAsset[asset].pnl += t.pnl;

      // By pattern
      const pat = t.entryPattern || 'no_pattern';
      if (!byPattern[pat]) byPattern[pat] = { trades: 0, wins: 0, pnl: 0 };
      byPattern[pat].trades++;
      if (t.pnl > 0) byPattern[pat].wins++;
      byPattern[pat].pnl += t.pnl;
    }

    const weekendTrades = trades.filter(t => t.isWeekend);
    const weekdayTrades = trades.filter(t => !t.isWeekend);

    let maxConsecWins = 0, maxConsecLosses = 0, curWins = 0, curLosses = 0;
    for (const t of trades) {
      if (t.pnl > 0) { curWins++; curLosses = 0; } else { curLosses++; curWins = 0; }
      maxConsecWins = Math.max(maxConsecWins, curWins);
      maxConsecLosses = Math.max(maxConsecLosses, curLosses);
    }

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
      largestWin: wins.length ? Math.max(...wins.map(t => t.pnl)).toFixed(2) : 0,
      largestLoss: losses.length ? Math.min(...losses.map(t => t.pnl)).toFixed(2) : 0,
      maxDrawdown: this.maxDrawdown.toFixed(2),
      maxDrawdownPercent: (this.maxDrawdownPercent * 100).toFixed(2),
      sharpeRatio: sharpe.toFixed(2),
      maxConsecutiveWins: maxConsecWins,
      maxConsecutiveLosses: maxConsecLosses,
      totalFees: totalFees.toFixed(2),
      byRegime, bySignal, byExit, byMode, byAsset, byPattern,
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
    console.log('║   📊 BACKTEST REPORT v2.0 — 3-Mode System           ║');
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

    console.log('\n── By Mode ───────────────────────────────────────');
    for (const [mode, data] of Object.entries(s.byMode)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${mode.padEnd(12)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Asset ──────────────────────────────────────');
    for (const [asset, data] of Object.entries(s.byAsset)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${asset.padEnd(8)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Regime ─────────────────────────────────────');
    for (const [regime, data] of Object.entries(s.byRegime)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${regime.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Signal Type ────────────────────────────────');
    for (const [sig, data] of Object.entries(s.bySignal)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${sig.padEnd(20)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Exit Reason ────────────────────────────────');
    for (const [reason, data] of Object.entries(s.byExit)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${reason.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── Weekend vs Weekday ────────────────────────────');
    console.log(`  Weekday:  ${String(s.weekday.trades).padStart(4)} trades | ${s.weekday.winRate}% WR | PnL: $${s.weekday.pnl}`);
    console.log(`  Weekend:  ${String(s.weekend.trades).padStart(4)} trades | ${s.weekend.winRate}% WR | PnL: $${s.weekend.pnl}`);

    console.log('\n── By Entry Pattern ──────────────────────────────');
    for (const [pat, data] of Object.entries(s.byPattern)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${pat.padEnd(30)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
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

// ── CLI ────────────────────────────────────────────────────────────
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--symbol' && args[i + 1]) options.symbols = [args[++i]];
  if (args[i] === '--from' && args[i + 1]) options.startDate = args[++i];
  if (args[i] === '--to' && args[i + 1]) options.endDate = args[++i];
  if (args[i] === '--balance' && args[i + 1]) options.startingBalance = parseFloat(args[++i]);
  if (args[i] === '--exchange' && args[i + 1]) options.exchange = args[++i];
  if (args[i] === '--verbose' || args[i] === '-v') options.verbose = true;
}

const bt = new Backtester(options);
bt.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
