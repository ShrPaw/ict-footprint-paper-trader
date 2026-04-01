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
    daytrade: {
      adxThreshold: 20, emaAlignment: true,
      ictWeight: 0.4, footprintWeight: 0.6,
      // BTC: Low trade count, high WR. Tighter thresholds to capture fewer but higher-quality signals.
      minConfluenceScore: 0.55,
      minSoloScore: 0.70,
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
    blockedRegimes: [],
    daytrade: {
      adxThreshold: 20, emaAlignment: true,
      ictWeight: 0.35, footprintWeight: 0.65,
      // ETH: Works in RANGING + VOL_EXP, moderate trade volume. Standard thresholds.
      minConfluenceScore: 0.60,
      minSoloScore: 0.75,
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
    daytrade: {
      adxThreshold: 22, emaAlignment: true,
      ictWeight: 0.25, footprintWeight: 0.75,
      // SOL: Extreme vol, high trade volume. Looser thresholds to let more signals through,
      // compensated by tight SL (slTightness: 1.3) and low risk (0.8x).
      minConfluenceScore: 0.52,
      minSoloScore: 0.68,
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
    daytrade: {
      adxThreshold: 25, emaAlignment: true,
      ictWeight: 0.3, footprintWeight: 0.7,
      // XRP: Best PF (2.27), speculative flow, VOL_EXP only. Tighter thresholds —
      // only the strongest signals should fire given the noise.
      minConfluenceScore: 0.62,
      minSoloScore: 0.78,
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
