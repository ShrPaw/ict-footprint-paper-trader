// SOL live bot — Binance futures testnet
import LiveBotRunner from '../LiveBotRunner.js';

const bot = new LiveBotRunner({
  name: 'SOL-LIVE',
  symbol: 'SOL/USDT:USDT',
});

bot.start().catch(err => {
  console.error('SOL live bot failed:', err);
  process.exit(1);
});
