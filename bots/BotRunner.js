import fs from 'fs';
import path from 'path';
import config from '../config.js';
import PaperEngine from '../engine/PaperEngine.js';
import Feed from '../data/Feed.js';
import TradingViewWebhook from '../data/TradingViewWebhook.js';
import TelegramAlerter from '../alerts/TelegramAlerter.js';
import RegimeDetector from '../analysis/RegimeDetector.js';
import ICTAnalyzer from '../analysis/ICTAnalyzer.js';
import RealFootprintAnalyzer from '../analysis/RealFootprintAnalyzer.js';
import DaytradeMode from '../strategies/DaytradeMode.js';
import { getProfile } from '../config/assetProfiles.js';

/**
 * Per-asset paper trading bot.
 * Each bot runs independently: own engine, feed, analyzers, config.
 */
export default class BotRunner {
  constructor(botConfig = {}) {
    this.name = botConfig.name || 'BOT';
    this.symbol = botConfig.symbol;
    this.coin = this.symbol?.split('/')[0] || '?';
    this.dashboardUrl = botConfig.dashboardUrl || 'http://localhost:3500';

    // Merge bot-specific config overrides with base config
    this.cfg = this._mergeConfig(config, botConfig.configOverrides || {});

    // Dedicated instances — no shared state
    this.engine = new PaperEngine();
    this.feed = new Feed();
    this.webhook = new TradingViewWebhook(botConfig.webhookPort || 3456);
    this.telegram = new TelegramAlerter();
    this.regime = new RegimeDetector();
    this.ict = new ICTAnalyzer();
    this.footprint = new RealFootprintAnalyzer();
    this.daytrade = new DaytradeMode(this.regime, this.ict, this.footprint);

    this.running = false;
    this.lastRegime = null;
    this.dailySummarySent = false;
    this._latestFootprint = null;

    // Override engine starting balance if specified
    if (botConfig.startingBalance) {
      this.engine.balance = botConfig.startingBalance;
      this.engine.startingBalance = botConfig.startingBalance;
    }
  }

  async start() {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║   🤖 ${this.name.padEnd(47)}║`);
    console.log(`║   ${this.symbol.padEnd(50)}║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);

    // Initialize feed with only this bot's symbol
    this.feed.symbolsOverride = [this.symbol];
    await this.feed.init();
    await this.feed.loadInitialCandles();

    this.webhook.start();
    this.webhook.on('signal', (signal) => this._handleWebhookSignal(signal));

    this.feed.on('tick', (symbol, ticker) => this._onTick(symbol, ticker));
    this.feed.on('newCandle', (symbol, tf, candle) => this._onNewCandle(symbol, tf, candle));
    this.feed.on('footprint', (symbol, tf, candle, fp) => this._onFootprint(symbol, tf, candle, fp));

    this.feed.startPolling(3000);
    this.running = true;

    this._startDashboard();
    this._scheduleDailySummary();

    const profile = getProfile(this.symbol);
    await this.telegram.sendAlert(
      `🤖 ${this.name} started\n` +
      `Coin: ${this.coin}\n` +
      `Mode: Daytrade (1H ICT)\n` +
      `Regime filter: RANGING + VOL_EXPANSION (blocked: TRENDING_DOWN, LOW_VOL)\n` +
      `Profile: ${profile.name} | Risk: ${profile.riskMultiplier}x | SL: ${profile.slTightness}x`
    );

    console.log(`[${this.name}] Running. Ctrl+C to stop.\n`);

    // Start reporting to dashboard
    this._startStatusReporting();
  }

  _startStatusReporting() {
    const reportStatus = async () => {
      try {
        const stats = this.engine.getStats();
        const positions = [...this.engine.positions.values()];
        const regime = this.regime.getRegime(this.symbol);

        const payload = {
          status: 'online',
          symbol: this.symbol,
          coin: this.coin,
          balance: stats.balance,
          totalPnL: stats.totalPnL,
          totalPnLPercent: stats.totalPnLPercent,
          dailyPnL: stats.dailyPnL,
          totalTrades: stats.totalTrades,
          wins: stats.wins,
          losses: stats.losses,
          winRate: stats.winRate,
          profitFactor: stats.profitFactor,
          avgWin: stats.avgWin,
          avgLoss: stats.avgLoss,
          maxDrawdown: stats.maxDrawdown,
          totalFees: stats.totalFees,
          regime: regime.regime,
          regimeConfidence: regime.confidence,
          position: positions.length > 0 ? {
            side: positions[0].side,
            entryPrice: positions[0].entryPrice,
            stopLoss: positions[0].stopLoss,
            takeProfit: positions[0].takeProfit,
            unrealizedPnL: positions[0].unrealizedPnL,
            regime: positions[0].regime,
            reason: positions[0].reason,
          } : null,
          lastTrade: this.engine.trades.length > 0 ? {
            pnl: this.engine.trades[this.engine.trades.length - 1].pnl,
            closeReason: this.engine.trades[this.engine.trades.length - 1].closeReason,
          } : null,
        };

        await fetch(`${this.dashboardUrl}/api/bots/${this.coin.toLowerCase()}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        // Dashboard unreachable — silent fail
      }
    };

    // Report immediately, then every 3 seconds
    reportStatus();
    setInterval(reportStatus, 3000);
  }

  _onTick(symbol, ticker) {
    if (symbol !== this.symbol) return;

    const candles = this.feed.getCandles(symbol, this.cfg.timeframes.primary);
    const lastCandle = candles[candles.length - 1];
    const high = lastCandle?.high ?? ticker.last;
    const low = lastCandle?.low ?? ticker.last;

    const exitResult = this.engine.checkExits(symbol, ticker.last, high, low);
    if (exitResult?.ok) {
      const t = exitResult.trade;
      const emoji = t.pnl >= 0 ? '✅' : '❌';
      console.log(`${emoji} [${this.name}] ${t.closeReason.toUpperCase()} | PnL: $${t.pnl.toFixed(2)} (${t.pnlPercent.toFixed(2)}%) | ${t.regime}`);
      this.telegram.sendExit(t);

      // Report trade to dashboard
      fetch(`${this.dashboardUrl}/api/bots/${this.coin.toLowerCase()}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: t.symbol,
          side: t.side,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          pnl: t.pnl,
          pnlPercent: t.pnlPercent,
          closeReason: t.closeReason,
          regime: t.regime,
          reason: t.reason,
          durationMin: t.durationMin,
        }),
      }).catch(() => {});

      // Write trade to CSV for post-session analysis
      this._appendTradeCSV(t);
    }
  }

  _onNewCandle(symbol, timeframe) {
    if (symbol !== this.symbol) return;

    const candles1h = this.feed.getCandles(symbol, '1h');
    const candles15m = this.feed.getCandles(symbol, '15m');

    if (candles15m.length < 50) return;

    // Regime detection
    const regimeResult = this.regime.detect(symbol, candles1h);
    if (this.lastRegime && this.lastRegime !== regimeResult.regime) {
      console.log(`[${this.name}] Regime: ${this.lastRegime} → ${regimeResult.regime}`);
      this.telegram.sendRegimeChange(this.coin, this.lastRegime, regimeResult.regime);
    }
    this.lastRegime = regimeResult.regime;

    // Generate signal
    const signal = this.daytrade.generateSignal(symbol, candles1h, candles15m, this._latestFootprint);
    if (!signal) return;

    // Execute
    let riskPercent = this.cfg.risk[signal.regime]?.riskPercent || 0.5;
    const riskAmount = this.engine.balance * (riskPercent / 100);
    const slDist = Math.abs(signal.price - signal.stopLoss);
    const size = slDist > 0 ? riskAmount / slDist : 0;

    const result = this.engine.openPosition(
      symbol,
      signal.action === 'buy' ? 'long' : 'short',
      size,
      signal.price,
      signal.stopLoss,
      signal.takeProfit,
      signal.regime,
      this._formatReason(signal),
      signal.atr,
      signal.profile || getProfile(symbol)
    );

    if (result.ok) {
      const p = result.position;
      const sideEmoji = p.side === 'long' ? '🟢' : '🔴';
      const dataMode = this._latestFootprint ? '📊REAL' : '📐EST';
      console.log(`\n${sideEmoji} [${this.name}] ${p.side.toUpperCase()} @ ${p.entryPrice.toFixed(4)} ${dataMode}`);
      console.log(`   SL: ${p.stopLoss.toFixed(4)} | TP: ${p.takeProfit.toFixed(4)}`);
      console.log(`   Regime: ${p.regime} | Signal: ${p.reason}`);
      this.telegram.sendEntry(p);
    }
  }

  _onFootprint(symbol, tf, candle, footprint) {
    if (symbol !== this.symbol) return;
    if (tf !== this.cfg.timeframes.primary) return;

    this._latestFootprint = footprint;
    this.footprint.ingestRealFootprint(footprint);

    if (Math.abs(footprint.deltaPercent) > 30) {
      const dir = footprint.deltaPercent > 0 ? 'BULLISH' : 'BEARISH';
      console.log(`📊 [${this.name}] ${dir} flow: Δ${footprint.deltaPercent.toFixed(1)}% | ${footprint.trades} trades`);
    }
  }

  _handleWebhookSignal(signal) {
    if (signal.symbol !== this.symbol) return;

    const candles1h = this.feed.getCandles(this.symbol, '1h');
    const price = signal.price || this.feed.getLatestPrice(this.symbol);
    if (!price || candles1h.length < 50) return;

    const regime = this.regime.detect(this.symbol, candles1h);
    const riskParams = this.cfg.risk[regime.regime] || this.cfg.risk.RANGING;
    const atr = this._currentATR(candles1h);

    const sl = signal.stopLoss || (signal.action === 'buy' ? price - atr * riskParams.slMultiplier : price + atr * riskParams.slMultiplier);
    const tp = signal.takeProfit || (signal.action === 'buy' ? price + atr * riskParams.tpMultiplier : price - atr * riskParams.tpMultiplier);
    const riskAmount = this.engine.balance * (riskParams.riskPercent / 100);
    const slDist = Math.abs(price - sl);
    const size = slDist > 0 ? riskAmount / slDist : 0;

    const result = this.engine.openPosition(
      this.symbol, signal.action === 'buy' ? 'long' : 'short',
      size, price, sl, tp, regime.regime, 'TradingView Webhook', atr
    );

    if (result.ok) {
      console.log(`📡 [${this.name}] Webhook ${signal.action.toUpperCase()} @ ${price.toFixed(4)}`);
      this.telegram.sendEntry(result.position);
    }
  }

  _startDashboard() {
    setInterval(() => {
      const stats = this.engine.getStats();
      const positions = [...this.engine.positions.values()];
      const r = this.regime.getRegime(this.symbol);

      process.stdout.write('\x1B[2J\x1B[0f');

      console.log(`╔══════════════════════════════════════════════════════╗`);
      console.log(`║   🤖 ${this.name.padEnd(47)}║`);
      console.log(`╚══════════════════════════════════════════════════════╝\n`);

      console.log(`💰 Balance:       $${stats.balance.toFixed(2)}`);
      console.log(`📈 Total PnL:     $${stats.totalPnL.toFixed(2)} (${stats.totalPnLPercent.toFixed(2)}%)`);
      console.log(`📅 Daily PnL:     $${stats.dailyPnL.toFixed(2)}`);
      console.log(`🎯 Win Rate:      ${stats.winRate}% (${stats.wins}W / ${stats.losses}L)`);
      console.log(`📊 Profit Factor: ${stats.profitFactor}`);
      console.log(`📉 Max DD:        ${stats.maxDrawdown}`);
      console.log(`💵 Avg Win:       $${stats.avgWin} | Avg Loss: $${stats.avgLoss}`);
      console.log(`💸 Total Fees:    $${stats.totalFees.toFixed(2)}`);
      console.log(`📊 Trades:        ${stats.totalTrades}`);

      const regimeEmoji = { TRENDING: '📈', RANGING: '↔️', VOL_EXPANSION: '💥', LOW_VOL: '😴', ABSORPTION: '🧲' };
      const price = this.feed.getLatestPrice(this.symbol);
      const fp = this._latestFootprint;
      const deltaInfo = fp ? ` | Δ${fp.deltaPercent.toFixed(1)}%` : '';
      console.log(`\n── Market ─────────────────────────────────────────`);
      console.log(`  ${regimeEmoji[r.regime] || '❓'} ${r.regime} | ${price ? '$' + price.toFixed(4) : '...'}${deltaInfo}`);

      if (positions.length > 0) {
        console.log(`\n── Open Position ───────────────────────────────────`);
        for (const p of positions) {
          const pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
          const trailing = p.trailingActive ? ' 📉trail' : '';
          console.log(`  ${p.side.toUpperCase()} @ ${p.entryPrice.toFixed(4)} | uPnL: ${pnlSign}$${p.unrealizedPnL.toFixed(2)} | SL: ${p.stopLoss.toFixed(4)}${trailing}`);
        }
      }

      console.log('\n(Ctrl+C to stop)');
    }, 3000);
  }

  _scheduleDailySummary() {
    setInterval(() => {
      const now = new Date();
      if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0 && !this.dailySummarySent) {
        this.dailySummarySent = true;
        this.telegram.sendDailySummary(this.engine.getStats());
      }
      if (now.getUTCHours() === 0 && now.getUTCMinutes() === 1) this.dailySummarySent = false;
    }, 60000);
  }

  _appendTradeCSV(trade) {
    try {
      const dir = path.join(process.cwd(), 'live-results');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `trades-${this.coin.toLowerCase()}.csv`);
      const header = 'symbol,side,entryPrice,exitPrice,pnl,pnlPercent,closeReason,regime,reason,durationMin,totalFees,entryTime,exitTime\n';
      const row = [
        trade.symbol, trade.side, trade.entryPrice, trade.exitPrice,
        trade.pnl?.toFixed(4), trade.pnlPercent?.toFixed(4),
        trade.closeReason, trade.regime, `"${trade.reason}"`,
        trade.durationMin, trade.totalFees?.toFixed(4),
        new Date(trade.entryTime).toISOString(),
        new Date(trade.exitTime).toISOString(),
      ].join(',') + '\n';

      if (!fs.existsSync(file)) fs.writeFileSync(file, header);
      fs.appendFileSync(file, row);
    } catch (e) {
      // Silent fail — CSV export is best-effort
    }
  }

  _formatReason(signal) {
    const parts = [];
    if (signal.confluence) {
      parts.push(`CONFLUENCE: ${signal.confluenceSignals?.join(' + ')}`);
    } else {
      parts.push(signal.reason || signal.type);
    }
    if (signal.entryPattern) parts.push(`[${signal.entryPattern}]`);
    if (signal.realData) parts.push('[REAL]');
    return parts.join(' ');
  }

  _currentATR(candles, period = 14) {
    const tr = [];
    for (let i = Math.max(1, candles.length - period - 1); i < candles.length; i++) {
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    return tr.reduce((a, b) => a + b, 0) / tr.length;
  }

  _mergeConfig(base, overrides) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(overrides)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        merged[key] = this._mergeConfig(merged[key] || {}, value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  async stop() {
    const stats = this.engine.getStats();
    console.log(`\n── [${this.name}] Final Stats ──────────────────────────`);
    console.log(`  Balance: $${stats.balance.toFixed(2)} | PnL: $${stats.totalPnL.toFixed(2)} | WR: ${stats.winRate}%`);

    await this.telegram.sendAlert(`🛑 ${this.name} stopped. Balance: $${stats.balance.toFixed(2)}`);
    this.feed.stop();
    this.webhook.stop();
  }
}
