import config from '../config.js';

export default class FootprintAnalyzer {
  constructor() {
    this.deltaHistory = [];      // per-candle delta
    this.cumulativeDelta = 0;
    this.volumeProfile = {};     // price level -> volume
    this.pocPrice = null;        // Point of Control
    this._lastAnalyzedLength = 0;
  }

  analyze(symbol, candles) {
    if (candles.length < 20) return { signals: [] };

    const signals = [];

    // Build delta estimates (rolling window — only process new candles)
    this._buildDeltaEstimates(candles);
    // Volume profile only on last N candles (not full history)
    this._buildVolumeProfile(candles.slice(-config.footprint.maxDeltaHistory));

    // Run detections
    signals.push(...this._detectDeltaDivergence(candles));
    signals.push(...this._detectAbsorption(candles));
    signals.push(...this._detectPOCReactions(candles));
    signals.push(...this._detectImbalance(candles));

    this._lastAnalyzedLength = candles.length;

    return {
      signals: signals.filter(s => s.confidence > 0.3).sort((a, b) => b.confidence - a.confidence),
      cumulativeDelta: this.cumulativeDelta,
      pocPrice: this.pocPrice,
      deltaTrend: this._getDeltaTrend(),
    };
  }

  // ── Delta Estimation (ROLLING WINDOW — fixed) ────────────────────
  _buildDeltaEstimates(candles) {
    const maxHistory = config.footprint.maxDeltaHistory;
    const start = Math.max(0, candles.length - maxHistory);

    // Only rebuild from the rolling window start
    this.deltaHistory = [];
    this.cumulativeDelta = 0;

    for (let i = start; i < candles.length; i++) {
      const c = candles[i];
      const range = c.high - c.low;
      if (range === 0) { this.deltaHistory.push(0); continue; }

      const closePosition = (c.close - c.low) / range;
      const delta = (closePosition - 0.5) * 2 * c.volume;
      this.deltaHistory.push(delta);
      this.cumulativeDelta += delta;
    }
  }

  // ── Volume Profile (OPTIMIZED: limited to recent candles) ────────
  _buildVolumeProfile(candles) {
    this.volumeProfile = {};
    const tickSize = this._estimateTickSize(candles);

    for (const c of candles) {
      const levels = Math.ceil((c.high - c.low) / tickSize);
      // Cap levels per candle to prevent explosion
      const cappedLevels = Math.min(levels, 100);
      const volPerLevel = c.volume / Math.max(cappedLevels, 1);

      let price = c.low;
      let count = 0;
      while (price <= c.high && count < cappedLevels) {
        const key = price.toFixed(6);
        this.volumeProfile[key] = (this.volumeProfile[key] || 0) + volPerLevel;
        price += tickSize;
        count++;
      }
    }

    // Find POC
    let maxVol = 0;
    for (const [price, vol] of Object.entries(this.volumeProfile)) {
      if (vol > maxVol) {
        maxVol = vol;
        this.pocPrice = parseFloat(price);
      }
    }
  }

  // ── Delta Divergence ─────────────────────────────────────────────
  _detectDeltaDivergence(candles) {
    const signals = [];
    const lookback = 10;
    const recent = candles.slice(-lookback);
    const recentDeltas = this.deltaHistory.slice(-lookback);

    if (recent.length < 5 || recentDeltas.length < 5) return signals;

    const priceRising = recent[recent.length - 1].close > recent[0].close;
    const deltaRising = recentDeltas[recentDeltas.length - 1] > recentDeltas[0];

    if (priceRising && !deltaRising) {
      const deltaMax = Math.max(...recentDeltas);
      const strength = Math.abs(recentDeltas[recentDeltas.length - 1] - deltaMax) / Math.abs(deltaMax || 1);
      signals.push({
        type: 'DELTA_DIVERGENCE',
        direction: 'bearish',
        action: 'sell',
        confidence: Math.min(0.5 + strength * 0.3, 0.9),
        reason: 'Bearish delta divergence — price rising but buying pressure fading',
      });
    }

    if (!priceRising && deltaRising) {
      const deltaMin = Math.min(...recentDeltas);
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
  _detectAbsorption(candles) {
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
  _detectImbalance(candles) {
    const signals = [];
    const last5 = this.deltaHistory.slice(-5);
    if (last5.length < 5) return signals;

    const recentDelta = last5.reduce((a, b) => a + b, 0);
    const prev5 = this.deltaHistory.slice(-10, -5);
    if (prev5.length < 5) return signals;
    const prevDelta = prev5.reduce((a, b) => a + b, 0);
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
}
