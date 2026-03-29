import BotRunner from '../BotRunner.js';

// BTC — RESEARCH MODE
// No validated edge yet. Testing with conservative settings:
// - Lower risk per trade (0.3% vs 0.5%)
// - Wider stops for BTC's tighter ranges
// - Higher confluence bar (fewer but higher quality trades)
// - TODO: test trend-following approach, ADX thresholds

const bot = new BotRunner({
  name: 'BTC-BOT',
  symbol: 'BTC/USDT:USDT',
  webhookPort: 3453,
  startingBalance: 5000, // smaller allocation until validated
  configOverrides: {
    risk: {
      TRENDING_UP:   { riskPercent: 0.3, tpMultiplier: 2.0, slMultiplier: 0.6 },
      TRENDING_DOWN: { riskPercent: 0.3, tpMultiplier: 2.5, slMultiplier: 0.6 },
      TRENDING:      { riskPercent: 0.3, tpMultiplier: 2.0, slMultiplier: 0.6 },
      RANGING:       { riskPercent: 0.3, tpMultiplier: 1.5, slMultiplier: 0.5 },
      VOL_EXPANSION: { riskPercent: 0.3, tpMultiplier: 2.0, slMultiplier: 0.6 },
      LOW_VOL:       { riskPercent: 0.15, tpMultiplier: 1.5, slMultiplier: 0.4 },
    },
    strategy: {
      minConfluenceScore: 0.65,  // higher bar
      minSoloScore: 0.80,
    },
  },
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });

process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
