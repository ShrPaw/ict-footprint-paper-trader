import config from '../config.js';

// Footprint-led signal types (measured, not narrative)
const FP_SIGNALS = new Set([
  'DELTA_DIVERGENCE', 'ABSORPTION', 'STACKED_IMBALANCE',
  'DELTA_FLIP', 'POC_REACTION', 'VOLUME_SHELF', 'IMBALANCE',
]);

// ICT-led signal types (chart structure, multi-candle)
const ICT_SIGNALS = new Set([
  'FVG', 'ORDER_BLOCK', 'OTE', 'LIQUIDITY_SWEEP', 'BOS', 'CHoCH',
]);

export default class StrategyEngine {
  constructor(regimeDetector, ictAnalyzer, footprintAnalyzer) {
    this.regime = regimeDetector;
    this.ict = ictAnalyzer;
    this.footprint = footprintAnalyzer;
    this.lastSignalTime = {};
    this._atrCache = {};
    this._emaCache = {};
  }

  generateSignal(symbol, candles, realFootprint = null, contextCandles = null) {
    if (candles.length < 50) return null;

    const lastCandle = candles[candles.length - 1];
    const isWeekend = this._isWeekend(lastCandle.timestamp);

    // 1. Killzone check — weekends have no sessions
    const killzone = isWeekend
      ? { allowed: true, overlap: false, strict: false, session: 'weekend', isWeekend: true }
      : this._checkKillzone(lastCandle.timestamp);

    if (!killzone.allowed && killzone.strict) return null;

    // 2. Detect current regime
    const regimeResult = this.regime.detect(symbol, candles);
    const regime = regimeResult.regime;

    // 2b. Skip LOW_VOL regime
    if (config.strategy.skipLowVol && regime === 'LOW_VOL') return null;

    // 2c. Skip RANGING — always negative across all symbols
    if (config.strategy.skipRanging && regime === 'RANGING') return null;

    // 3. Run ICT analysis
    const ictResult = this.ict.analyze(symbol, candles);

    // 4. Run Footprint analysis (with real data if available)
    const footprintResult = this.footprint.analyze(symbol, candles, realFootprint);

    // 5. Score signals
    const signal = this._scoreWithConfluence(regime, ictResult, footprintResult, regimeResult, killzone, isWeekend);
    if (!signal) return null;

    // 6. Apply regime-specific filters
    const filtered = this._applyRegimeFilters(signal, regime, regimeResult, candles, isWeekend);
    if (!filtered) return null;

    // 7. Multi-timeframe trend filter — 1h EMA50 must agree with direction
    if (config.multiTimeframe.enabled && contextCandles && contextCandles.length >= config.multiTimeframe.contextEMA) {
      if (!this._checkMultiTimeframe(contextCandles, filtered)) return null;
    }

    // 8. Entry confirmation (with volume check)
    if (config.strategy.entryConfirmation.enabled) {
      const confirmed = this._checkEntryConfirmation(candles, filtered);
      if (!confirmed) return null;
    }

    // 9. Volume filter — above-average volume required at entry
    if (config.volumeFilter.enabled) {
      if (!this._checkVolumeFilter(candles, filtered)) return null;
    }

    // 10. Rate limit
    if (this._isRateLimited(symbol, lastCandle.timestamp)) return null;

    this.lastSignalTime[symbol] = lastCandle.timestamp || Date.now();
    return filtered;
  }

  // ── Weekend Detection ─────────────────────────────────────────────
  // Sat 00:00 UTC → Sun 23:59 UTC
  // Weekend crypto: lower volume, more vertical moves, no institutional sessions
  _isWeekend(candleTimestamp) {
    if (!config.weekend.enabled) return false;
    const now = candleTimestamp ? new Date(candleTimestamp) : new Date();
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    return day === 0 || day === 6;
  }

  // ── Unified Scoring with Confluence Gate ─────────────────────────
  _scoreWithConfluence(regime, ict, footprint, regimeResult, killzone, isWeekend) {
    const ictSignals = ict.signals || [];
    const fpSignals = footprint.signals || [];

    if (ictSignals.length === 0 && fpSignals.length === 0) return null;

    const allScored = [];
    for (const sig of ictSignals) {
      allScored.push(this._scoreSignal(sig, regime, regimeResult, killzone, config.strategy.ictWeight, isWeekend));
    }
    for (const sig of fpSignals) {
      allScored.push(this._scoreSignal(sig, regime, regimeResult, killzone, config.strategy.footprintWeight, isWeekend));
    }

    if (allScored.length === 0) return null;
    allScored.sort((a, b) => b.combinedScore - a.combinedScore);
    const best = allScored[0];

    // Check for confluence: different source agrees on direction
    const confluenceSignals = allScored.filter(s =>
      s.action === best.action && s.source !== best.source
    );

    const hasConfluence = confluenceSignals.length > 0;

    // Weekend: higher confluence bar
    const minScore = isWeekend
      ? config.strategy.minConfluenceScore + config.weekend.confluenceScoreBoost
      : config.strategy.minConfluenceScore;

    const minSolo = isWeekend
      ? config.strategy.minSoloScore + config.weekend.confluenceScoreBoost
      : config.strategy.minSoloScore;

    if (hasConfluence) {
      best.combinedScore += config.strategy.confluenceBonus;
      best.confluence = true;
      best.confluenceSignals = [best.type, ...confluenceSignals.map(s => s.type)];
      best.reason = `${best.reason} (+ ${confluenceSignals[0].type} confluence)`;

      if (best.combinedScore >= minScore) {
        if (isWeekend) best.reason += ' [WEEKEND]';
        return best;
      }
    }

    // ORDER_BLOCK alone is never enough — it's the worst signal (18% WR)
    if (config.strategy.orderBlockRequireConfluence && best.type === 'ORDER_BLOCK' && !hasConfluence) {
      return null;
    }

    // No confluence: require exceptional solo score
    if (best.combinedScore >= minSolo) {
      if (isWeekend) best.reason += ' [WEEKEND]';
      return best;
    }

    return null;
  }

  _scoreSignal(sig, regime, regimeResult, killzone, weight, isWeekend) {
    // ── FVG: kill entirely — 24% WR, -$378+ across all tests ──────
    if (sig.type === 'FVG') return { ...sig, combinedScore: 0, source: 'ict' };

    let score = sig.confidence * weight;
    const source = FP_SIGNALS.has(sig.type) ? 'footprint' : 'ict';

    // ── Real data bonus ───────────────────────────────────────────
    if (sig.realData) score *= 1.15;

    // ── ORDER BLOCK DEMOTION ────────────────────────────────────────
    if (sig.type === 'ORDER_BLOCK') {
      score *= config.strategy.orderBlockPenalty;
    }

    // ── Regime-specific boosts — ICT ─────────────────────────────
    if (sig.type === 'FVG' || sig.type === 'ORDER_BLOCK' || sig.type === 'OTE') {
      if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') score *= 1.3;
      if (regime === 'RANGING') score *= 0.8;
      if (regime === 'VOL_EXPANSION') score *= 1.1;
    }

    if (sig.type === 'LIQUIDITY_SWEEP') {
      if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') score *= 0.8;
      if (regime === 'LOW_VOL') score *= 0.3;
      if (regime === 'RANGING') score *= 0.5;
      if (regime === 'VOL_EXPANSION') score *= 0.7;
    }

    // ── DELTA_DIVERGENCE: the only consistently profitable signal ──
    // 38-41% WR across all tests. Boost it hard.
    if (sig.type === 'DELTA_DIVERGENCE') {
      score *= 1.5;
      if (regime === 'ABSORPTION') score *= 1.3;
      if (regime === 'VOL_EXPANSION') score *= 1.15;
    }

    if (sig.type === 'ABSORPTION') {
      if (regime === 'LOW_VOL') score *= 1.3;
      if (regime === 'ABSORPTION') score *= 1.5;
    }

    if (sig.type === 'STACKED_IMBALANCE') {
      if (regime === 'TRENDING_UP' || regime === 'TRENDING_DOWN') score *= 1.4;
      if (regime === 'VOL_EXPANSION') score *= 1.2;
    }

    if (sig.type === 'DELTA_FLIP') {
      if (regime === 'VOL_EXPANSION') score *= 1.3;
    }

    if (sig.type === 'IMBALANCE') {
      if (regime === 'VOL_EXPANSION') score *= 1.4;
    }

    if (sig.type === 'POC_REACTION' || sig.type === 'VOLUME_SHELF') {
      if (regime === 'RANGING') score *= 1.3;
      if (regime === 'ABSORPTION') score *= 1.2;
    }

    // ── Killzone boosts ──────────────────────────────────────────
    if (!isWeekend) {
      if (killzone.overlap) score *= 1.2;
      else if (killzone.allowed) score *= 1.05;
    }

    // ── Weekend: penalize ICT signals ────────────────────────────
    if (isWeekend && source === 'ict') {
      score *= 0.9;
    }

    // ── Regime confidence boost ──────────────────────────────────
    if (regimeResult.confidence > 0.7) score *= 1.1;

    return { ...sig, combinedScore: score, source };
  }

  // ── Regime-Specific Filters ──────────────────────────────────────
  _applyRegimeFilters(signal, regime, regimeResult, candles, isWeekend) {
    if (!signal) return null;

    const price = candles[candles.length - 1].close;
    const riskParams = config.risk[regime] || config.risk.RANGING;

    // ── HARD DIRECTION FILTER — enforce in ALL regimes ─────────────
    // Data: longs below EMA50 and shorts above EMA50 are catastrophic
    // across ETH, BTC, and SOL. This is the single biggest edge.
    const ema50 = this._cachedEMA(candles, 50);

    // Absolute gate: never long below EMA50, never short above EMA50
    if (signal.action === 'buy' && price < ema50) return null;
    if (signal.action === 'sell' && price > ema50) return null;

    // TRENDING: double-check regime direction alignment
    if (regime === 'TRENDING_UP' && signal.action === 'sell') return null;
    if (regime === 'TRENDING_DOWN' && signal.action === 'buy') return null;

    // ── Calculate SL/TP using ATR ──────────────────────────────────
    const atr = this._currentATR(candles);

    // Weekend: wider SL (candles are more violent, thinner books)
    const slMult = isWeekend
      ? riskParams.slMultiplier + config.weekend.slMultiplierBoost
      : riskParams.slMultiplier;

    const sl = signal.action === 'buy'
      ? price - atr * slMult
      : price + atr * slMult;

    const tp = signal.action === 'buy'
      ? price + atr * riskParams.tpMultiplier
      : price - atr * riskParams.tpMultiplier;

    // ── Position sizing using CURRENT balance ──────────────────────
    const currentBalance = config.engine.startingBalance; // overridden by PaperEngine/backtest
    let riskPercent = riskParams.riskPercent;

    // Weekend: half the risk
    if (isWeekend) {
      riskPercent *= config.weekend.riskMultiplier;
    }

    const riskAmount = currentBalance * (riskPercent / 100);
    const slDistance = Math.abs(price - sl);
    const size = slDistance > 0 ? riskAmount / slDistance : 0;

    return {
      ...signal,
      regime,
      regimeConfidence: regimeResult.confidence,
      price,
      stopLoss: sl,
      takeProfit: tp,
      size: Math.max(size, 0),
      riskParams,
      atr,
      isWeekend,
    };
  }

  // ── Entry Confirmation ────────────────────────────────────────────
  // ICT zones tell WHERE price might reverse. Candle patterns tell WHEN.
  // Without this, we're catching falling knives (22% WR in backtest).
  //
  // We check the last N candles for rejection patterns at the ICT zone:
  //   1. Pin bar (hammer/shooting star) — long wick rejects the zone
  //   2. Engulfing — full body reversal
  //   3. Inside bar breakout — consolidation then expansion
  _checkEntryConfirmation(candles, signal) {
    const cfg = config.strategy.entryConfirmation;
    const lookback = cfg.lookback;
    const startIdx = Math.max(1, candles.length - lookback - 1);

    // For each candle in the lookback window, check if it's a rejection candle
    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      const range = c.high - c.low;
      if (range === 0) continue;

      const body = Math.abs(c.close - c.open);
      const bodyRatio = body / range;
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;

      // ── Pin Bar ───────────────────────────────────────────────
      // Bullish pin: long lower wick, small body near top, at/below a bullish zone
      if (signal.action === 'buy') {
        const wickRatio = lowerWick / (body || range * 0.01);
        if (wickRatio >= cfg.pinBarMinWickRatio && bodyRatio <= cfg.pinBarMaxBodyPercent) {
          // Confirm it's near our entry zone (within 1 ATR)
          if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
            signal.entryPattern = 'pin_bar_bullish';
            signal.confidence = Math.min(signal.confidence + 0.1, 1.0);
            return true;
          }
        }
      }

      // Bearish pin: long upper wick, small body near bottom, at/above a bearish zone
      if (signal.action === 'sell') {
        const wickRatio = upperWick / (body || range * 0.01);
        if (wickRatio >= cfg.pinBarMinWickRatio && bodyRatio <= cfg.pinBarMaxBodyPercent) {
          if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
            signal.entryPattern = 'pin_bar_bearish';
            signal.confidence = Math.min(signal.confidence + 0.1, 1.0);
            return true;
          }
        }
      }

      // ── Engulfing ─────────────────────────────────────────────
      if (cfg.engulfingEnabled && i > 0) {
        const prev = candles[i - 1];
        const prevBody = Math.abs(prev.close - prev.open);
        const curBody = body;

        if (signal.action === 'buy') {
          // Bullish engulfing: prev bearish, current bullish, current body engulfs prev
          const prevBearish = prev.close < prev.open;
          const curBullish = c.close > c.open;
          if (prevBearish && curBullish && curBody > prevBody &&
              c.close > prev.open && c.open <= prev.close) {
            if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
              signal.entryPattern = 'bullish_engulfing';
              signal.confidence = Math.min(signal.confidence + 0.15, 1.0);
              return true;
            }
          }
        }

        if (signal.action === 'sell') {
          // Bearish engulfing: prev bullish, current bearish, current body engulfs prev
          const prevBullish = prev.close > prev.open;
          const curBearish = c.close < c.open;
          if (prevBullish && curBearish && curBody > prevBody &&
              c.close < prev.open && c.open >= prev.close) {
            if (Math.abs(c.close - signal.price) < signal.atr * 1.5) {
              signal.entryPattern = 'bearish_engulfing';
              signal.confidence = Math.min(signal.confidence + 0.15, 1.0);
              return true;
            }
          }
        }
      }

      // ── Inside Bar Breakout ───────────────────────────────────
      if (cfg.insideBarEnabled && i > 0) {
        const prev = candles[i - 1];
        const insideBar = c.high < prev.high && c.low > prev.low;

        if (insideBar && i + 1 < candles.length) {
          const next = candles[i + 1];
          if (signal.action === 'buy' && next.close > prev.high) {
            if (Math.abs(next.close - signal.price) < signal.atr * 1.5) {
              signal.entryPattern = 'inside_bar_breakout_bullish';
              signal.confidence = Math.min(signal.confidence + 0.1, 1.0);
              return true;
            }
          }
          if (signal.action === 'sell' && next.close < prev.low) {
            if (Math.abs(next.close - signal.price) < signal.atr * 1.5) {
              signal.entryPattern = 'inside_bar_breakout_bearish';
              signal.confidence = Math.min(signal.confidence + 0.1, 1.0);
              return true;
            }
          }
        }
      }
    }

    // No confirmation pattern found — reject the signal
    return false;
  }

  // ── Multi-Timeframe Trend Filter ─────────────────────────────────
  // Check that the higher TF (1h) trend agrees with signal direction
  // Counter-trend on 1h = trades that immediately die at SL
  _checkMultiTimeframe(contextCandles, signal) {
    if (contextCandles.length < config.multiTimeframe.contextEMA) return true; // not enough data, pass

    const ema = this._cachedEMA(contextCandles, config.multiTimeframe.contextEMA, 'ctx');
    const price = contextCandles[contextCandles.length - 1].close;

    // Buy: price must be ABOVE 1h EMA50
    if (signal.action === 'buy' && price < ema) return false;
    // Sell: price must be BELOW 1h EMA50
    if (signal.action === 'sell' && price > ema) return false;

    return true;
  }

  // ── Volume Filter ────────────────────────────────────────────────
  // Require above-average volume on the confirmation candle
  // Low volume entries are knife catches — more likely to hit SL
  _checkVolumeFilter(candles, signal) {
    const lookback = config.volumeFilter.lookback;
    const minMult = config.volumeFilter.minMultiplier;

    if (candles.length < lookback + 1) return true;

    const recentCandles = candles.slice(-lookback - 1, -1); // exclude current
    const avgVolume = recentCandles.reduce((s, c) => s + c.volume, 0) / recentCandles.length;
    const currentVolume = candles[candles.length - 1].volume;

    return currentVolume >= avgVolume * minMult;
  }

  // ── Killzone Check (deadzone-based filtering) ────────────────────
  _checkKillzone(candleTimestamp) {
    const now = candleTimestamp ? new Date(candleTimestamp) : new Date();
    const utcHour = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const time = utcHour + utcMinutes / 60;

    const kz = config.killzones;

    const inDeadzone = kz.deadzones.some(dz => time >= dz.start && time < dz.end);

    if (inDeadzone) {
      return { allowed: false, overlap: false, strict: true, session: 'dead' };
    }

    const inLondon = time >= kz.london.start && time < kz.london.end;
    const inNY = time >= kz.ny.start && time < kz.ny.end;
    const inOverlap = time >= kz.overlap.start && time < kz.overlap.end;
    const inAsia = (time >= kz.asia.start || time < kz.asia.end);

    return {
      allowed: true,
      overlap: inOverlap,
      strict: false,
      session: inOverlap ? 'overlap' : inNY ? 'ny' : inLondon ? 'london' : inAsia ? 'asia' : 'off-session',
    };
  }

  // ── Rate Limiting ─────────────────────────────────────────────────
  _isRateLimited(symbol, candleTimestamp) {
    const lastTime = this.lastSignalTime[symbol];
    if (!lastTime) return false;
    const now = candleTimestamp || Date.now();
    return now - lastTime < config.strategy.signalCooldown;
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _cachedEMA(candles, period, prefix = '') {
    const key = `${prefix}${candles.length}-${candles[candles.length - 1].timestamp}`;
    const cacheKey = `ema${prefix}${period}`;
    if (this._emaCache[cacheKey]?.key === key) {
      return this._emaCache[cacheKey].value;
    }
    const closes = candles.map(c => c.close);
    const k = 2 / (period + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    this._emaCache[cacheKey] = { key, value: ema };
    return ema;
  }

  _currentATR(candles, period = 14) {
    const key = `${candles.length}-${candles[candles.length - 1].timestamp}`;
    if (this._atrCache?.key === key) return this._atrCache.value;

    const tr = [];
    for (let i = Math.max(1, candles.length - period - 1); i < candles.length; i++) {
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    const atr = tr.reduce((a, b) => a + b, 0) / tr.length;
    this._atrCache = { key, value: atr };
    return atr;
  }
}
