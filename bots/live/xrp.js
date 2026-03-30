import LiveBotRunner from '../LiveBotRunner.js';

const bot = new LiveBotRunner({
  name: 'XRP-LIVE',
  symbol: 'XRP/USDT:USDT',
  webhookPort: 3464,
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });
process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
