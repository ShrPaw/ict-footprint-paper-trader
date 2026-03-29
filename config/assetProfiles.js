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
    // Per-asset regime filter: BTC has PF 0.72 across all regimes. Excluded.
    allowedRegimes: [],
    regimeBoosts: {},
    daytrade: { adxThreshold: 20, emaAlignment: true, ictWeight: 0.4, footprintWeight: 0.6 },
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
    // Per-asset regime filter: ETH marginal (PF ~0.95). Excluded until edge found.
    allowedRegimes: [],
    regimeBoosts: {},
    daytrade: { adxThreshold: 20, emaAlignment: true, ictWeight: 0.35, footprintWeight: 0.65 },
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
    rangingTendency: 'strong',
    sessionWeights: { asia: 0.9, london: 0.9, ny: 1.0, overlap: 1.1 },
    psychologicalLevels: [10, 20, 50, 75, 100, 125, 150, 200, 250, 300],
    volumeProfile: 'retail-mixed',
    orderFlowReliability: 'medium',
    riskMultiplier: 0.8,
    slTightness: 1.3,
    // Per-asset regime filter: SOL wins in RANGING (+$521), loses in VOL_EXPANSION (-$138)
    allowedRegimes: ['RANGING'],
    regimeBoosts: { RANGING: 1.3 },
    daytrade: { adxThreshold: 22, emaAlignment: true, ictWeight: 0.25, footprintWeight: 0.75 },
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
    // Per-asset regime filter: XRP wins in VOL_EXPANSION (+$1161), loses in RANGING (-$473)
    allowedRegimes: ['VOL_EXPANSION'],
    regimeBoosts: { VOL_EXPANSION: 1.4 },
    daytrade: { adxThreshold: 25, emaAlignment: true, ictWeight: 0.3, footprintWeight: 0.7 },
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
