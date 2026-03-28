import config from './config.js';
import PaperEngine from './engine/PaperEngine.js';
import HyperliquidFeed from './data/HyperliquidFeed.js';
import TradingViewWebhook from './data/TradingViewWebhook.js';
import TelegramAlerter from './alerts/TelegramAlerter.js';
import RegimeDetector from './analysis/RegimeDetector.js';
import ICTAnalyzer from './analysis/ICTAnalyzer.js';
import RealFootprintAnalyzer from './analysis/RealFootprintAnalyzer.js';
import StrategyEngine from './strategies/StrategyEngine.js';

class PaperTrader {
  constructor() {
    this.engine = new PaperEngine();
    this.feed = new HyperliquidFeed();
    this.webhook = new TradingViewWebhook(3456);
    this.telegram = new TelegramAlerter();
    this.regime = new RegimeDetector();
    this.ict = new ICTAnalyzer();
    this.footprint = new RealFootprintAnalyzer();
    this.strategy = new StrategyEngine(this.regime, this.ict, this.footprint);
    this.running = false;
    this.lastRegime = {};
    this.dailySummarySent = false;
    this._latestFootprint = {};  // symbol -> latest real footprint
  }

  async start() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   ICT + Footprint Paper Trader v0.5         ║');
    console.log('║   Hyperliquid · Real Order Flow · Telegram   ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    await this.feed.init();
    await this.feed.loadInitialCandles();

    this.webhook.start();
    this.webhook.on('signal', (signal) => this._handleWebhookSignal(signal));

    this.feed.on('tick', (symbol, ticker) => this._onTick(symbol, ticker));
    this.feed.on('newCandle', (symbol, tf, candle) => this._onNewCandle(symbol, tf, candle));
    this.feed.on('footprint', (symbol, tf, candle, footprint) => this._onFootprint(symbol, tf, candle, footprint));
    this.feed.on('book', (symbol, book) => this._onBook(symbol, book));

    this.feed.startPolling(3000);
    this.running = true;

    this._startDashboard();
    this._scheduleDailySummary();

    const coins = config.symbols.map(s => s.split('/')[0]);
    await this.telegram.sendAlert('🚀 Paper Trader v0.5 started on Hyperliquid\nCoins: ' + coins.join(', ') + '\nMode: Footprint-led, Real Order Flow');

    console.log('[Trader] Engine running. Press Ctrl+C to stop.\n');
  }

  // ── Tick Handler (check SL/TP) ───────────────────────────────────
  _onTick(symbol, ticker) {
    const candle = this.feed.getCandles(symbol, config.timeframes.primary);
    const lastCandle = candle[candle.length - 1];
    const high = lastCandle?.high ?? ticker.last;
    const low = lastCandle?.low ?? ticker.last;

    const exitResult = this.engine.checkExits(symbol, ticker.last, high, low);
    if (exitResult?.ok) {
      const t = exitResult.trade;
      const emoji = t.pnl >= 0 ? '✅' : '❌';
      console.log(`${emoji} [${symbol}] ${t.closeReason.toUpperCase()} | PnL: $${t.pnl.toFixed(2)} (${t.pnlPercent.toFixed(2)}%) | ${t.regime}`);

      this.telegram.sendExit(t);
    }
  }

  // ── New Candle Handler ───────────────────────────────────────────
  _onNewCandle(symbol, timeframe) {
    if (timeframe !== config.timeframes.primary) return;

    const candles = this.feed.getCandles(symbol, config.timeframes.primary);
    if (candles.length < 50) return;

    // Regime change detection
    const regimeResult = this.regime.detect(symbol, candles);
    const prevRegime = this.lastRegime[symbol];
    if (prevRegime && prevRegime !== regimeResult.regime) {
      console.log(`[${symbol}] Regime: ${prevRegime} → ${regimeResult.regime}`);
      this.telegram.sendRegimeChange(symbol, prevRegime, regimeResult.regime);
    }
    this.lastRegime[symbol] = regimeResult.regime;

    // Run strategy with latest real footprint and 1h context
    const realFP = this._latestFootprint[symbol] || null;
    const contextCandles = config.multiTimeframe.enabled
      ? this.feed.getCandles(symbol, config.multiTimeframe.contextTimeframe)
      : null;
    const signal = this.strategy.generateSignal(symbol, candles, realFP, contextCandles);
    if (!signal) return;

    // Execute
    let riskPercent = config.risk[signal.regime]?.riskPercent || 0.5;
    if (signal.isWeekend) riskPercent *= config.weekend.riskMultiplier;

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
      signal.atr
    );

    if (result.ok) {
      const p = result.position;
      const regimeEmoji = {
        TRENDING: '📈', RANGING: '↔️', VOL_EXPANSION: '💥',
        LOW_VOL: '😴', ABSORPTION: '🧲',
      };
      const dataMode = realFP ? '📊REAL' : '📐EST';
      console.log(`\n${regimeEmoji[p.regime] || '🎯'} [${p.symbol}] ${p.side.toUpperCase()} @ ${p.entryPrice.toFixed(4)} ${dataMode}`);
      console.log(`   SL: ${p.stopLoss.toFixed(4)} | TP: ${p.takeProfit.toFixed(4)}`);
      console.log(`   Regime: ${p.regime} | Signal: ${p.reason}`);

      this.telegram.sendEntry(p);
    }
  }

  // ── Real Footprint Handler ───────────────────────────────────────
  _onFootprint(symbol, tf, candle, footprint) {
    if (tf !== config.timeframes.primary) return;

    this._latestFootprint[symbol] = footprint;
    this.footprint.ingestRealFootprint(footprint);

    // Log significant footprint events
    if (Math.abs(footprint.deltaPercent) > 30) {
      const dir = footprint.deltaPercent > 0 ? 'BULLISH' : 'BEARISH';
      console.log(`📊 [${symbol}] ${dir} flow: Δ${footprint.deltaPercent.toFixed(1)}% | ${footprint.trades} trades | POC: ${footprint.poc?.toFixed(4)}`);
    }
  }

  // ── Book Handler ─────────────────────────────────────────────────
  _onBook(symbol, book) {
    // Book data available for future signals (depth analysis)
    // Currently used by footprint analyzer for volume shelf detection
  }

  // ── TradingView Webhook Handler ───────────────────────────────────
  _handleWebhookSignal(signal) {
    if (!signal.symbol || !signal.action) return;

    const candles = this.feed.getCandles(signal.symbol, config.timeframes.primary);
    const price = signal.price || this.feed.getLatestPrice(signal.symbol);
    if (!price) return;

    const regime = this.regime.detect(signal.symbol, candles);
    const riskParams = config.risk[regime.regime] || config.risk.RANGING;
    const atr = candles.length > 15 ? this._currentATR(candles) : price * 0.005;

    const sl = signal.stopLoss || (signal.action === 'buy' ? price - atr * riskParams.slMultiplier : price + atr * riskParams.slMultiplier);
    const tp = signal.takeProfit || (signal.action === 'buy' ? price + atr * riskParams.tpMultiplier : price - atr * riskParams.tpMultiplier);
    const riskAmount = this.engine.balance * (riskParams.riskPercent / 100);
    const slDist = Math.abs(price - sl);
    const size = slDist > 0 ? riskAmount / slDist : 0;

    const result = this.engine.openPosition(
      signal.symbol,
      signal.action === 'buy' ? 'long' : 'short',
      size,
      price, sl, tp,
      regime.regime,
      'TradingView Webhook',
      atr
    );

    if (result.ok) {
      console.log(`📡 [Webhook] ${signal.action.toUpperCase()} ${signal.symbol} @ ${price.toFixed(4)}`);
      this.telegram.sendEntry(result.position);
    }
  }

  // ── Dashboard ────────────────────────────────────────────────────
  _startDashboard() {
    setInterval(() => {
      const stats = this.engine.getStats();
      const positions = [...this.engine.positions.values()];

      process.stdout.write('\x1B[2J\x1B[0f');

      console.log('╔══════════════════════════════════════════════╗');
      console.log('║   📊 PAPER TRADER DASHBOARD v0.5            ║');
      console.log('║   Hyperliquid · Real Order Flow              ║');
      console.log('╚══════════════════════════════════════════════╝\n');

      console.log(`💰 Balance:      $${stats.balance.toFixed(2)}`);
      console.log(`📈 Total PnL:    $${stats.totalPnL.toFixed(2)} (${stats.totalPnLPercent.toFixed(2)}%)`);
      console.log(`📅 Daily PnL:    $${stats.dailyPnL.toFixed(2)}`);
      console.log(`🎯 Win Rate:     ${stats.winRate}% (${stats.wins}W / ${stats.losses}L)`);
      console.log(`📊 Profit Factor: ${stats.profitFactor}`);
      console.log(`📉 Max DD:       ${stats.maxDrawdown}`);
      console.log(`💵 Avg Win:      $${stats.avgWin} | Avg Loss: $${stats.avgLoss}`);
      console.log(`💸 Total Fees:   $${stats.totalFees.toFixed(2)}`);
      console.log(`📊 Trades:       ${stats.totalTrades}`);

      // Real data status
      console.log('\n── Data Source ────────────────────────────');
      for (const symbol of config.symbols) {
        const coin = symbol.split('/')[0];
        const fp = this._latestFootprint[coin];
        const trades = this.feed.getTrades(coin);
        const mode = fp ? `📊 REAL (${trades.length} trades buffered)` : '📐 ESTIMATED';
        console.log(`  ${coin.padEnd(8)} ${mode}`);
      }

      // Regime status
      console.log('\n── Market Regimes ──────────────────────────');
      for (const symbol of config.symbols) {
        const coin = symbol.split('/')[0];
        const r = this.regime.getRegime(symbol);
        const price = this.feed.getLatestPrice(symbol);
        const regimeEmoji = {
          TRENDING: '📈', RANGING: '↔️', VOL_EXPANSION: '💥',
          LOW_VOL: '😴', ABSORPTION: '🧲',
        };
        const fp = this._latestFootprint[coin];
        const deltaInfo = fp ? ` | Δ${fp.deltaPercent.toFixed(1)}%` : '';
        console.log(`  ${coin.padEnd(8)} ${regimeEmoji[r.regime] || '❓'} ${r.regime.padEnd(14)} ${price ? '$' + price.toFixed(4) : '...'}${deltaInfo}`);
      }

      // Open positions
      if (positions.length > 0) {
        console.log('\n── Open Positions ──────────────────────────');
        for (const p of positions) {
          const pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
          const trailing = p.trailingActive ? ' 📉trail' : '';
          console.log(`  ${p.symbol.padEnd(8)} ${p.side.padEnd(5)} @ ${p.entryPrice.toFixed(4)} | uPnL: ${pnlSign}$${p.unrealizedPnL.toFixed(2)} | SL: ${p.stopLoss.toFixed(4)} | ${p.regime}${trailing}`);
        }
      }

      console.log('\n(Ctrl+C to stop)');
    }, 3000);
  }

  // ── Daily Summary ────────────────────────────────────────────────
  _scheduleDailySummary() {
    setInterval(() => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMin = now.getUTCMinutes();

      if (utcHour === 0 && utcMin === 0 && !this.dailySummarySent) {
        this.dailySummarySent = true;
        const stats = this.engine.getStats();
        this.telegram.sendDailySummary(stats);
      }
      if (utcHour === 0 && utcMin === 1) {
        this.dailySummarySent = false;
      }
    }, 60000);
  }

  // ── Helpers ──────────────────────────────────────────────────────
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
}

// ── Run ────────────────────────────────────────────────────────────
const trader = new PaperTrader();
trader.start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n\n── Final Stats ──────────────────────────────');
  const stats = trader.engine.getStats();
  console.log(JSON.stringify(stats, null, 2));

  if (trader.engine.trades.length > 0) {
    console.log('\n── Trade Log ─────────────────────────────────');
    for (const t of trader.engine.trades.slice(-10)) {
      const emoji = t.pnl >= 0 ? '✅' : '❌';
      console.log(`${emoji} ${t.symbol} ${t.side} $${t.pnl.toFixed(2)} (${t.pnlPercent.toFixed(2)}%) ${t.closeReason} [${t.regime}]`);
    }
  }

  await trader.telegram.sendAlert('🛑 Paper Trader stopped. Final balance: $' + stats.balance.toFixed(2));

  trader.feed.stop();
  trader.webhook.stop();
  process.exit(0);
});
