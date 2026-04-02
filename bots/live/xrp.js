// XRP live bot — Binance futures testnet
import LiveBotRunner from '../LiveBotRunner.js';

const bot = new LiveBotRunner({
  name: 'XRP-LIVE',
  symbol: 'XRP/USDT:USDT',
});

bot.start().catch(err => {
  console.error('XRP live bot failed:', err);
  process.exit(1);
});
