// ── Asset-Specific Intelligence: The Big Four ──────────────────────
// Each crypto is a DIFFERENT BEAST. Not variations — different animals.
// ETH: institutional whale, SOL: retail rocket, BTC: slow giant, XRP: sniper.
//
// Each profile is designed from its own backtest + walk-forward results.
// NO sharing parameters between assets. Each gets what IT needs.

const ASSET_PROFILES = {
  // ═══════════════════════════════════════════════════════════════════
  // 🐋 BTC — The Slow Giant
  // ═══════════════════════════════════════════════════════════════════
  // Character: Low noise, institutional flow, strong directional moves.
  // Ranging is DEADLY (-$728, blocked). VOL_EXPANSION is the only edge.
  // Needs WIDE stops to survive initial noise before trailing catches the move.
  // Best during NY/overlap when institutions are active.
  // Walk-forward: 100% OOS windows profitable but thin PF (1.30).
  // Strategy: fewer trades, wider stops, let winners run.
  'BTC/USDT:USDT': {
    name: 'BTC',
    coin: 'BTC',
    volatility: 'medium',
    avgDailyRange: 0.025,
    atrMultiplier: 1.0,
    trendTendency: 'strong',
    rangingTendency: 'moderate',
    sessionWeights: { asia: 0.7, london: 0.9, ny: 1.2, overlap: 1.3 },
    // Hard gate: only trade during NY + overlap (institutional hours)
    allowedSessions: ['ny', 'overlap'],
    psychologicalLevels: [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000],
    volumeProfile: 'institutional',
    orderFlowReliability: 'high',
    riskMultiplier: 1.0,
    slTightness: 1.0,
    // ONLY VOL_EXPANSION. RANGING kills (-$728). TRENDING_DOWN globally blocked.
    blockedRegimes: ['RANGING'],
    riskOverrides: {
      slMultiplier: 2.0,       // WIDE: BTC needs room before trailing activates
      trailingStop: { activationATR: 1.2, trailATR: 0.7 },  // wider trail, let winners breathe
      breakeven: { activationATR: 0.8 },  // protect stalled trades early
    },
    daytrade: {
      adxThreshold: 20, emaAlignment: true,
      ictWeight: 0.4, footprintWeight: 0.6,
      minConfluenceScore: 0.78,  // RAISED: was 0.62 — only strongest signals
      minSoloScore: 0.88,        // RAISED: was 0.78 — sniper mode
      signalCooldown: 7200000,
    },
    weekend: { enabled: false, confluenceBoost: 0.15, riskMultiplier: 0.4 },
    scalping: { minVolumeMult: 1.2, deltaImbalanceRatio: 2.5 },
  },

  // ═══════════════════════════════════════════════════════════════════
  // ⚡ ETH — The Institutional Workhorse
  // ═══════════════════════════════════════════════════════════════════
  // Character: Moderate vol, clean trends, responds well to ICT concepts.
  // RANGING blocked on futures (-$1,869, 45% WR). VOL_EXP is the main edge.
  // Needs extra-wide stops because stop_loss has only 7% WR — noise trap.
  // Best during NY/overlap (institutional hours).
  // Walk-forward: 67% OOS profitable, PF 1.46. Best overall performer.
  // Strategy: wider stops than anyone, let trailing do the work.
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
    // RANGING blocked: -$1,869 on futures (45% WR)
    blockedRegimes: ['RANGING'],
    riskOverrides: {
      slMultiplier: 2.0,       // wider: 1.5 was noise trap (3% WR on stop_loss)
      trailingStop: { activationATR: 1.2, trailATR: 0.7 },
      breakeven: { activationATR: 0.8 },  // BELOW trailing (1.2)
    },
    daytrade: {
      adxThreshold: 20, emaAlignment: true,
      ictWeight: 0.35, footprintWeight: 0.65,
      minConfluenceScore: 0.80,  // RAISED: was 0.65 — institutional-grade quality
      minSoloScore: 0.90,        // RAISED: was 0.78 — only the absolute best
      signalCooldown: 7200000,
    },
    weekend: { enabled: false, confluenceBoost: 0.12, riskMultiplier: 0.5 },
    scalping: { minVolumeMult: 1.0, deltaImbalanceRatio: 2.0 },
  },

  // ═══════════════════════════════════════════════════════════════════
  // 🚀 SOL — The Volatile Rocket
  // ═══════════════════════════════════════════════════════════════════
  // Character: EXTREME volatility. Retails love it. Moves fast, trends hard.
  // ONLY asset that profits in RANGING (+$1,680). Also works in VOL_EXP.
  // Tighter stops work because SOL moves are so large that trails catch them.
  // Works in ALL sessions — no session bias.
  // Walk-forward: 67% OOS profitable, PF 1.45. Highest trade count.
  // Strategy: more trades, tighter risk, ride the momentum.
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
    // RANGING is PROFITABLE for SOL (+$1,680). Keep it. Only block TRENDING_DOWN + LOW_VOL.
    blockedRegimes: [],
    riskOverrides: {
      slMultiplier: 1.0,       // tighter OK: SOL's extreme vol means trails activate fast
      trailingStop: { activationATR: 0.9, trailATR: 0.5 },  // tight trail on big moves
      breakeven: { activationATR: 0.6 },  // fast protection
    },
    daytrade: {
      adxThreshold: 22, emaAlignment: true,
      ictWeight: 0.25, footprintWeight: 0.75,
      minConfluenceScore: 0.75,  // RAISED: was 0.58 — much higher bar
      minSoloScore: 0.85,        // RAISED: was 0.72 — sniper quality
      signalCooldown: 7200000,
    },
    weekend: { enabled: false, confluenceBoost: 0.18, riskMultiplier: 0.35 },
    scalping: { minVolumeMult: 0.8, deltaImbalanceRatio: 1.8 },
  },

  // ═══════════════════════════════════════════════════════════════════
  // 🎯 XRP — The Sniper
  // ═══════════════════════════════════════════════════════════════════
  // Character: Speculative noise machine. LOW order flow reliability.
  // BUT: VOL_EXP regime has PF 2.27, +$1,242. The edge EXISTS — you just
  // can't let it trade outside its lane.
  //
  // The previous failure (33% OOS, PF 0.92) was because XRP used the SAME
  // signal thresholds as ETH/SOL. XRP needs to be a SNIPER: wait for only
  // the absolute best setups. Hyper-selective, low trade count, high quality.
  //
  // Walk-forward failure was parameter problem, not edge problem.
  // Strategy: maximum selectivity, Asia-only, smallest positions.
  'XRP/USDT:USDT': {
    name: 'XRP',
    coin: 'XRP',
    volatility: 'high',
    avgDailyRange: 0.04,
    atrMultiplier: 1.3,
    trendTendency: 'weak',
    rangingTendency: 'strong',
    sessionWeights: { asia: 1.0, london: 0.8, ny: 0.9, overlap: 1.0 },
    // Hard gate: only trade during overlap + ny (highest liquidity for XRP futures)
    allowedSessions: ['overlap', 'ny'],
    psychologicalLevels: [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0],
    volumeProfile: 'speculative',
    orderFlowReliability: 'low',
    riskMultiplier: 0.5,      // HALF size: speculative, volatile, protect capital
    slTightness: 1.2,
    // VOL_EXP ONLY. RANGING kills (-$282). Everything else is noise.
    blockedRegimes: ['RANGING'],
    riskOverrides: {
      slMultiplier: 1.3,       // wider: XRP wicks are violent
      trailingStop: { activationATR: 1.0, trailATR: 0.5 },  // tight trail once it moves
      breakeven: { activationATR: 0.7 },  // early protection
    },
    daytrade: {
      adxThreshold: 25,        // higher: need STRONG trend confirmation for XRP
      emaAlignment: true,
      ictWeight: 0.3, footprintWeight: 0.7,
      // SNIPER thresholds — only the absolute best setups pass
      minConfluenceScore: 0.82,  // was 0.62 — raised 32%
      minSoloScore: 0.90,        // was 0.78 — raised 15%
      signalCooldown: 14400000,  // 4h cooldown — double the others
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
