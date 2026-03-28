export default {
  symbols: ['SOL/USDT:USDT', 'ETH/USDT:USDT'],
  // BTC: PF 0.71, no edge in any regime
  // XRP: PF 0.64, 27% WR — worst performer
  // Only SOL and ETH have validated edge (PF 1.07 and 1.16)
  // BTC excluded — PF 0.71, no edge found in any regime (Jan-Feb '25)
  // ETH validated PF 1.16, SOL validated PF 1.07 across different periods
  timeframes: {
    primary: '1m',
    secondary: '5m',
    context: '15m',
    macro: '1h',
  },

  // Killzones (UTC hours) — soft filter mode
  // Active zones get a score BOOST, dead zones (4-6 UTC, 18-22 UTC) are blocked
  // This covers ~83% of the day instead of 62%, filtering only true dead hours
  // ⚠️ WEEKEND MODE: killzones are entirely excluded — no institutional sessions on weekends
  // Crypto on weekends is more vertical, lower volume, fewer algo flows
  killzones: {
    london:    { start: 6,  end: 12 },
    ny:        { start: 12, end: 18 },
    overlap:   { start: 12, end: 15 },
    asia:      { start: 22, end: 4 },      // wraps midnight
    deadzones: [{ start: 4, end: 6 }, { start: 18, end: 22 }],  // only these are truly blocked
  },

  // ── Weekend Mode ─────────────────────────────────────────────────
  // Sat 00:00 UTC → Sun 23:59 UTC (crypto has no real "weekend close")
  // Behavior: killzones excluded, stricter confluence, tighter R:R
  weekend: {
    enabled: true,
    // Higher confluence threshold — weekends need more confirmation
    confluenceScoreBoost: 0.10,    // minConfluenceScore + this on weekends
    // Wider SL multiplier — weekend candles are bigger/more violent
    slMultiplierBoost: 0.2,        // added to regime SL multiplier
    // Reduced risk on weekends — thinner books = more slippage
    riskMultiplier: 0.5,           // half the normal risk %
  },

  // Regime detection thresholds
  regime: {
    atrPeriod: 14,
    lowVolPercentile: 20,
    highVolPercentile: 80,
    adxPeriod: 14,
    trendThreshold: 25,
    strongTrendThreshold: 40,
    bollingerSqueeze: 0.02,
    rangeLookback: 20,
  },

  // ICT parameters
  ict: {
    fvgMinSize: 0.001,
    orderBlockLookback: 50,
    liquiditySweepWickRatio: 0.6,
    oteRetracement: { min: 0.618, max: 0.786 },
    maxFVGs: 30,           // prune old FVGs beyond this
    maxOrderBlocks: 30,    // prune old OBs beyond this
  },

  // Footprint parameters
  footprint: {
    deltaImbalanceRatio: 2.0,
    absorptionVolumeMult: 2.0,
    pocTolerance: 0.002,
    maxDeltaHistory: 200,  // rolling window for delta
  },

  // Multi-timeframe trend filter (1h EMA50)
  multiTimeframe: { enabled: false, contextTimeframe: '1h', contextEMA: 50 },
  // Volume confirmation at entry
  volumeFilter: { enabled: true, lookback: 20, minMultiplier: 1.0 },

  // ── Risk per regime — upgraded R:R ────────────────────────────────
  // Philosophy: wider TP, tighter SL = better R:R per trade
  // Minimum 1:2 everywhere, 1:3 in trending (where momentum carries)
  risk: {
    TRENDING:      { riskPercent: 1.0,  tpMultiplier: 3.0, slMultiplier: 0.8 },
    RANGING:       { riskPercent: 0.5,  tpMultiplier: 2.0, slMultiplier: 0.8 },
    VOL_EXPANSION: { riskPercent: 0.75, tpMultiplier: 2.5, slMultiplier: 1.0 },
    LOW_VOL:       { riskPercent: 0.25, tpMultiplier: 2.0, slMultiplier: 0.7 },
    ABSORPTION:    { riskPercent: 0.75, tpMultiplier: 2.5, slMultiplier: 0.8 },
  },

  // ── Strategy: confluence-based entries ────────────────────────────
  strategy: {
    // ── SNIPER MODE: fewer trades, higher quality ──────────────────
    // Confluence is a HARD REQUIREMENT for ICT + Footprint agreement
    minConfluenceScore: 0.60,   // raised — only strong signals pass
    // ── Footprint-led: measured order flow > chart structure ─────
    // Footprint tells us what's happening NOW (real buy/sell pressure)
    // ICT tells us what happened THEN (chart patterns from 20+ candles ago)
    ictWeight: 0.3,
    footprintWeight: 0.7,
    confluenceBonus: 0.15,      // bonus when both agree
    requireConfluence: true,    // HARD GATE: must have ICT + FP agreement OR score > 0.75
    minSoloScore: 0.75,         // if no confluence, score must be exceptional
    // Cooldown: 45 min between signals per symbol (3 candles on 15m)
    signalCooldown: 2700000,    // 45 min
    // Skip LOW_VOL regime entirely — no momentum = death by 1000 cuts
    skipLowVol: true,
    // Skip RANGING — 9-30% WR across all symbols, always negative PnL
    skipRanging: true,
    // Stricter trend alignment: in TRENDING, only trade WITH the trend
    strictTrendAlignment: true,
    // ── ENTRY CONFIRMATION ────────────────────────────────────────
    // ICT zones tell WHERE price might reverse — candle patterns confirm WHEN
    // Without this, we're catching falling knives (22% WR → need 37%+ for breakeven)
    entryConfirmation: {
      enabled: true,
      // Pin bar: long wick rejection (minimum wick:body ratio)
      pinBarMinWickRatio: 2.0,     // wick must be 2x the body
      pinBarMaxBodyPercent: 0.33,  // body ≤ 33% of full range
      // Engulfing: previous body fully consumed
      engulfingEnabled: true,
      // Inside bar breakout: quiet consolidation then expansion
      insideBarEnabled: true,
      // How many recent candles to scan for confirmation
      lookback: 3,                 // last 3 candles must show rejection
    },
    // ── ORDER BLOCK DEMOTION ───────────────────────────────────────
    // 77 trades, 18% WR, -$1,514 — worst signal by far
    // Require 2x confidence threshold or confluence to use OB signals
    orderBlockPenalty: 0.5,        // OB scores get halved
    orderBlockRequireConfluence: true, // OB alone is never enough
  },

  // Paper trading engine
  engine: {
    startingBalance: 10000,
    makerFee: 0.0002,
    takerFee: 0.0005,
    slippage: 0.0001,
    maxOpenPositions: 3,
    maxDailyLoss: 0.03,
    // Trailing stop config
    // DEV LOG: trailing_sl has 100% WR — when a trade runs, it runs well
    // Wider activation gives trades more room before trailing kicks in
    // Reduces "trailing stopped out too early" scenarios
    trailingStop: {
      enabled: true,
      activationATR: 1.15,
      trailATR: 0.5,
    },
    // Regime-adaptive trailing overrides (set to same as default = no effect)
    trailingStopRegime: {},
    // Breakeven config
    // DEV LOG: BE stops killed $218 in potential profit — trades that should've trailed
    // Trailing SL handles winners perfectly (100% WR). BE is redundant and harmful.
    // Keeping it but making it fire MUCH later — only protects big moves, doesn't cut runners
    breakeven: {
      enabled: false,          // disabled — trailing SL handles everything
      activationATR: 2.0,     // if re-enabled, fire much later (was 1.0)
      offset: 0.0005,
    },
  },

  // Data
  data: {
    candleLimit: 500,
    exchange: 'mexc',
    useTestnet: false,
  },
};
