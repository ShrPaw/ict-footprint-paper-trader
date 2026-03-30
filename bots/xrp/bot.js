import BotRunner from '../BotRunner.js';

// XRP — RESEARCH MODE
// No validated edge yet. Testing with settings tuned to XRP's profile:
// - XRP has STRONG ranging tendency (best characteristic)
// - Only profitable in VOL_EXPANSION historically
// - Speculative volume, low order flow reliability
// - Tighter SL for XRP's choppy moves
// - TODO: test pure ranging strategy, scalping during news

const bot = new BotRunner({
  name: 'XRP-BOT',
  symbol: 'XRP/USDT:USDT',
  webhookPort: 3454,
  startingBalance: 5000, // smaller allocation until validated
  configOverrides: {
    risk: {
      TRENDING_UP:   { riskPercent: 0.25, tpMultiplier: 2.0, slMultiplier: 0.5 },
      TRENDING_DOWN: { riskPercent: 0.25, tpMultiplier: 2.5, slMultiplier: 0.5 },
      TRENDING:      { riskPercent: 0.25, tpMultiplier: 2.0, slMultiplier: 0.5 },
      RANGING:       { riskPercent: 0.4, tpMultiplier: 1.5, slMultiplier: 0.4 },
      VOL_EXPANSION: { riskPercent: 0.4, tpMultiplier: 2.0, slMultiplier: 0.5 },
      LOW_VOL:       { riskPercent: 0.1, tpMultiplier: 1.5, slMultiplier: 0.35 },
    },
    strategy: {
      minConfluenceScore: 0.62,
      minSoloScore: 0.78,
    },
  },
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });

process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
