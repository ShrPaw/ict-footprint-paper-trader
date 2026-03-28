import config from '../config.js';

// ── Real Footprint Analyzer ─────────────────────────────────────────
// Uses actual buy/sell trade data from Hyperliquid (not estimated from OHLCV)
// Falls back to estimated delta when trade data isn't available (backtest)
//
// Signals:
//   DELTA_DIVERGENCE  — price vs delta disagree (best performer, 40% WR)
//   ABSORPTION        — huge volume, no price movement
//   STACKED_IMBALANCE — consecutive candles with one-sided flow
//   DELTA_FLIP        — cumulative delta changes direction
//   POC_REACTION      — price reacts at high-volume node
//   VOLUME_SHELF      — price supported/resisted at heavy volume level

export default class RealFootprintAnalyzer {
  constructor() {
    this.deltaHistory = [];        // per-candle delta (real or estimated)
    this.cumulativeDelta = 0;
    this.volumeProfile = {};       // price level -> { buy, sell, total }
    this.pocPrice = null;
    this._lastAnalyzedLength = 0;
    this._lastCandleFootprint = null; // most recent real footprint from Hyperliquid
  }

  // Called when HyperliquidFeed emits a real footprint for a completed candle
  ingestRealFootprint(footprint) {
    this._lastCandleFootprint = footprint;
  }

  analyze(symbol, candles, realFootprint = null) {
    if (candles.length < 20) return { signals: [] };

    const signals = [];

    // Build delta — use real footprint if available, otherwise estimate
    this._buildDelta(candles, realFootprint);
    this._buildVolumeProfile(candles.slice(-config.footprint.maxDeltaHistory));

    // Run detections
    signals.push(...this._detectDeltaDivergence(candles));
    signals.push(...this._detectAbsorption(candles, realFootprint));
    signals.push(...this._detectStackedImbalance(candles));
    signals.push(...this._detectDeltaFlip(candles));
    signals.push(...this._detectPOCReactions(candles));
    signals.push(...this._detectVolumeShelf(candles, realFootprint));

    this._lastAnalyzedLength = candles.length;

    return {
      signals: signals.filter(s => s.confidence > 0.3).sort((a, b) => b.confidence - a.confidence),
      cumulativeDelta: this.cumulativeDelta,
      pocPrice: this.pocPrice,
      deltaTrend: this._getDeltaTrend(),
      usingRealData: !!realFootprint,
    };
  }

  // ── Delta Building ───────────────────────────────────────────────
  _buildDelta(candles, realFootprint) {
    const maxHistory = config.footprint.maxDeltaHistory;
    const start = Math.max(0, candles.length - maxHistory);

    this.deltaHistory = [];
    this.cumulativeDelta = 0;

    for (let i = start; i < candles.length; i++) {
      const c = candles[i];
      let delta;

      // If this is the latest candle and we have real footprint data
      if (realFootprint && i === candles.length - 1) {
        delta = realFootprint.delta;
      } else {
        // Estimate from OHLCV (directional approximation)
        const range = c.high - c.low;
        if (range === 0) {
          delta = 0;
        } else {
          const closePosition = (c.close - c.low) / range;
          delta = (closePosition - 0.5) * 2 * c.volume;
        }
      }

      this.deltaHistory.push(delta);
      this.cumulativeDelta += delta;
    }
  }

  _buildVolumeProfile(candles) {
    this.volumeProfile = {};
    const tickSize = this._estimateTickSize(candles);

    for (const c of candles) {
      const levels = Math.ceil((c.high - c.low) / tickSize);
      const cappedLevels = Math.min(levels, 100);
      const volPerLevel = c.volume / Math.max(cappedLevels, 1);

      let price = c.low;
      let count = 0;
      while (price <= c.high && count < cappedLevels) {
        const key = price.toFixed(6);
        if (!this.volumeProfile[key]) {
          this.volumeProfile[key] = { buy: 0, sell: 0, total: 0 };
        }
        this.volumeProfile[key].total += volPerLevel;
        price += tickSize;
        count++;
      }
    }

    let maxVol = 0;
    for (const [price, data] of Object.entries(this.volumeProfile)) {
      if (data.total > maxVol) {
        maxVol = data.total;
        this.pocPrice = parseFloat(price);
      }
    }
  }

  // ── DELTA DIVERGENCE ─────────────────────────────────────────────
  // Price and delta disagree → reversal signal
  // Bullish: price falling, delta rising (buying pressure building)
  // Bearish: price rising, delta falling (buying pressure fading)
  _detectDeltaDivergence(candles) {
    const signals = [];
    const lookback = 10;
    const recent = candles.slice(-lookback);
    const recentDeltas = this.deltaHistory.slice(-lookback);

    if (recent.length < 5 || recentDeltas.length < 5) return signals;

    const priceRising = recent[recent.length - 1].close > recent[0].close;
    const deltaRising = recentDeltas[recentDeltas.length - 1] > recentDeltas[0];

    if (priceRising && !deltaRising) {
      const strength = this._divergenceStrength(recentDeltas);
      signals.push({
        type: 'DELTA_DIVERGENCE',
        direction: 'bearish',
        action: 'sell',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bearish delta divergence — price rising but buying pressure fading',
      });
    }

    if (!priceRising && deltaRising) {
      const strength = this._divergenceStrength(recentDeltas);
      signals.push({
        type: 'DELTA_DIVERGENCE',
        direction: 'bullish',
        action: 'buy',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bullish delta divergence — price falling but buying pressure building',
      });
    }

    return signals;
  }

  // ── ABSORPTION ───────────────────────────────────────────────────
  // High volume candle where price barely moved = someone's absorbing
  // With real data: actual buy/sell volumes at each price level
  // Without: estimated from candle shape
  _detectAbsorption(candles, realFootprint) {
    const signals = [];
    const recentCandles = candles.slice(-20);
    const avgVolume = recentCandles.reduce((s, c) => s + c.volume, 0) / recentCandles.length;
    const threshold = avgVolume * config.footprint.absorptionVolumeMult;

    const last3 = candles.slice(-3);
    for (const c of last3) {
      if (c.volume < threshold) continue;

      const range = c.high - c.low;
      const body = Math.abs(c.close - c.open);
      const bodyRatio = body / (range || 1);

      if (bodyRatio < 0.3) {
        // Real absorption: use actual buy/sell if available
        if (realFootprint && realFootprint.trades > 50) {
          const absRatio = Math.max(
            realFootprint.buyVolume / (realFootprint.sellVolume || 1),
            realFootprint.sellVolume / (realFootprint.buyVolume || 1)
          );
          if (absRatio > 2.0) {
            signals.push({
              type: 'ABSORPTION',
              direction: realFootprint.buyVolume > realFootprint.sellVolume ? 'bullish' : 'bearish',
              action: realFootprint.buyVolume > realFootprint.sellVolume ? 'buy' : 'sell',
              confidence: Math.min(0.5 + (absRatio - 2) * 0.15, 0.9),
              volumeRatio: c.volume / avgVolume,
              buySellRatio: absRatio.toFixed(2),
              reason: `${realFootprint.buyVolume > realFootprint.sellVolume ? 'Buy' : 'Sell'} absorption — ${realFootprint.trades} trades, ${absRatio.toFixed(1)}:1 ratio`,
              realData: true,
            });
            continue;
          }
        }

        // Fallback: estimated absorption from candle shape
        const closePosition = (c.close - c.low) / (range || 1);
        signals.push({
          type: 'ABSORPTION',
          direction: closePosition > 0.5 ? 'bullish' : 'bearish',
          action: closePosition > 0.5 ? 'buy' : 'sell',
          confidence: Math.min((1 - bodyRatio) * 0.7, 0.8),
          volumeRatio: c.volume / avgVolume,
          reason: `${closePosition > 0.5 ? 'Buy' : 'Sell'} absorption (estimated)`,
          realData: false,
        });
      }
    }

    return signals;
  }

  // ── STACKED IMBALANCE ────────────────────────────────────────────
  // Consecutive candles with heavy one-sided delta → trend continuation
  // 3+ candles in a row with >70% buy or sell volume
  _detectStackedImbalance(candles) {
    const signals = [];
    const lookback = 6;
    const recentDeltas = this.deltaHistory.slice(-lookback);
    const recentCandles = candles.slice(-lookback);

    if (recentDeltas.length < 4) return signals;

    // Check for 3+ consecutive candles with extreme one-sided flow
    let streak = 0;
    let streakDir = null;

    for (let i = recentDeltas.length - 1; i >= 0; i--) {
      const c = recentCandles[i];
      const range = c.high - c.low;
      if (range === 0) break;

      const closePos = (c.close - c.low) / range;
      const extreme = closePos > 0.8 || closePos < 0.2;

      if (!extreme) break;

      const dir = closePos > 0.5 ? 'bullish' : 'bearish';
      if (streakDir === null) streakDir = dir;
      if (dir !== streakDir) break;
      streak++;
    }

    if (streak >= 3) {
      signals.push({
        type: 'STACKED_IMBALANCE',
        direction: streakDir,
        action: streakDir === 'bullish' ? 'buy' : 'sell',
        confidence: Math.min(0.5 + (streak - 3) * 0.1, 0.85),
        streak,
        reason: `${streak} consecutive ${streakDir} imbalance candles — strong flow`,
      });
    }

    return signals;
  }

  // ── DELTA FLIP ───────────────────────────────────────────────────
  // Cumulative delta changes from positive to negative or vice versa
  // Shows a shift in who's in control
  _detectDeltaFlip(candles) {
    const signals = [];
    if (this.deltaHistory.length < 10) return signals;

    const recent = this.deltaHistory.slice(-10);
    const first5 = recent.slice(0, 5).reduce((a, b) => a + b, 0);
    const last5 = recent.slice(5).reduce((a, b) => a + b, 0);

    // Flip: signs are different and magnitude is significant
    if (first5 > 0 && last5 < 0 && Math.abs(last5) > Math.abs(first5) * 0.5) {
      signals.push({
        type: 'DELTA_FLIP',
        direction: 'bearish',
        action: 'sell',
        confidence: 0.55,
        reason: `Delta flipped bullish → bearish (was +${first5.toFixed(0)}, now ${last5.toFixed(0)})`,
      });
    }

    if (first5 < 0 && last5 > 0 && Math.abs(last5) > Math.abs(first5) * 0.5) {
      signals.push({
        type: 'DELTA_FLIP',
        direction: 'bullish',
        action: 'buy',
        confidence: 0.55,
        reason: `Delta flipped bearish → bullish (was ${first5.toFixed(0)}, now +${last5.toFixed(0)})`,
      });
    }

    return signals;
  }

  // ── POC REACTION ─────────────────────────────────────────────────
  _detectPOCReactions(candles) {
    if (!this.pocPrice) return [];

    const signals = [];
    const price = candles[candles.length - 1].close;
    const tolerance = this.pocPrice * config.footprint.pocTolerance;

    if (Math.abs(price - this.pocPrice) < tolerance) {
      const prevPrice = candles[candles.length - 2]?.close || price;
      const direction = price > prevPrice ? 'bullish' : 'bearish';

      signals.push({
        type: 'POC_REACTION',
        direction,
        action: direction === 'bullish' ? 'buy' : 'sell',
        pocPrice: this.pocPrice,
        confidence: 0.55,
        reason: `Price reacting at POC (${this.pocPrice.toFixed(4)})`,
      });
    }

    return signals;
  }

  // ── VOLUME SHELF ─────────────────────────────────────────────────
  // Price levels with abnormally high volume act as support/resistance
  // When price approaches a shelf, expect reaction
  _detectVolumeShelf(candles, realFootprint) {
    const signals = [];
    const price = candles[candles.length - 1].close;

    // Use real footprint's price-volume if available
    if (realFootprint && realFootprint.priceVolume) {
      const avgVol = realFootprint.totalVolume / Math.max(Object.keys(realFootprint.priceVolume).length, 1);

      for (const [level, data] of Object.entries(realFootprint.priceVolume)) {
        const levelPrice = parseFloat(level);
        if (data.total > avgVol * 3) {
          const dist = Math.abs(price - levelPrice);
          const atr = this._estimateATR(candles);
          if (dist < atr * 0.5) {
            const direction = price > levelPrice ? 'bullish' : 'bearish';
            signals.push({
              type: 'VOLUME_SHELF',
              direction,
              action: direction === 'bullish' ? 'buy' : 'sell',
              level: levelPrice,
              volume: data.total,
              confidence: 0.5,
              reason: `Volume shelf at ${levelPrice.toFixed(4)} (${data.total.toFixed(0)} vol)`,
              realData: true,
            });
          }
        }
      }
    }

    return signals.slice(-2); // max 2 shelf signals
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _divergenceStrength(deltas) {
    const max = Math.max(...deltas.map(Math.abs));
    if (max === 0) return 0;
    const last = Math.abs(deltas[deltas.length - 1]);
    const avg = deltas.reduce((a, b) => a + Math.abs(b), 0) / deltas.length;
    return Math.min(last / avg, 2.0);
  }

  _getDeltaTrend() {
    if (this.deltaHistory.length < 10) return 'neutral';
    const recent = this.deltaHistory.slice(-10).reduce((a, b) => a + b, 0);
    if (recent > 0) return 'bullish';
    if (recent < 0) return 'bearish';
    return 'neutral';
  }

  _estimateTickSize(candles) {
    const prices = candles.slice(-50).map(c => c.close);
    const diffs = [];
    for (let i = 1; i < prices.length; i++) {
      const diff = Math.abs(prices[i] - prices[i - 1]);
      if (diff > 0) diffs.push(diff);
    }
    if (diffs.length === 0) return 0.01;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)] || 0.01;
  }

  _estimateATR(candles, period = 14) {
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
