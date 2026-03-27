import config from '../config.js';

export default class FootprintAnalyzer {
  constructor() {
    this.deltaHistory = [];      // per-candle delta
    this.cumulativeDelta = 0;
    this.volumeProfile = {};     // price level -> volume
    this.pocPrice = null;        // Point of Control
  }

  analyze(symbol, candles) {
    if (candles.length < 20) return { signals: [] };

    const signals = [];

    // Build delta from OHLCV (estimated since we don't have tick data)
    this._buildDeltaEstimates(candles);
    this._buildVolumeProfile(candles);

    // Run detections
    signals.push(...this._detectDeltaDivergence(candles));
    signals.push(...this._detectAbsorption(candles));
    signals.push(...this._detectPOCReactions(candles));
    signals.push(...this._detectImbalance(candles));

    return {
      signals: signals.filter(s => s.confidence > 0.3).sort((a, b) => b.confidence - a.confidence),
      cumulativeDelta: this.cumulativeDelta,
      pocPrice: this.pocPrice,
      deltaTrend: this._getDeltaTrend(),
    };
  }

  // ── Delta Estimation (from OHLCV) ────────────────────────────────
  // Real footprint needs tick data, but we can estimate delta from
  // candle structure: bullish candles with close near high = buying pressure
  _buildDeltaEstimates(candles) {
    this.deltaHistory = [];
    this.cumulativeDelta = 0;

    for (const c of candles) {
      const range = c.high - c.low;
      if (range === 0) { this.deltaHistory.push(0); continue; }

      // Estimate: where did the candle close relative to its range?
      // Close near high = buying pressure, close near low = selling
      const closePosition = (c.close - c.low) / range; // 0 to 1

      // Volume-weighted delta estimate
      const delta = (closePosition - 0.5) * 2 * c.volume; // -volume to +volume
      this.deltaHistory.push(delta);
      this.cumulativeDelta += delta;
    }
  }

  // ── Volume Profile ───────────────────────────────────────────────
  _buildVolumeProfile(candles) {
    this.volumeProfile = {};
    const tickSize = this._estimateTickSize(candles);

    for (const c of candles) {
      // Distribute volume across the candle's range
      const levels = Math.ceil((c.high - c.low) / tickSize);
      const volPerLevel = c.volume / Math.max(levels, 1);

      let price = c.low;
      while (price <= c.high) {
        const key = price.toFixed(6);
        this.volumeProfile[key] = (this.volumeProfile[key] || 0) + volPerLevel;
        price += tickSize;
      }
    }

    // Find POC (Point of Control) — price level with most volume
    let maxVol = 0;
    for (const [price, vol] of Object.entries(this.volumeProfile)) {
      if (vol > maxVol) {
        maxVol = vol;
        this.pocPrice = parseFloat(price);
      }
    }
  }

  // ── Delta Divergence ─────────────────────────────────────────────
  // Price making new highs but delta making lower highs = bearish divergence
  _detectDeltaDivergence(candles) {
    const signals = [];
    const lookback = 10;
    const recent = candles.slice(-lookback);
    const recentDeltas = this.deltaHistory.slice(-lookback);

    if (recent.length < 5 || recentDeltas.length < 5) return signals;

    // Price trend
    const priceHigh = Math.max(...recent.map(c => c.high));
    const priceLow = Math.min(...recent.map(c => c.low));
    const priceRising = recent[recent.length - 1].close > recent[0].close;

    // Delta trend
    const deltaMax = Math.max(...recentDeltas);
    const deltaMin = Math.min(...recentDeltas);
    const deltaRising = recentDeltas[recentDeltas.length - 1] > recentDeltas[0];

    // Bearish divergence: price rising but delta falling
    if (priceRising && !deltaRising) {
      const strength = Math.abs(recentDeltas[recentDeltas.length - 1] - deltaMax) / Math.abs(deltaMax || 1);
      signals.push({
        type: 'DELTA_DIVERGENCE',
        direction: 'bearish',
        action: 'sell',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bearish delta divergence — price rising but buying pressure fading',
      });
    }

    // Bullish divergence: price falling but delta rising
    if (!priceRising && deltaRising) {
      const strength = Math.abs(recentDeltas[recentDeltas.length - 1] - deltaMin) / Math.abs(deltaMin || 1);
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

  // ── Absorption Detection ─────────────────────────────────────────
  // High volume candle with little price movement = absorption
  _detectAbsorption(candles) {
    const signals = [];
    const avgVolume = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const threshold = avgVolume * config.footprint.absorptionVolumeMult;

    const last3 = candles.slice(-3);
    for (const c of last3) {
      if (c.volume < threshold) continue;

      const range = c.high - c.low;
      const body = Math.abs(c.close - c.open);
      const bodyRatio = body / (range || 1);

      // Small body + high volume = absorption
      if (bodyRatio < 0.3) {
        const closePosition = (c.close - c.low) / (range || 1);

        signals.push({
          type: 'ABSORPTION',
          direction: closePosition > 0.5 ? 'bullish' : 'bearish',
          action: closePosition > 0.5 ? 'buy' : 'sell',
          confidence: Math.min((1 - bodyRatio) * 0.8, 0.85),
          volumeRatio: c.volume / avgVolume,
          reason: `${closePosition > 0.5 ? 'Buy' : 'Sell'} absorption — high volume, no price movement`,
        });
      }
    }

    return signals;
  }

  // ── POC Reaction ─────────────────────────────────────────────────
  // Price bouncing off the POC level
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

  // ── Imbalance Detection ──────────────────────────────────────────
  // Large delta shift in a short period
  _detectImbalance(candles) {
    const signals = [];
    const last5 = this.deltaHistory.slice(-5);
    if (last5.length < 5) return signals;

    const recentDelta = last5.reduce((a, b) => a + b, 0);
    const prevDelta = this.deltaHistory.slice(-10, -5).reduce((a, b) => a + b, 0);
    const ratio = prevDelta !== 0 ? Math.abs(recentDelta / prevDelta) : 1;

    if (ratio > config.footprint.deltaImbalanceRatio) {
      signals.push({
        type: 'IMBALANCE',
        direction: recentDelta > 0 ? 'bullish' : 'bearish',
        action: recentDelta > 0 ? 'buy' : 'sell',
        confidence: Math.min(ratio * 0.2, 0.8),
        deltaRatio: ratio.toFixed(2),
        reason: `Delta imbalance — ${ratio.toFixed(1)}x shift in ${recentDelta > 0 ? 'buying' : 'selling'} pressure`,
      });
    }

    return signals;
  }

  // ── Helpers ───────────────────────────────────────────────────────
  _getDeltaTrend() {
    if (this.deltaHistory.length < 10) return 'neutral';
    const recent = this.deltaHistory.slice(-10).reduce((a, b) => a + b, 0);
    if (recent > 0) return 'bullish';
    if (recent < 0) return 'bearish';
    return 'neutral';
  }

  _estimateTickSize(candles) {
    // Estimate from recent price levels
    const prices = candles.slice(-50).map(c => c.close);
    const diffs = [];
    for (let i = 1; i < prices.length; i++) {
      const diff = Math.abs(prices[i] - prices[i - 1]);
      if (diff > 0) diffs.push(diff);
    }
    if (diffs.length === 0) return 0.01;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)] || 0.01; // median diff
  }
}
