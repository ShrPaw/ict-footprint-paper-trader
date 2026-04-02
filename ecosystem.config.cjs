module.exports = {
  apps: [
    {
      name: 'dashboard',
      script: 'dashboard/server.js',
      env: { DASHBOARD_PORT: 3500 },
    },
    {
      name: 'eth',
      script: 'bots/eth/bot.js',
      node_args: '--env-file=.env',
    },
    {
      name: 'sol',
      script: 'bots/sol/bot.js',
      node_args: '--env-file=.env',
    },
    {
      name: 'btc',
      script: 'bots/btc/bot.js',
      node_args: '--env-file=.env',
    },
  ],
};
