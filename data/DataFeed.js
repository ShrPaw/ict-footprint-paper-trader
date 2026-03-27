import ccxt from 'ccxt';
import { EventEmitter } from 'events';
import config from '../config.js';

export default class DataFeed extends EventEmitter {
  constructor() {
    super();
    this.exchange = null;
    this.candles = {};       // symbol -> { '1m': [...], '5m': [...], ... }
    this.tickers = {};       // symbol -> latest ticker
    this.running = false;
    this.pollInterval = null;
  }

  async init() {
    const ExchangeClass = ccxt[config.data.exchange];
    if (!ExchangeClass) throw new Error(`Exchange ${config.data.exchange} not found in ccxt`);

    this.exchange = new ExchangeClass({
      enableRateLimit: true,
      options: { defaultType: 'swap' }, // perpetuals
    });

    if (config.data.useTestnet && this.exchange.urls?.test) {
      this.exchange.setSandboxMode(true);
    }

    // Initialize candle storage for each symbol + timeframe
    for (const symbol of config.symbols) {
      this.candles[symbol] = {};
      for (const [label, tf] of Object.entries(config.timeframes)) {
        this.candles[symbol][tf] = [];
      }
    }

    console.log(`[DataFeed] Initialized ${config.data.exchange} | ${config.symbols.join(', ')}`);
  }

  async loadInitialCandles() {
    for (const symbol of config.symbols) {
      for (const [label, tf] of Object.entries(config.timeframes)) {
        try {
          const ohlcv = await this.exchange.fetchOHLCV(symbol, tf, undefined, config.data.candleLimit);
          this.candles[symbol][tf] = ohlcv.map(c => ({
            timestamp: c[0],
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5],
          }));
          console.log(`[DataFeed] Loaded ${ohlcv.length} ${tf} candles for ${symbol}`);
        } catch (err) {
          console.error(`[DataFeed] Error loading ${tf} for ${symbol}:`, err.message);
        }
        await this._delay(200); // rate limit
      }
    }
    this.emit('ready', this.candles);
  }

  startPolling(intervalMs = 5000) {
    if (this.running) return;
    this.running = true;
    console.log(`[DataFeed] Polling every ${intervalMs}ms`);

    this.pollInterval = setInterval(async () => {
      for (const symbol of config.symbols) {
        try {
          // Fetch latest 1m candle + ticker
          const [ohlcv, ticker] = await Promise.all([
            this.exchange.fetchOHLCV(symbol, '1m', undefined, 2),
            this.exchange.fetchTicker(symbol),
          ]);

          this.tickers[symbol] = {
            last: ticker.last,
            bid: ticker.bid,
            ask: ticker.ask,
            volume: ticker.baseVolume,
            timestamp: ticker.timestamp,
          };

          if (ohlcv.length > 0) {
            const latest = ohlcv[ohlcv.length - 1];
            const candleArr = this.candles[symbol]['1m'];
            const latestCandle = {
              timestamp: latest[0], open: latest[1], high: latest[2],
              low: latest[3], close: latest[4], volume: latest[5],
            };

            if (candleArr.length > 0 && candleArr[candleArr.length - 1].timestamp === latest[0]) {
              candleArr[candleArr.length - 1] = latestCandle; // update current candle
            } else if (latest[0] > (candleArr[candleArr.length - 1]?.timestamp || 0)) {
              candleArr.push(latestCandle);
              if (candleArr.length > config.data.candleLimit) candleArr.shift();
              this.emit('newCandle', symbol, '1m', latestCandle);
            }

            this.emit('tick', symbol, this.tickers[symbol]);
          }
        } catch (err) {
          console.error(`[DataFeed] Poll error for ${symbol}:`, err.message);
        }
      }
    }, intervalMs);
  }

  stop() {
    this.running = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  getCandles(symbol, timeframe) {
    return this.candles[symbol]?.[timeframe] || [];
  }

  getLatestPrice(symbol) {
    return this.tickers[symbol]?.last || null;
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
