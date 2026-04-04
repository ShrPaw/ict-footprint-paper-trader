// ═══════════════════════════════════════════════════════════════════
// FUNDING ENGINE CONFIG — Validated Parameters
// ═══════════════════════════════════════════════════════════════════
// DO NOT optimize these. DO NOT add filters. DO NOT change logic.
// These are the exact parameters from research validation.
// ═══════════════════════════════════════════════════════════════════

export default {
  // ── Assets ───────────────────────────────────────────────────────
  assets: [
    { label: 'BTC', symbol: 'BTC/USDT:USDT' },
    { label: 'ETH', symbol: 'ETH/USDT:USDT' },
    { label: 'XRP', symbol: 'XRP/USDT:USDT' },
  ],

  // ── Entry: Percentile thresholds (NON-OPTIMIZED) ─────────────────
  entry: {
    extremeLowPercentile: 10,    // bottom 10% of funding rates
    extremeHighPercentile: 95,   // top 5% of funding rates
    cumulativeDrainPercentile: 90, // top 10% of cumulative funding
    cumulativeWindow: 10,        // 10 funding periods = ~80h
  },

  // ── Exit: Fixed time (VALIDATED: stable across ±12h) ────────────
  exit: {
    holdHours: 48,               // fixed 48h — NO stops, NO trailing
    maxHoldHours: 72,            // hard limit (safety)
  },

  // ── Risk: Conservative sizing ────────────────────────────────────
  risk: {
    riskPerTrade: 0.01,          // 1% of capital (strict)
    maxConcurrentPositions: 3,   // across all assets
    maxDrawdownHalt: 0.20,       // halt at 20% portfolio DD
    maxConsecutiveLosses: 20,    // alert threshold
  },

  // ── Fees ─────────────────────────────────────────────────────────
  fees: {
    takerFee: 0.0005,            // 0.05% per side
    roundTripFee: 0.0014,        // conservative estimate (taker × 2 + slippage)
  },

  // ── Per-asset validated MAE (worst p99%) ─────────────────────────
  // Used for position sizing. From robustness validation.
  assetRisk: {
    BTC: { worstMAE: 0.127, expectedBps: 31.5, pf: 1.26 },
    ETH: { worstMAE: 0.206, expectedBps: 44.0, pf: 1.25 },
    XRP: { worstMAE: 0.240, expectedBps: 128.6, pf: 1.73 },
  },

  // ── Signal types per asset (from validation) ─────────────────────
  signalTypes: {
    BTC: ['extremeLow_p10', 'extremeHigh_p95', 'highCumDrain'],
    ETH: ['highCumDrain', 'extremeLow_p10'],
    XRP: ['highCumDrain', 'extremeLow_p10'],
  },

  // ── Logging ──────────────────────────────────────────────────────
  logging: {
    logDir: 'funding-logs',
    tradeLogFile: 'funding-trades.jsonl',
  },
};
