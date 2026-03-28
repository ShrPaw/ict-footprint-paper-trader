import ccxt from 'ccxt';
import config from '../config.js';
import RegimeDetector from '../analysis/RegimeDetector.js';
import ICTAnalyzer from '../analysis/ICTAnalyzer.js';
import FootprintAnalyzer from '../analysis/FootprintAnalyzer.js';
import StrategyEngine from '../strategies/StrategyEngine.js';
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
    this.footprint = new FootprintAnalyzer();
    this.strategy = new StrategyEngine(this.regime, this.ict, this.footprint);
    this.position = null;
    this.dailyPnL = 0;
    this.lastResetDay = null;
    this.stats = null;

    // Config overrides
    this.symbols = options.symbols || config.symbols;
    this.timeframe = options.timeframe || config.timeframes.primary;
    this.startDate = options.startDate || null;
    this.endDate = options.endDate || null;
    this.verbose = options.verbose ?? false;
    this.exchangeId = options.exchange || config.data.exchange;
  }

  async run() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   📊 BACKTEST ENGINE v1.1                   ║');
    console.log('║   ICT + Footprint · Regime-Adaptive          ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    console.log(`  Exchange: ${this.exchangeId} | Timeframe: ${this.timeframe}`);

    const exchange = new ccxt[this.exchangeId]({ enableRateLimit: true });

    for (const symbol of this.symbols) {
      console.log(`\n── Backtesting ${symbol} (${this.timeframe}) ──────────`);

      try {
        const allCandles = await this._fetchHistoricalCandles(exchange, symbol);
        console.log(`  Loaded ${allCandles.length} candles`);

        if (allCandles.length < 100) {
          console.log(`  ⚠️  Not enough candles, skipping`);
          continue;
        }

        for (let i = 50; i < allCandles.length; i++) {
          const window = allCandles.slice(0, i + 1);
          const candle = allCandles[i];
          const timestamp = candle.timestamp;

          // Reset daily PnL
          const day = new Date(timestamp).toDateString();
          if (day !== this.lastResetDay) {
            this.dailyPnL = 0;
            this.lastResetDay = day;
          }

          // Check exits on current candle
          if (this.position) {
            this._checkExit(candle, timestamp);
          }

          // Generate signal if no position
          if (!this.position) {
            const signal = this.strategy.generateSignal(symbol, window);
            if (signal) {
              this._openPosition(symbol, signal, candle.close, timestamp);
            }
          }

          // Track equity
          const unrealizedPnL = this.position ? this._calcUnrealizedPnL(candle.close) : 0;
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

        // Close any remaining position
        if (this.position) {
          const lastCandle = allCandles[allCandles.length - 1];
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

  async _fetchHistoricalCandles(exchange, symbol) {
    const allCandles = [];
    let since = this.startDate ? new Date(this.startDate).getTime() : undefined;
    const endTime = this.endDate ? new Date(this.endDate).getTime() : Date.now();
    const limit = 1000;

    while (true) {
      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, this.timeframe, since, limit);
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
        console.error(`  Fetch error: ${err.message}`);
        break;
      }
    }

    return allCandles.filter(c => c.timestamp <= endTime);
  }

  _openPosition(symbol, signal, price, timestamp) {
    const riskParams = config.risk[signal.regime] || config.risk.RANGING;
    const slDistance = Math.abs(price - signal.stopLoss);
    if (slDistance === 0) return;

    // Use CURRENT balance for position sizing (not starting balance)
    // Weekend: half the risk
    let riskPercent = riskParams.riskPercent;
    if (signal.isWeekend) {
      riskPercent *= config.weekend.riskMultiplier;
    }
    const riskAmount = this.balance * (riskPercent / 100);
    const size = riskAmount / slDistance;
    const fee = size * price * config.engine.takerFee;
    const margin = (size * price) / 10;

    if (margin + fee > this.balance) return;

    // FIX: Use Math.abs for daily loss check
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
      entryTime: timestamp,
      fee,
      atr: signal.atr || Math.abs(signal.takeProfit - fillPrice) / 2,
      highestPrice: fillPrice,
      lowestPrice: fillPrice,
      breakevenTriggered: false,
      trailingActive: false,
      isWeekend: signal.isWeekend || false,
      entryPattern: signal.entryPattern || null,
    };

    this.balance -= fee;

    if (this.verbose) {
      const emoji = signal.action === 'buy' ? '📈' : '📉';
      const wknd = signal.isWeekend ? ' [WKND]' : '';
      const pat = signal.entryPattern ? ` [${signal.entryPattern}]` : '';
      console.log(`  ${emoji} ${signal.action.toUpperCase()} ${symbol} @ ${fillPrice.toFixed(4)} | SL: ${signal.stopLoss.toFixed(4)} | TP: ${signal.takeProfit.toFixed(4)} | ${signal.regime}${signal.confluence ? ' [CONFLUENCE: ' + signal.confluenceSignals?.join('+') + ']' : ''}${wknd}${pat}`);
    }
  }

  _checkExit(candle, timestamp) {
    const pos = this.position;
    const price = candle.close;
    const side = pos.side;

    // Track extremes
    if (side === 'long') {
      if (candle.high > pos.highestPrice) pos.highestPrice = candle.high;
    } else {
      if (candle.low < pos.lowestPrice) pos.lowestPrice = candle.low;
    }

    // ── Breakeven (FIXED: uses actual ATR, same logic as live) ─────
    if (!pos.breakevenTriggered) {
      const beActivation = pos.atr * config.engine.breakeven.activationATR;
      const offset = pos.entryPrice * config.engine.breakeven.offset;

      if (side === 'long' && candle.high >= pos.entryPrice + beActivation) {
        pos.stopLoss = pos.entryPrice + offset;
        pos.breakevenTriggered = true;
      } else if (side === 'short' && candle.low <= pos.entryPrice - beActivation) {
        pos.stopLoss = pos.entryPrice - offset;
        pos.breakevenTriggered = true;
      }
    }

    // ── Trailing Stop (FIXED: uses actual ATR, same logic as live) ─
    if (config.engine.trailingStop.enabled) {
      const activationDist = pos.atr * config.engine.trailingStop.activationATR;
      const trailDist = pos.atr * config.engine.trailingStop.trailATR;

      if (!pos.trailingActive) {
        if (side === 'long' && candle.high >= pos.entryPrice + activationDist) {
          pos.trailingActive = true;
        } else if (side === 'short' && candle.low <= pos.entryPrice - activationDist) {
          pos.trailingActive = true;
        }
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

    // Check SL hit
    if (side === 'long' && candle.low <= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      this._closePosition(pos.stopLoss, timestamp, reason);
      return;
    }
    if (side === 'short' && candle.high >= pos.stopLoss) {
      const reason = pos.trailingActive ? 'trailing_sl' : pos.breakevenTriggered ? 'breakeven_sl' : 'stop_loss';
      this._closePosition(pos.stopLoss, timestamp, reason);
      return;
    }

    // Check TP hit
    if (side === 'long' && candle.high >= pos.takeProfit) {
      this._closePosition(pos.takeProfit, timestamp, 'take_profit');
      return;
    }
    if (side === 'short' && candle.low <= pos.takeProfit) {
      this._closePosition(pos.takeProfit, timestamp, 'take_profit');
      return;
    }

    // Time-based exit: close after 4 hours if not in profit
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

    const priceDiff = pos.side === 'long'
      ? fillPrice - pos.entryPrice
      : pos.entryPrice - fillPrice;

    const pnl = priceDiff * pos.size - pos.fee - fee;
    const pnlPercent = pnl / (pos.size * pos.entryPrice) * 100;
    const duration = timestamp - pos.entryTime;

    this.balance += pnl;
    this.dailyPnL += pnl;

    const trade = {
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      exitPrice: fillPrice,
      entryTime: pos.entryTime,
      exitTime: timestamp,
      closeReason: reason,
      regime: pos.regime,
      signalType: pos.signalType,
      reason: pos.reason,
      pnl,
      pnlPercent,
      totalFees: pos.fee + fee,
      duration,
      durationMin: Math.round(duration / 60000),
      breakevenTriggered: pos.breakevenTriggered,
      isWeekend: pos.isWeekend || false,
      entryPattern: pos.entryPattern || null,
    };

    this.trades.push(trade);
    this.position = null;

    if (this.verbose) {
      const emoji = pnl >= 0 ? '✅' : '❌';
      console.log(`  ${emoji} CLOSE ${trade.side.toUpperCase()} @ ${fillPrice.toFixed(4)} | PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) | ${reason} | ${trade.durationMin}min`);
    }
  }

  _calcUnrealizedPnL(currentPrice) {
    const pos = this.position;
    if (!pos) return 0;
    return pos.side === 'long'
      ? (currentPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - currentPrice) * pos.size;
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
    const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : Infinity;

    const winRate = trades.length ? wins.length / trades.length : 0;
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // Sharpe ratio
    const dailyReturns = [];
    const dayMap = {};
    for (const point of this.equityCurve) {
      const day = new Date(point.timestamp).toDateString();
      dayMap[day] = point.equity;
    }
    const days = Object.values(dayMap);
    for (let i = 1; i < days.length; i++) {
      dailyReturns.push((days[i] - days[i - 1]) / days[i - 1]);
    }
    const avgReturn = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdDev = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1))
      : 0;
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;

    const downsideReturns = dailyReturns.filter(r => r < 0);
    const downsideStd = downsideReturns.length > 1
      ? Math.sqrt(downsideReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / (downsideReturns.length - 1))
      : 0;
    const sortino = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(365) : 0;

    const durations = trades.map(t => t.durationMin);
    const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    let maxConsecWins = 0, maxConsecLosses = 0, curWins = 0, curLosses = 0;
    for (const t of trades) {
      if (t.pnl > 0) { curWins++; curLosses = 0; } else { curLosses++; curWins = 0; }
      maxConsecWins = Math.max(maxConsecWins, curWins);
      maxConsecLosses = Math.max(maxConsecLosses, curLosses);
    }

    const byRegime = {};
    for (const t of trades) {
      if (!byRegime[t.regime]) byRegime[t.regime] = { trades: 0, wins: 0, pnl: 0 };
      byRegime[t.regime].trades++;
      if (t.pnl > 0) byRegime[t.regime].wins++;
      byRegime[t.regime].pnl += t.pnl;
    }

    const bySignal = {};
    for (const t of trades) {
      const sig = t.signalType || 'unknown';
      if (!bySignal[sig]) bySignal[sig] = { trades: 0, wins: 0, pnl: 0 };
      bySignal[sig].trades++;
      if (t.pnl > 0) bySignal[sig].wins++;
      bySignal[sig].pnl += t.pnl;
    }

    const byExit = {};
    for (const t of trades) {
      if (!byExit[t.closeReason]) byExit[t.closeReason] = { trades: 0, wins: 0, pnl: 0 };
      byExit[t.closeReason].trades++;
      if (t.pnl > 0) byExit[t.closeReason].wins++;
      byExit[t.closeReason].pnl += t.pnl;
    }

    // Weekend vs Weekday breakdown
    const weekendTrades = trades.filter(t => t.isWeekend);
    const weekdayTrades = trades.filter(t => !t.isWeekend);
    const weekendWins = weekendTrades.filter(t => t.pnl > 0);
    const weekdayWins = weekdayTrades.filter(t => t.pnl > 0);

    // Entry pattern breakdown
    const byPattern = {};
    for (const t of trades) {
      const pat = t.entryPattern || 'no_pattern';
      if (!byPattern[pat]) byPattern[pat] = { trades: 0, wins: 0, pnl: 0 };
      byPattern[pat].trades++;
      if (t.pnl > 0) byPattern[pat].wins++;
      byPattern[pat].pnl += t.pnl;
    }

    this.stats = {
      startingBalance: this.startingBalance,
      finalBalance: this.balance,
      totalPnL,
      totalPnLPercent: ((this.balance - this.startingBalance) / this.startingBalance) * 100,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (winRate * 100).toFixed(1),
      grossProfit,
      grossLoss,
      profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
      expectancy: expectancy.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      winLossRatio: winLossRatio === Infinity ? '∞' : winLossRatio.toFixed(2),
      largestWin: wins.length ? Math.max(...wins.map(t => t.pnl)).toFixed(2) : 0,
      largestLoss: losses.length ? Math.min(...losses.map(t => t.pnl)).toFixed(2) : 0,
      maxDrawdown: this.maxDrawdown.toFixed(2),
      maxDrawdownPercent: (this.maxDrawdownPercent * 100).toFixed(2),
      sharpeRatio: sharpe.toFixed(2),
      sortinoRatio: sortino.toFixed(2),
      maxConsecutiveWins: maxConsecWins,
      maxConsecutiveLosses: maxConsecLosses,
      avgDurationMin: avgDuration.toFixed(0),
      totalFees: totalFees.toFixed(2),
      byRegime,
      bySignal,
      byExit,
      byPattern,
      weekend: {
        trades: weekendTrades.length,
        wins: weekendWins.length,
        winRate: weekendTrades.length ? ((weekendWins.length / weekendTrades.length) * 100).toFixed(1) : '0',
        pnl: weekendTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      },
      weekday: {
        trades: weekdayTrades.length,
        wins: weekdayWins.length,
        winRate: weekdayTrades.length ? ((weekdayWins.length / weekdayTrades.length) * 100).toFixed(1) : '0',
        pnl: weekdayTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      },
    };
  }

  _printReport() {
    const s = this.stats;

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   📊 BACKTEST REPORT                        ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    console.log('── Performance ──────────────────────────────');
    console.log(`  Starting Balance:  $${s.startingBalance.toFixed(2)}`);
    console.log(`  Final Balance:     $${s.finalBalance.toFixed(2)}`);
    console.log(`  Total PnL:         $${s.totalPnL.toFixed(2)} (${s.totalPnLPercent}%)`);
    console.log(`  Total Fees:        $${s.totalFees}`);

    console.log('\n── Trade Stats ──────────────────────────────');
    console.log(`  Total Trades:      ${s.totalTrades}`);
    console.log(`  Win Rate:          ${s.winRate}% (${s.wins}W / ${s.losses}L)`);
    console.log(`  Profit Factor:     ${s.profitFactor}`);
    console.log(`  Expectancy:        $${s.expectancy}/trade`);
    console.log(`  Avg Win:           $${s.avgWin} | Avg Loss: $${s.avgLoss}`);
    console.log(`  Win/Loss Ratio:    ${s.winLossRatio}`);
    console.log(`  Largest Win:       $${s.largestWin}`);
    console.log(`  Largest Loss:      $${s.largestLoss}`);

    console.log('\n── Risk ─────────────────────────────────────');
    console.log(`  Max Drawdown:      $${s.maxDrawdown} (${s.maxDrawdownPercent}%)`);
    console.log(`  Sharpe Ratio:      ${s.sharpeRatio}`);
    console.log(`  Sortino Ratio:     ${s.sortinoRatio}`);

    console.log('\n── Streaks ──────────────────────────────────');
    console.log(`  Max Consec Wins:   ${s.maxConsecutiveWins}`);
    console.log(`  Max Consec Losses: ${s.maxConsecutiveLosses}`);
    console.log(`  Avg Duration:      ${s.avgDurationMin} min`);

    console.log('\n── By Regime ────────────────────────────────');
    for (const [regime, data] of Object.entries(s.byRegime)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${regime.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Signal Type ───────────────────────────');
    for (const [sig, data] of Object.entries(s.bySignal)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${sig.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── By Exit Reason ───────────────────────────');
    for (const [reason, data] of Object.entries(s.byExit)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${reason.padEnd(16)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── Weekend vs Weekday ───────────────────────');
    console.log(`  Weekday:  ${String(s.weekday.trades).padStart(4)} trades | ${s.weekday.winRate}% WR | PnL: $${s.weekday.pnl}`);
    console.log(`  Weekend:  ${String(s.weekend.trades).padStart(4)} trades | ${s.weekend.winRate}% WR | PnL: $${s.weekend.pnl}`);

    console.log('\n── By Entry Pattern ────────────────────────');
    for (const [pat, data] of Object.entries(s.byPattern)) {
      const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : '0';
      console.log(`  ${pat.padEnd(28)} ${String(data.trades).padStart(4)} trades | ${wr}% WR | PnL: $${data.pnl.toFixed(2)}`);
    }

    console.log('\n── Last 10 Trades ──────────────────────────');
    for (const t of this.trades.slice(-10)) {
      const emoji = t.pnl >= 0 ? '✅' : '❌';
      const date = new Date(t.entryTime).toISOString().slice(0, 16);
      const wknd = t.isWeekend ? 'W' : ' ';
      const pat = t.entryPattern ? ` [${t.entryPattern}]` : '';
      console.log(`  ${emoji} ${wknd} ${date} ${t.side.toUpperCase().padEnd(5)} ${t.symbol.padEnd(18)} PnL: $${t.pnl.toFixed(2).padStart(8)} (${t.pnlPercent.toFixed(2)}%) ${t.closeReason}${pat}`);
    }

    console.log('\n');
  }

  _exportResults() {
    const outputDir = path.join(process.cwd(), 'backtest-results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const tradesCSV = [
      'symbol,side,entryPrice,exitPrice,entryTime,exitTime,pnl,pnlPercent,regime,signalType,closeReason,durationMin,totalFees,breakevenTriggered,isWeekend,entryPattern',
      ...this.trades.map(t =>
        `${t.symbol},${t.side},${t.entryPrice},${t.exitPrice},${new Date(t.entryTime).toISOString()},${new Date(t.exitTime).toISOString()},${t.pnl.toFixed(4)},${t.pnlPercent.toFixed(4)},${t.regime},${t.signalType},${t.closeReason},${t.durationMin},${t.totalFees.toFixed(4)},${t.breakevenTriggered},${t.isWeekend},${t.entryPattern || ''}`
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

// ── Run ────────────────────────────────────────────────────────────
const options = {};

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--symbol' && args[i + 1]) options.symbols = [args[++i]];
  if (args[i] === '--timeframe' && args[i + 1]) options.timeframe = args[++i];
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
