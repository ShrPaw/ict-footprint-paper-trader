import { EventEmitter } from 'events';
import ccxt from 'ccxt';
import config from '../config.js';

/**
 * Binance Futures Data Feed
 * Replaces HyperliquidFeed — uses ccxt for Binance USDⓈ-M perpetual futures.
 * Provides candles + estimated footprint from OHLCV (no trade-level data like Hyperliquid).
 * For live polling, fetches latest OHLCV candles periodically.
 */
export default class Feed extends EventEmitter {
  constructor() {
    super();
    this.exchange = null;
    this.candles = {};          // symbol -> { '1m': [...], '5m': [...], ... }
    this.running = false;
    this.pollInterval = null;
    this.symbolsOverride = null;
  }

  async init() {
    this.exchange = new ccxt.binance({
      enableRateLimit: true,
      options: { defaultType: 'future' },  // USDⓈ-M futures
    });

    const symbols = this.symbolsOverride || config.symbols;
    for (const symbol of symbols) {
      this.candles[symbol] = {};
      for (const [label, tf] of Object.entries(config.timeframes)) {
        this.candles[symbol][tf] = [];
      }
    }
    console.log(`[BinanceFeed] Initialized | Futures | ${symbols.join(', ')}`);
  }

  async loadInitialCandles() {
    const symbols = this.symbolsOverride || config.symbols;

    for (const symbol of symbols) {
      for (const [label, tf] of Object.entries(config.timeframes)) {
        try {
          const now = this.exchange.milliseconds();
          const lookback = config.data.candleLimit * this._tfToMs(tf);
          const since = now - lookback;

          const ohlcv = await this.exchange.fetchOHLCV(symbol, tf, since, config.data.candleLimit);

          const candles = ohlcv.map(c => ({
            timestamp: c[0],
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5],
          }));

          this.candles[symbol][tf] = candles;
          console.log(`[BinanceFeed] Loaded ${candles.length} ${tf} candles for ${symbol}`);

          await this._delay(this.exchange.rateLimit);
        } catch (err) {
          console.error(`[BinanceFeed] Error loading ${tf} for ${symbol}: ${err.message}`);
        }
      }
    }

    this.emit('ready', this.candles);
  }

  // ── Start Polling ────────────────────────────────────────────────
  startPolling(intervalMs = 5000) {
    if (this.running) return;
    this.running = true;
    console.log(`[BinanceFeed] Polling every ${intervalMs}ms`);

    this.pollInterval = setInterval(async () => {
      const symbols = this.symbolsOverride || config.symbols;
      for (const symbol of symbols) {
        try {
          // Fetch latest candles for all timeframes
          for (const [label, tf] of Object.entries(config.timeframes)) {
            const ohlcv = await this.exchange.fetchOHLCV(symbol, tf, undefined, 2);
            if (ohlcv.length < 2) continue;

            const arr = this.candles[symbol]?.[tf];
            if (!arr || arr.length === 0) continue;

            const latest = ohlcv[ohlcv.length - 1];
            const latestCandle = {
              timestamp: latest[0],
              open: latest[1],
              high: latest[2],
              low: latest[3],
              close: latest[4],
              volume: latest[5],
            };

            const lastStored = arr[arr.length - 1];

            if (latestCandle.timestamp > lastStored.timestamp) {
              // New candle — emit the completed one
              this.emit('newCandle', symbol, tf, lastStored);

              // Estimate footprint for completed candle
              const footprint = this._estimateFootprint(lastStored);
              if (footprint) {
                this.emit('footprint', symbol, tf, lastStored, footprint);
              }

              arr.push(latestCandle);
              if (arr.length > config.data.candleLimit) arr.shift();
            } else if (latestCandle.timestamp === lastStored.timestamp) {
              // Update current candle in-place
              lastStored.high = latestCandle.high;
              lastStored.low = latestCandle.low;
              lastStored.close = latestCandle.close;
              lastStored.volume = latestCandle.volume;
            }

            await this._delay(this.exchange.rateLimit * 0.5);
          }

          // Emit tick with latest price
          const latestPrice = this.candles[symbol]?.['1m']?.slice(-1)?.[0]?.close;
          if (latestPrice) {
            this.emit('tick', symbol, { last: latestPrice });
          }

        } catch (err) {
          console.error(`[BinanceFeed] Poll error for ${symbol}: ${err.message}`);
        }
      }
    }, intervalMs);
  }

  stop() {
    this.running = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  // ── Data Access ──────────────────────────────────────────────────
  getCandles(symbol, timeframe) {
    return this.candles[symbol]?.[timeframe] || [];
  }

  getLatestPrice(symbol) {
    const arr = this.candles[symbol]?.['1m'];
    if (!arr || arr.length === 0) return null;
    return arr[arr.length - 1].close;
  }

  // ── Estimate Footprint from OHLCV ───────────────────────────────
  // No trade-level data from ccxt fetchOHLCV — estimate delta from candle shape.
  // This is a fallback; RealFootprintAnalyzer already handles estimated data.
  _estimateFootprint(candle) {
    const range = candle.high - candle.low;
    if (range === 0 || candle.volume === 0) return null;

    const closePosition = (candle.close - candle.low) / range;
    const delta = (closePosition - 0.5) * 2 * candle.volume;

    return {
      trades: 0, // unknown
      buyVolume: candle.volume * closePosition,
      sellVolume: candle.volume * (1 - closePosition),
      totalVolume: candle.volume,
      delta,
      deltaPercent: (closePosition - 0.5) * 200,
      poc: candle.close, // estimate
      pocVolume: candle.volume,
      priceVolume: {},
      imbalances: [],
      vwap: (candle.high + candle.low + candle.close) / 3,
      estimated: true, // flag for downstream
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _tfToMs(tf) {
    const map = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };
    return map[tf] || 60000;
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
