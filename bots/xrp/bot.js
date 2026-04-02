import BotRunner from '../BotRunner.js';

// XRP — DISABLED
// Walk-forward analysis proved XRP is curve-fitted:
// - Only 33% of OOS windows profitable
// - Median OOS PF: 0.92 (unprofitable)
// - Total OOS PnL: -$709
//
// The full-sample +$643 was in-sample luck.
// Code kept here for future regime revalidation.
//
// To re-enable: add 'XRP/USDT:USDT' back to config.symbols
// and run a fresh walk-forward analysis.

console.log('⚠️  XRP bot is DISABLED — curve-fitted (33% OOS profitable). See bots/xrp/bot.js');
console.log('    Code kept for future revalidation. Exiting.');
process.exit(0);

const bot = new BotRunner({
  name: 'XRP-BOT',
  symbol: 'XRP/USDT:USDT',
  webhookPort: 3454,
  startingBalance: 10000,
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });
process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
