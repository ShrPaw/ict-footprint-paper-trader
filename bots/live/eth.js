import LiveBotRunner from '../LiveBotRunner.js';

const bot = new LiveBotRunner({
  name: 'ETH-LIVE',
  symbol: 'ETH/USDT:USDT',
  webhookPort: 3461,
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });
process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
