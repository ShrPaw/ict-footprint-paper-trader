import BotRunner from '../BotRunner.js';

// BTC — Per-asset profile from assetProfiles.js drives SL/TP/trailing/breakeven.
// Only override riskPercent here (0.3% vs default 0.5%) for conservative paper testing.
// All other risk params (slMultiplier, trailing, breakeven) come from assetProfiles.js
// which has BTC-specific values: slMultiplier=1.5, trailActivation=1.2, trailDistance=0.7.
const bot = new BotRunner({
  name: 'BTC-BOT',
  symbol: 'BTC/USDT:USDT',
  webhookPort: 3453,
  startingBalance: 10000, // match backtest starting balance
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });

process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
