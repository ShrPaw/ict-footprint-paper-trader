import config from '../config.js';
import HyperliquidEngine from '../engine/HyperliquidEngine.js';
import HyperliquidFeed from '../data/HyperliquidFeed.js';
import TradingViewWebhook from '../data/TradingViewWebhook.js';
import TelegramAlerter from '../alerts/TelegramAlerter.js';
import RegimeDetector from '../analysis/RegimeDetector.js';
import ICTAnalyzer from '../analysis/ICTAnalyzer.js';
import RealFootprintAnalyzer from '../analysis/RealFootprintAnalyzer.js';
import DaytradeMode from '../strategies/DaytradeMode.js';
import { getProfile } from '../config/assetProfiles.js';

/**
 * Per-asset bot with real Hyperliquid testnet execution.
 * Replaces PaperEngine with HyperliquidEngine for real order fills.
 */
export default class LiveBotRunner {
  constructor(botConfig = {}) {
    this.name = botConfig.name || 'LIVE-BOT';
    this.symbol = botConfig.symbol;
    this.coin = this.symbol?.split('/')[0] || '?';

    this.cfg = this._mergeConfig(config, botConfig.configOverrides || {});

    // Real exchange engine instead of paper
    this.engine = new HyperliquidEngine();
    this.feed = new HyperliquidFeed();
    this.webhook = new TradingViewWebhook(botConfig.webhookPort || 3456);
    this.telegram = new TelegramAlerter();
    this.regime = new RegimeDetector();
    this.ict = new ICTAnalyzer();
    this.footprint = new RealFootprintAnalyzer();
    this.daytrade = new DaytradeMode(this.regime, this.ict, this.footprint);

    this.running = false;
    this.lastRegime = null;
    this._latestFootprint = null;
  }

  async start() {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║   🔴 LIVE ${this.name.padEnd(44)}║`);
    console.log(`║   ${this.symbol.padEnd(50)}║`);
    console.log(`║   Hyperliquid Testnet                               ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);

    // Initialize exchange connection
    await this.engine.init();

    // Initialize data feed
    this.feed.symbolsOverride = [this.symbol];
    await this.feed.init();
    await this.feed.loadInitialCandles();

    this.webhook.start();

    this.feed.on('tick', (symbol, ticker) => this._onTick(symbol, ticker));
    this.feed.on('newCandle', (symbol, tf, candle) => this._onNewCandle(symbol, tf, candle));
    this.feed.on('footprint', (symbol, tf, candle, fp) => this._onFootprint(symbol, tf, candle, fp));

    this.feed.startPolling(3000);
    this.running = true;

    this._startDashboard();

    const profile = getProfile(this.symbol);
    await this.telegram.sendAlert(
      `🔴 ${this.name} LIVE on Hyperliquid testnet\n` +
      `Coin: ${this.coin}\n` +
      `Real orders, fake money\n` +
      `Profile: ${profile.name}`
    );

    console.log(`[${this.name}] LIVE. Ctrl+C to stop.\n`);
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

        await fetch(`http://localhost:3500/api/bots/${this.coin.toLowerCase()}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {}
    };
    reportStatus();
    setInterval(reportStatus, 3000);
  }

  async _onTick(symbol, ticker) {
    if (symbol !== this.symbol) return;

    const candles = this.feed.getCandles(symbol, this.cfg.timeframes.primary);
    const lastCandle = candles[candles.length - 1];
    const high = lastCandle?.high ?? ticker.last;
    const low = lastCandle?.low ?? ticker.last;

    const exitResult = await this.engine.checkExits(symbol, ticker.last, high, low);
    if (exitResult?.ok) {
      const t = exitResult.trade;
      const emoji = t.pnl >= 0 ? '✅' : '❌';
      console.log(`${emoji} [${this.name}] ${t.closeReason.toUpperCase()} | PnL: $${t.pnl.toFixed(2)} (${t.pnlPercent.toFixed(2)}%) | ${t.regime}`);
      this.telegram.sendExit(t);
    }
  }

  async _onNewCandle(symbol, timeframe) {
    if (symbol !== this.symbol) return;

    const candles1h = this.feed.getCandles(symbol, '1h');
    const candles15m = this.feed.getCandles(symbol, '15m');

    if (candles15m.length < 50) return;

    const regimeResult = this.regime.detect(symbol, candles1h);
    if (this.lastRegime && this.lastRegime !== regimeResult.regime) {
      console.log(`[${this.name}] Regime: ${this.lastRegime} → ${regimeResult.regime}`);
      this.telegram.sendRegimeChange(this.coin, this.lastRegime, regimeResult.regime);
    }
    this.lastRegime = regimeResult.regime;

    const signal = this.daytrade.generateSignal(symbol, candles1h, candles15m, this._latestFootprint);
    if (!signal) return;

    let riskPercent = this.cfg.risk[signal.regime]?.riskPercent || 0.5;
    const riskAmount = this.engine.balance * (riskPercent / 100);
    const slDist = Math.abs(signal.price - signal.stopLoss);
    const size = slDist > 0 ? riskAmount / slDist : 0;

    const result = await this.engine.openPosition(
      symbol,
      signal.action === 'buy' ? 'long' : 'short',
      size,
      signal.price,
      signal.stopLoss,
      signal.takeProfit,
      signal.regime,
      this._formatReason(signal),
      signal.atr
    );

    if (result.ok) {
      const p = result.position;
      const sideEmoji = p.side === 'long' ? '🟢' : '🔴';
      console.log(`\n${sideEmoji} [${this.name}] ${p.side.toUpperCase()} @ ${p.entryPrice.toFixed(4)} 🔴LIVE`);
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

  _startDashboard() {
    setInterval(() => {
      const stats = this.engine.getStats();
      const positions = [...this.engine.positions.values()];
      const r = this.regime.getRegime(this.symbol);

      process.stdout.write('\x1B[2J\x1B[0f');

      console.log(`╔══════════════════════════════════════════════════════╗`);
      console.log(`║   🔴 LIVE ${this.name.padEnd(44)}║`);
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

      console.log('\n🔴 LIVE on Hyperliquid Testnet (Ctrl+C to stop)');
    }, 3000);
  }

  _formatReason(signal) {
    const parts = [];
    if (signal.confluence) {
      parts.push(`CONFLUENCE: ${signal.confluenceSignals?.join(' + ')}`);
    } else {
      parts.push(signal.reason || signal.type);
    }
    if (signal.entryPattern) parts.push(`[${signal.entryPattern}]`);
    return parts.join(' ');
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
