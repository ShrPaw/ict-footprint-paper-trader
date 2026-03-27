export default {
  symbols: ['SOL/USDC:USDC', 'XRP/USDC:USDC'],
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
    // ATR-based volatility
    atrPeriod: 14,
    lowVolPercentile: 20,      // bottom 20% = low vol / weekend mode
    highVolPercentile: 80,     // top 20% = expansion
    // Trend detection
    adxPeriod: 14,
    trendThreshold: 25,        // ADX > 25 = trending
    strongTrendThreshold: 40,  // ADX > 40 = strong trend
    // Range detection
    bollingerSqueeze: 0.02,    // BB width < 2% = squeeze
    rangeLookback: 20,         // candles to check for range
  },

  // ICT parameters
  ict: {
    fvgMinSize: 0.001,         // minimum FVG size as % of price
    orderBlockLookback: 50,
    liquiditySweepWickRatio: 0.6,  // wick must be 60%+ of candle
    oteRetracement: { min: 0.618, max: 0.786 },
  },

  // Footprint parameters
  footprint: {
    deltaImbalanceRatio: 2.0,  // buy/sell delta ratio for imbalance
    absorptionVolumeMult: 2.0, // volume must be 2x average
    pocTolerance: 0.002,       // 0.2% tolerance for POC
  },

  // Risk per regime
  risk: {
    TRENDING:    { riskPercent: 1.0,  tpMultiplier: 2.5, slMultiplier: 1.0 },
    RANGING:     { riskPercent: 0.5,  tpMultiplier: 1.5, slMultiplier: 1.0 },
    VOL_EXPANSION:{ riskPercent: 0.75, tpMultiplier: 2.0, slMultiplier: 1.2 },
    LOW_VOL:     { riskPercent: 0.25, tpMultiplier: 1.0, slMultiplier: 0.8 },
    ABSORPTION:  { riskPercent: 0.75, tpMultiplier: 2.0, slMultiplier: 1.0 },
  },

  // Paper trading engine
  engine: {
    startingBalance: 10000,
    makerFee: 0.0002,          // 0.02%
    takerFee: 0.0005,          // 0.05%
    slippage: 0.0001,          // 0.01% simulated slippage
    maxOpenPositions: 3,
    maxDailyLoss: 0.03,        // 3% max daily loss
  },

  // Data
  data: {
    candleLimit: 500,          // candles to keep in memory
    exchange: 'hyperliquid',
    useTestnet: false,
  },
};
