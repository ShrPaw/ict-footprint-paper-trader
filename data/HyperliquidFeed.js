import { EventEmitter } from 'events';
import config from '../config.js';

// Hyperliquid API client — public endpoints (no auth needed for market data)
export default class HyperliquidFeed extends EventEmitter {
  constructor() {
    super();
    this.baseUrl = 'https://api.hyperliquid.xyz';
    this.candles = {};          // symbol -> { '1m': [...], '5m': [...], ... }
    this.trades = {};           // symbol -> recent trades buffer
    this.books = {};            // symbol -> L2 book snapshot
    this.running = false;
    this.pollInterval = null;
    this.tradeBufferMax = 2000; // keep last 2000 trades per symbol
  }

  async init() {
    const symbols = this.symbolsOverride || config.symbols;
    for (const symbol of symbols) {
      const coin = this._symbolToCoin(symbol);
      this.candles[coin] = {};
      for (const [label, tf] of Object.entries(config.timeframes)) {
        this.candles[coin][tf] = [];
      }
      this.trades[coin] = [];
    }
    console.log(`[HyperliquidFeed] Initialized | ${symbols.map(s => this._symbolToCoin(s)).join(', ')}`);
  }

  async loadInitialCandles() {
    const intervalMap = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h' };
    const symbols = this.symbolsOverride || config.symbols;

    for (const symbol of symbols) {
      const coin = this._symbolToCoin(symbol);

      for (const [label, tf] of Object.entries(config.timeframes)) {
        const interval = intervalMap[tf] || tf;
        const now = Date.now();
        const lookback = config.data.candleLimit * this._tfToMs(tf);
        const start = now - lookback;

        try {
          const raw = await this._post('candleSnapshot', {
            coin,
            interval,
            startTime: start,
            endTime: now,
          });

          const candles = raw.map(c => ({
            timestamp: c.t,
            open: parseFloat(c.o),
            high: parseFloat(c.h),
            low: parseFloat(c.l),
            close: parseFloat(c.c),
            volume: parseFloat(c.v),
            numTrades: c.n || 0,
          }));

          this.candles[coin][tf] = candles;
          console.log(`[HyperliquidFeed] Loaded ${candles.length} ${tf} candles for ${coin}`);
        } catch (err) {
          console.error(`[HyperliquidFeed] Error loading ${tf} for ${coin}: ${err.message}`);
        }

        await this._delay(200);
      }

      // Load initial trades
      await this._loadRecentTrades(coin);
    }

    this.emit('ready', this.candles);
  }

  // ── Start Polling ────────────────────────────────────────────────
  startPolling(intervalMs = 3000) {
    if (this.running) return;
    this.running = true;
    console.log(`[HyperliquidFeed] Polling every ${intervalMs}ms`);

    this.pollInterval = setInterval(async () => {
      const symbols = this.symbolsOverride || config.symbols;
      for (const symbol of symbols) {
        const coin = this._symbolToCoin(symbol);

        try {
          // Fetch latest trades + book in parallel
          const [trades, book] = await Promise.all([
            this._fetchNewTrades(coin),
            this._fetchBook(coin),
          ]);

          // Update book
          if (book) {
            this.books[coin] = book;
            this.emit('book', coin, book);
          }

          // Process new trades
          if (trades.length > 0) {
            this.trades[coin].push(...trades);
            // Trim buffer
            if (this.trades[coin].length > this.tradeBufferMax) {
              this.trades[coin] = this.trades[coin].slice(-this.tradeBufferMax);
            }

            // Get latest price from most recent trade
            const latestPrice = parseFloat(trades[trades.length - 1].px);
            this.emit('tick', coin, { last: latestPrice, trades });

            // Check if we crossed into a new candle
            this._checkNewCandle(coin, trades[trades.length - 1].time);
          }
        } catch (err) {
          console.error(`[HyperliquidFeed] Poll error for ${coin}: ${err.message}`);
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
    const coin = this._symbolToCoin(symbol);
    return this.candles[coin]?.[timeframe] || [];
  }

  getTrades(symbol, since = null) {
    const coin = this._symbolToCoin(symbol);
    const all = this.trades[coin] || [];
    if (!since) return all;
    return all.filter(t => t.time >= since);
  }

  getBook(symbol) {
    const coin = this._symbolToCoin(symbol);
    return this.books[coin] || null;
  }

  getLatestPrice(symbol) {
    const coin = this._symbolToCoin(symbol);
    const trades = this.trades[coin];
    if (trades.length === 0) return null;
    return parseFloat(trades[trades.length - 1].px);
  }

  // ── Compute Real Footprint for a Candle Window ───────────────────
  // This is the core: real buy/sell delta from actual trades
  computeFootprint(symbol, startTime, endTime) {
    const coin = this._symbolToCoin(symbol);
    const trades = (this.trades[coin] || []).filter(
      t => t.time >= startTime && t.time < endTime
    );

    if (trades.length === 0) return null;

    let buyVol = 0;
    let sellVol = 0;
    const priceVolume = {};  // price level -> { buy, sell }

    for (const t of trades) {
      const price = parseFloat(t.px);
      const size = parseFloat(t.sz);
      const isBuy = t.side === 'B';

      if (isBuy) {
        buyVol += size;
      } else {
        sellVol += size;
      }

      const key = price.toFixed(4);
      if (!priceVolume[key]) priceVolume[key] = { buy: 0, sell: 0, total: 0 };
      if (isBuy) {
        priceVolume[key].buy += size;
      } else {
        priceVolume[key].sell += size;
      }
      priceVolume[key].total += size;
    }

    const totalVol = buyVol + sellVol;
    const delta = buyVol - sellVol;
    const deltaPercent = totalVol > 0 ? (delta / totalVol) * 100 : 0;

    // Find POC (price level with most volume)
    let poc = null;
    let pocVol = 0;
    for (const [price, data] of Object.entries(priceVolume)) {
      if (data.total > pocVol) {
        pocVol = data.total;
        poc = parseFloat(price);
      }
    }

    // Imbalance: price levels where buy/sell ratio is extreme
    const imbalances = [];
    for (const [price, data] of Object.entries(priceVolume)) {
      if (data.buy > 0 && data.sell > 0) {
        const ratio = Math.max(data.buy / data.sell, data.sell / data.buy);
        if (ratio >= config.footprint.deltaImbalanceRatio) {
          imbalances.push({
            price: parseFloat(price),
            buyVolume: data.buy,
            sellVolume: data.sell,
            ratio,
            direction: data.buy > data.sell ? 'bullish' : 'bearish',
          });
        }
      }
    }

    return {
      trades: trades.length,
      buyVolume: buyVol,
      sellVolume: sellVol,
      totalVolume: totalVol,
      delta,
      deltaPercent,
      poc,
      pocVolume: pocVol,
      priceVolume,
      imbalances,
      vwap: this._calcVWAP(trades),
    };
  }

  // ── API Methods ──────────────────────────────────────────────────
  async _post(type, payload) {
    const resp = await fetch(`${this.baseUrl}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload }),
    });
    if (!resp.ok) throw new Error(`Hyperliquid API ${resp.status}`);
    return resp.json();
  }

  async _loadRecentTrades(coin) {
    try {
      const trades = await this._post('recentTrades', { coin });
      this.trades[coin] = trades;
      console.log(`[HyperliquidFeed] Loaded ${trades.length} recent trades for ${coin}`);
    } catch (err) {
      console.error(`[HyperliquidFeed] Error loading trades for ${coin}: ${err.message}`);
    }
  }

  async _fetchNewTrades(coin) {
    const trades = await this._post('recentTrades', { coin });
    const existing = this.trades[coin] || [];
    const lastTid = existing.length > 0 ? existing[existing.length - 1].tid : 0;

    // Only keep trades newer than our last known trade
    const newTrades = trades.filter(t => t.tid > lastTid);
    return newTrades;
  }

  async _fetchBook(coin) {
    const data = await this._post('l2Book', { coin });
    return {
      coin: data.coin,
      time: data.time,
      bids: (data.levels?.[1] || []).map(l => ({ price: parseFloat(l.px), size: parseFloat(l.sz), orders: l.n })),
      asks: (data.levels?.[0] || []).map(l => ({ price: parseFloat(l.px), size: parseFloat(l.sz), orders: l.n })),
    };
  }

  // ── Candle Management ────────────────────────────────────────────
  _checkNewCandle(coin, tradeTime) {
    for (const [label, tf] of Object.entries(config.timeframes)) {
      const tfMs = this._tfToMs(tf);
      const arr = this.candles[coin]?.[tf];
      if (!arr || arr.length === 0) continue;

      const lastCandle = arr[arr.length - 1];
      const candleStart = Math.floor(tradeTime / tfMs) * tfMs;

      if (candleStart > lastCandle.timestamp) {
        // New candle started — finalize old one and emit
        this.emit('newCandle', coin, tf, lastCandle);

        // Compute footprint for the completed candle window
        const footprint = this.computeFootprint(coin, lastCandle.timestamp, candleStart);
        if (footprint) {
          this.emit('footprint', coin, tf, lastCandle, footprint);
        }

        // Start new candle
        arr.push({
          timestamp: candleStart,
          open: parseFloat(this.trades[coin]?.[this.trades[coin].length - 1]?.px) || lastCandle.close,
          high: 0,
          low: Infinity,
          close: 0,
          volume: 0,
          numTrades: 0,
        });
        if (arr.length > config.data.candleLimit) arr.shift();
      }

      // Update current candle with latest trade
      if (arr.length > 0) {
        const c = arr[arr.length - 1];
        const price = parseFloat(this.trades[coin]?.[this.trades[coin].length - 1]?.px);
        if (price) {
          if (c.high === 0) c.high = price;
          if (c.low === Infinity) c.low = price;
          c.high = Math.max(c.high, price);
          c.low = Math.min(c.low, price);
          c.close = price;
        }
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _symbolToCoin(symbol) {
    // "SOL/USDT:USDT" -> "SOL"
    return symbol.split('/')[0].split(':')[0];
  }

  _tfToMs(tf) {
    const map = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };
    return map[tf] || 60000;
  }

  _calcVWAP(trades) {
    let sumPV = 0;
    let sumV = 0;
    for (const t of trades) {
      const p = parseFloat(t.px);
      const v = parseFloat(t.sz);
      sumPV += p * v;
      sumV += v;
    }
    return sumV > 0 ? sumPV / sumV : 0;
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
