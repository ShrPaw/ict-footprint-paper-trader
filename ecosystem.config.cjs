module.exports = {
  apps: [
    {
      name: 'dashboard',
      script: 'dashboard/server.js',
      env: { DASHBOARD_PORT: 3500 },
    },
    {
      name: 'eth-bot',
      script: 'bots/eth/bot.js',
      node_args: '--env-file=.env',
    },
    {
      name: 'sol-bot',
      script: 'bots/sol/bot.js',
      node_args: '--env-file=.env',
    },
    {
      name: 'btc-bot',
      script: 'bots/btc/bot.js',
      node_args: '--env-file=.env',
    },
    {
      name: 'xrp-bot',
      script: 'bots/xrp/bot.js',
      node_args: '--env-file=.env',
    },
  ],
};
