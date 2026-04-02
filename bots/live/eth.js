// ETH live bot — Binance futures testnet
import LiveBotRunner from '../LiveBotRunner.js';

const bot = new LiveBotRunner({
  name: 'ETH-LIVE',
  symbol: 'ETH/USDT:USDT',
  startingBalance: 10000,
});

bot.start().catch(err => {
  console.error('ETH live bot failed:', err);
  process.exit(1);
});
