import BinanceLiveBotRunner from '../../BinanceLiveBotRunner.js';

const bot = new BinanceLiveBotRunner({
  name: 'XRP-BINANCE',
  symbol: 'XRP/USDT:USDT',
});

bot.start().catch(err => { console.error('Fatal:', err); process.exit(1); });
process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });
