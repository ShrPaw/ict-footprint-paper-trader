import LiveBotRunner from '../LiveBotRunner.js';

const bot = new LiveBotRunner({
  name: 'BTC-LIVE',
  symbol: 'BTC/USDT:USDT',
  webhookPort: 3463,
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });
process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
