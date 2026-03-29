import BotRunner from '../BotRunner.js';

const bot = new BotRunner({
  name: 'ETH-BOT',
  symbol: 'ETH/USDT:USDT',
  webhookPort: 3451,
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });

process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
