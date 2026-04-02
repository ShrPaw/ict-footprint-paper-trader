// BTC live bot — Binance futures testnet
import LiveBotRunner from '../LiveBotRunner.js';

const bot = new LiveBotRunner({
  name: 'BTC-LIVE',
  symbol: 'BTC/USDT:USDT',
});

bot.start().catch(err => {
  console.error('BTC live bot failed:', err);
  process.exit(1);
});
