// ── Asset-Specific Intelligence: The Big Four ──────────────────────
// Each crypto has unique behavior. One-size-fits-all fails.

const ASSET_PROFILES = {
  'BTC/USDT:USDT': {
    name: 'BTC',
    coin: 'BTC',
    volatility: 'medium',
    avgDailyRange: 0.025,
    atrMultiplier: 1.0,
    trendTendency: 'strong',
    rangingTendency: 'moderate',
    sessionWeights: { asia: 0.7, london: 0.9, ny: 1.2, overlap: 1.3 },
    psychologicalLevels: [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000],
    volumeProfile: 'institutional',
    orderFlowReliability: 'high',
    riskMultiplier: 1.0,
    slTightness: 1.0,
    blockedRegimes: ['RANGING'],
    // Per-asset risk overrides — BTC has highest DD (22.7%), needs wider stops
    riskOverrides: {
      slMultiplier: 1.4,
      trailingStop: { activationATR: 1.0, trailATR: 0.6 },
      breakeven: { activationATR: 1.2 },
    },
    daytrade: {
      adxThreshold: 20, emaAlignment: true,
      ictWeight: 0.4, footprintWeight: 0.6,
      minConfluenceScore: 0.62,
      minSoloScore: 0.78,
      signalCooldown: 7200000,
    },
    weekend: { enabled: false, confluenceBoost: 0.15, riskMultiplier: 0.4 },
    scalping: { minVolumeMult: 1.2, deltaImbalanceRatio: 2.5 },
  },
  'ETH/USDT:USDT': {
    name: 'ETH',
    coin: 'ETH',
    volatility: 'high',
    avgDailyRange: 0.035,
    atrMultiplier: 1.2,
    trendTendency: 'moderate',
    rangingTendency: 'moderate',
    sessionWeights: { asia: 0.8, london: 1.0, ny: 1.1, overlap: 1.2 },
    psychologicalLevels: [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000],
    volumeProfile: 'institutional',
    orderFlowReliability: 'high',
    riskMultiplier: 0.9,
    slTightness: 1.1,
    // RANGING blocked: -$1,869 on futures (45% WR). Only VOL_EXP has edge.
    blockedRegimes: ['RANGING'],
    // Per-asset risk overrides — ETH stop_loss has 7% WR at 1.0 ATR, needs wider
    riskOverrides: {
      slMultiplier: 1.5,       // wider: survive noise until trailing activates
      trailingStop: { activationATR: 1.2, trailATR: 0.7 },  // later activation, wider trail
      breakeven: { activationATR: 0.8 },  // BELOW trailing (1.2) — protects stalled trades first
    },
    daytrade: {
      adxThreshold: 20, emaAlignment: true,
      ictWeight: 0.35, footprintWeight: 0.65,
      minConfluenceScore: 0.65,
      minSoloScore: 0.78,
      signalCooldown: 7200000,  // 2h
    },
    weekend: { enabled: false, confluenceBoost: 0.12, riskMultiplier: 0.5 },
    scalping: { minVolumeMult: 1.0, deltaImbalanceRatio: 2.0 },
  },
  'SOL/USDT:USDT': {
    name: 'SOL',
    coin: 'SOL',
    volatility: 'extreme',
    avgDailyRange: 0.055,
    atrMultiplier: 1.5,
    trendTendency: 'moderate',
    rangingTendency: 'weak',
    sessionWeights: { asia: 0.9, london: 0.9, ny: 1.0, overlap: 1.1 },
    psychologicalLevels: [10, 20, 50, 75, 100, 125, 150, 200, 250, 300],
    volumeProfile: 'retail-mixed',
    orderFlowReliability: 'medium',
    riskMultiplier: 0.8,
    slTightness: 1.3,
    // Per-asset risk overrides — SOL best performer, conservative tweaks only
    riskOverrides: {
      slMultiplier: 1.0,       // current works for SOL (tight SL + extreme vol = fine)
      trailingStop: { activationATR: 0.9, trailATR: 0.5 },  // keep defaults
      breakeven: { activationATR: 1.0 },  // keep default
    },
    daytrade: {
      adxThreshold: 22, emaAlignment: true,
      ictWeight: 0.25, footprintWeight: 0.75,
      minConfluenceScore: 0.58,
      minSoloScore: 0.72,
      signalCooldown: 7200000,
    },
    weekend: { enabled: false, confluenceBoost: 0.18, riskMultiplier: 0.35 },
    scalping: { minVolumeMult: 0.8, deltaImbalanceRatio: 1.8 },
  },
  'XRP/USDT:USDT': {
    name: 'XRP',
    coin: 'XRP',
    volatility: 'high',
    avgDailyRange: 0.04,
    atrMultiplier: 1.3,
    trendTendency: 'weak',
    rangingTendency: 'strong',
    sessionWeights: { asia: 1.0, london: 0.8, ny: 0.9, overlap: 1.0 },
    psychologicalLevels: [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0],
    volumeProfile: 'speculative',
    orderFlowReliability: 'low',
    riskMultiplier: 0.7,
    slTightness: 1.2,
    blockedRegimes: ['RANGING'],
    // Per-asset risk overrides — XRP speculative noise, wider stops
    riskOverrides: {
      slMultiplier: 1.3,
      trailingStop: { activationATR: 1.0, trailATR: 0.6 },
      breakeven: { activationATR: 1.2 },
    },
    daytrade: {
      adxThreshold: 25, emaAlignment: true,
      ictWeight: 0.3, footprintWeight: 0.7,
      minConfluenceScore: 0.62,
      minSoloScore: 0.78,
      signalCooldown: 7200000,
    },
    weekend: { enabled: false, confluenceBoost: 0.20, riskMultiplier: 0.3 },
    scalping: { minVolumeMult: 1.5, deltaImbalanceRatio: 2.5 },
  },
};

export default ASSET_PROFILES;

// ── Helper: Get profile by symbol or coin name ─────────────────────
export function getProfile(symbol) {
  // Direct match
  if (ASSET_PROFILES[symbol]) return ASSET_PROFILES[symbol];
  // Match by coin name (e.g., "SOL" from Hyperliquid feed)
  const coin = symbol?.split('/')[0]?.split(':')[0];
  for (const [key, profile] of Object.entries(ASSET_PROFILES)) {
    if (profile.coin === coin) return profile;
  }
  return ASSET_PROFILES['ETH/USDT:USDT'];
}
