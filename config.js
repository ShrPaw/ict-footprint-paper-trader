export default {
  symbols: ['SOL/USDT:USDT', 'XRP/USDT:USDT'],
  timeframes: {
    primary: '1m',
    secondary: '5m',
    context: '15m',
    macro: '1h',
  },

  // Killzones (UTC hours) — only trade during high-probability sessions
  killzones: {
    london:    { start: 7,  end: 10 },
    ny:        { start: 13, end: 16 },
    overlap:   { start: 13, end: 15 },  // highest volume
    asia:      { start: 0,  end: 3 },   // lower vol, only for ranging
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
    // Require multiple signal types to confirm (not just the best one)
    requireConfluence: true,
    minConfluenceScore: 0.5,    // minimum combined score after multipliers
    ictWeight: 0.6,             // weight for ICT signals in confluence
    footprintWeight: 0.4,       // weight for footprint signals in confluence
    // Higher threshold = fewer but higher-quality trades
    minCombinedScore: 0.35,     // slightly lower than 0.4 — compensated by confluence
    // Cooldown between signals (ms)
    signalCooldown: 120000,     // 2 min — less aggressive than 1 min
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
