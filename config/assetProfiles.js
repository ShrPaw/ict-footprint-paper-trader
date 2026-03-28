// ── Asset-Specific Intelligence: The Big Four ──────────────────────
// Each crypto has unique behavior. One-size-fits-all fails.
// These profiles encode per-asset expertise for smarter execution.

const ASSET_PROFILES = {
  'BTC/USDT:USDT': {
    name: 'BTC',
    volatility: 'medium',
    avgDailyRange: 0.025,        // ~2.5% typical daily range
    atrMultiplier: 1.0,
    trendTendency: 'strong',     // BTC trends most reliably
    rangingTendency: 'moderate',
    // Session sensitivity — BTC reacts most to NY session
    sessionWeights: { asia: 0.7, london: 0.9, ny: 1.2, overlap: 1.3 },
    // Psychological levels BTC respects heavily
    psychologicalLevels: [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000],
    volumeProfile: 'institutional',
    orderFlowReliability: 'high',
    riskMultiplier: 1.0,
    slTightness: 1.0,
    daytrade: { adxThreshold: 25, emaAlignment: true, ictWeight: 0.4, footprintWeight: 0.6 },
    weekend: { enabled: true, confluenceBoost: 0.12, riskMultiplier: 0.4 },
    scalping: { minVolumeMult: 1.2, deltaImbalanceRatio: 2.5 },
  },
  'ETH/USDT:USDT': {
    name: 'ETH',
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
    daytrade: { adxThreshold: 28, emaAlignment: true, ictWeight: 0.35, footprintWeight: 0.65 },
    weekend: { enabled: true, confluenceBoost: 0.10, riskMultiplier: 0.5 },
    scalping: { minVolumeMult: 1.0, deltaImbalanceRatio: 2.0 },
  },
  'SOL/USDT:USDT': {
    name: 'SOL',
    volatility: 'extreme',
    avgDailyRange: 0.055,        // ~5.5% — very volatile
    atrMultiplier: 1.5,
    trendTendency: 'moderate',
    rangingTendency: 'weak',     // SOL is either trending or spiking
    sessionWeights: { asia: 0.9, london: 0.9, ny: 1.0, overlap: 1.1 },
    psychologicalLevels: [10, 20, 50, 75, 100, 125, 150, 200, 250, 300],
    volumeProfile: 'retail-mixed',
    orderFlowReliability: 'medium',
    riskMultiplier: 0.8,
    slTightness: 1.3,
    daytrade: { adxThreshold: 32, emaAlignment: true, ictWeight: 0.25, footprintWeight: 0.75 },
    weekend: { enabled: true, confluenceBoost: 0.15, riskMultiplier: 0.35 },
    scalping: { minVolumeMult: 0.8, deltaImbalanceRatio: 1.8 },
  },
  'XRP/USDT:USDT': {
    name: 'XRP',
    volatility: 'high',
    avgDailyRange: 0.04,
    atrMultiplier: 1.3,
    trendTendency: 'weak',       // XRP ranges a lot, then spikes on news
    rangingTendency: 'strong',
    sessionWeights: { asia: 1.0, london: 0.8, ny: 0.9, overlap: 1.0 },
    psychologicalLevels: [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0],
    volumeProfile: 'speculative',
    orderFlowReliability: 'low',
    riskMultiplier: 0.7,
    slTightness: 1.2,
    daytrade: { adxThreshold: 35, emaAlignment: true, ictWeight: 0.3, footprintWeight: 0.7 },
    weekend: { enabled: false, confluenceBoost: 0.20, riskMultiplier: 0.3 },
    scalping: { minVolumeMult: 1.5, deltaImbalanceRatio: 2.5 },
  },
};

export default ASSET_PROFILES;

// ── Helper: Get profile with fallback ──────────────────────────────
export function getProfile(symbol) {
  return ASSET_PROFILES[symbol] || ASSET_PROFILES['ETH/USDT:USDT'];
}
