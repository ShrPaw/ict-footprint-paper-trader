// ═══════════════════════════════════════════════════════════════════
// Funding Bot — Live Entry Point
// ═══════════════════════════════════════════════════════════════════
// Usage: node --env-file=.env funding/live.js
// ═══════════════════════════════════════════════════════════════════

import FundingBotRunner from './FundingBotRunner.js';

const bot = new FundingBotRunner({
  name: 'FUNDING-BOT',
  startingCapital: 10000,
  checkIntervalMs: 300000, // 5 minutes
});

bot.start().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await bot.stop();
  process.exit(0);
});
