// XRP paper bot
import BotRunner from '../BotRunner.js';

const bot = new BotRunner({
  name: 'XRP-BOT',
  symbol: 'XRP/USDT:USDT',
  startingBalance: 10000,
});

bot.start().catch(err => {
  console.error('XRP bot failed:', err);
  process.exit(1);
});
