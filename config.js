export default {
  symbols: ['SOL/USDT:USDT', 'XRP/USDT:USDT'],
  timeframes: {
    primary: '1m',
    secondary: '5m',
    context: '15m',
    macro: '1h',
  },

  // Killzones (UTC hours) — soft filter mode
  // Active zones get a score BOOST, dead zones (4-6 UTC, 18-22 UTC) are blocked
  // This covers ~83% of the day instead of 62%, filtering only true dead hours
  killzones: {
    london:    { start: 6,  end: 12 },
    ny:        { start: 12, end: 18 },
    overlap:   { start: 12, end: 15 },
    asia:      { start: 22, end: 4 },      // wraps midnight
    deadzones: [{ start: 4, end: 6 }, { start: 18, end: 22 }],  // only these are truly blocked
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
    minConfluenceScore: 0.55,   // raised — only strong signals pass
    ictWeight: 0.6,
    footprintWeight: 0.4,
    confluenceBonus: 0.15,      // bonus when both agree
    requireConfluence: true,    // HARD GATE: must have ICT + FP agreement OR score > 0.75
    minSoloScore: 0.75,         // if no confluence, score must be exceptional
    // Cooldown: 45 min between signals per symbol (3 candles on 15m)
    signalCooldown: 2700000,    // 45 min
    // Skip LOW_VOL regime entirely — no momentum = death by 1000 cuts
    skipLowVol: true,
    // Stricter trend alignment: in TRENDING, only trade WITH the trend
    strictTrendAlignment: true,
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
    trailingStop: {
      enabled: true,
      activationATR: 1.5,   // activate trailing after 1.5x ATR in profit
      trailATR: 0.5,        // trail by 0.5x ATR
    },
    // Breakeven config
    breakeven: {
      enabled: true,
      activationATR: 1.0,   // move SL to entry after 1x ATR in profit
      offset: 0.0005,       // tiny offset above entry for fees
    },
  },

  // Data
  data: {
    candleLimit: 500,
    exchange: 'mexc',
    useTestnet: false,
  },
};
