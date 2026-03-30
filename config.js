export default {
  // ── Validated Assets — per-asset regime blocking applied ─────────
  // BTC: PF 1.53, +$317. Only works in VOL_EXPANSION, blocked in RANGING (-$728).
  // XRP: PF 2.27, +$1,242. Only works in VOL_EXPANSION, blocked in RANGING (-$282).
  // ETH: PF 1.52, +$684. Works in RANGING + VOL_EXPANSION.
  // SOL: PF 1.72, +$1,426. Works in RANGING, breakeven in VOL_EXPANSION.
  symbols: ['ETH/USDT:USDT', 'SOL/USDT:USDT', 'BTC/USDT:USDT', 'XRP/USDT:USDT'],

  // Multi-timeframe: 1H for daytrade, 15m for scalping, 5m for weekend
  timeframes: {
    primary: '15m',    // scalping + general reference
    secondary: '5m',   // weekend mode + micro-confirmations
    context: '1h',     // daytrade mode + macro trend
    macro: '1h',
  },

  // Killzones (UTC hours) — soft filter mode
  killzones: {
    london:    { start: 6,  end: 12 },
    ny:        { start: 12, end: 18 },
    overlap:   { start: 12, end: 15 },
    asia:      { start: 22, end: 4 },
    deadzones: [{ start: 4, end: 6 }, { start: 18, end: 22 }],
  },

  // ── Weekend Mode (legacy config — now handled by WeekendMode.js) ─
  weekend: {
    enabled: true,
    confluenceScoreBoost: 0.10,
    slMultiplierBoost: 0.2,
    riskMultiplier: 0.5,
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

  // ICT parameters (used by DaytradeMode on 1H)
  ict: {
    fvgMinSize: 0.001,
    orderBlockLookback: 50,
    liquiditySweepWickRatio: 0.6,
    oteRetracement: { min: 0.618, max: 0.786 },
    maxFVGs: 30,
    maxOrderBlocks: 30,
  },

  // Footprint parameters (used by all modes)
  footprint: {
    deltaImbalanceRatio: 2.0,
    absorptionVolumeMult: 2.0,
    pocTolerance: 0.002,
    maxDeltaHistory: 200,
  },

  // Multi-timeframe trend filter
  multiTimeframe: { enabled: true, contextTimeframe: '1h', contextEMA: 50 },

  // Volume confirmation
  volumeFilter: { enabled: true, lookback: 20, minMultiplier: 1.0 },

  // ── Risk per regime ──────────────────────────────────────────────
  // Target: avg loss ≤ avg win → SL same size as TP distance
  // Using symmetric R:R (1:2 or better) with tight stops
  risk: {
    TRENDING_UP:   { riskPercent: 0.5,  tpMultiplier: 2.0, slMultiplier: 0.5 },
    TRENDING_DOWN: { riskPercent: 0.75, tpMultiplier: 2.5, slMultiplier: 0.5 },
    TRENDING:      { riskPercent: 0.5,  tpMultiplier: 2.0, slMultiplier: 0.5 },
    RANGING:       { riskPercent: 0.5,  tpMultiplier: 1.5, slMultiplier: 0.45 },
    VOL_EXPANSION: { riskPercent: 0.5,  tpMultiplier: 2.0, slMultiplier: 0.55 },
    LOW_VOL:       { riskPercent: 0.25, tpMultiplier: 1.5, slMultiplier: 0.4 },
    ABSORPTION:    { riskPercent: 0.5,  tpMultiplier: 2.0, slMultiplier: 0.5 },
  },

  // ── Strategy: confluence-based entries ────────────────────────────
  strategy: {
    minConfluenceScore: 0.60,
    ictWeight: 0.3,
    footprintWeight: 0.7,
    confluenceBonus: 0.15,
    requireConfluence: true,
    minSoloScore: 0.75,
    signalCooldown: 2700000,  // 45 min
    skipLowVol: true,
    skipRanging: true,
    strictTrendAlignment: true,
    orderBlockPenalty: 0.5,
    orderBlockRequireConfluence: true,
    entryConfirmation: {
      enabled: true,
      pinBarMinWickRatio: 2.0,
      pinBarMaxBodyPercent: 0.33,
      engulfingEnabled: true,
      insideBarEnabled: true,
      lookback: 3,
    },
  },

  // Paper trading engine
  engine: {
    startingBalance: 10000,
    makerFee: 0.0002,
    takerFee: 0.0005,
    slippage: 0.0001,
    maxOpenPositions: 4,    // one per asset in Big Four
    maxDailyLoss: 0.03,
    trailingStop: {
      enabled: true,
      activationATR: 0.9,
      trailATR: 0.5,
    },
    trailingStopRegime: {},
    partialTP: {
      enabled: true,
      closePercent: 0.5,
      tpMultiplier: 1.5,
    },
    breakeven: {
      enabled: false,
      activationATR: 1.15,
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
