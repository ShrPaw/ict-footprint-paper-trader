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
  },

  // Footprint parameters
  footprint: {
    deltaImbalanceRatio: 2.0,
    absorptionVolumeMult: 2.0,
    pocTolerance: 0.002,
  },

  // Risk per regime
  risk: {
    TRENDING:      { riskPercent: 1.0,  tpMultiplier: 2.5, slMultiplier: 1.0 },
    RANGING:       { riskPercent: 0.5,  tpMultiplier: 1.5, slMultiplier: 1.0 },
    VOL_EXPANSION: { riskPercent: 0.75, tpMultiplier: 2.0, slMultiplier: 1.2 },
    LOW_VOL:       { riskPercent: 0.25, tpMultiplier: 1.0, slMultiplier: 0.8 },
    ABSORPTION:    { riskPercent: 0.75, tpMultiplier: 2.0, slMultiplier: 1.0 },
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
