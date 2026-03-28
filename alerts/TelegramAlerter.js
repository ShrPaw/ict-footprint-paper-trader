import https from 'https';
import { EventEmitter } from 'events';

export default class TelegramAlerter extends EventEmitter {
  constructor() {
    super();
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.enabled = !!(this.botToken && this.chatId);
    this.queue = [];
    this.sending = false;
    this.lastSent = 0;
    this.minInterval = 350; // ms between messages (Telegram rate limit: ~30/sec)

    if (this.enabled) {
      console.log('[Telegram] Alerts enabled → chat ' + this.chatId);
    } else {
      console.log('[Telegram] Alerts disabled (set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID)');
    }
  }

  // ── Entry Alert ───────────────────────────────────────────────────
  async sendEntry(position) {
    if (!this.enabled) return;
    const sideEmoji = position.side === 'long' ? '🟢 LONG' : '🔴 SHORT';
    const regimeEmoji = {
      TRENDING: '📈', RANGING: '↔️', VOL_EXPANSION: '💥',
      LOW_VOL: '😴', ABSORPTION: '🧲',
    };

    const msg = `
🎯 *NEW ENTRY*

${sideEmoji} \`${position.symbol}\`
💰 Entry: \`${position.entryPrice.toFixed(4)}\`
🛑 Stop Loss: \`${position.stopLoss.toFixed(4)}\`
🎯 Take Profit: \`${position.takeProfit.toFixed(4)}\`
📊 Size: \`${position.size.toFixed(4)}\`
${regimeEmoji[position.regime] || '❓'} Regime: *${position.regime}*
📝 Signal: ${position.reason}
💵 Fee: $${position.fee.toFixed(2)}
    `.trim();

    await this._send(msg);
  }

  // ── Exit Alert ────────────────────────────────────────────────────
  async sendExit(trade) {
    if (!this.enabled) return;
    const emoji = trade.pnl >= 0 ? '✅' : '❌';
    const exitEmoji = {
      take_profit: '🎯 TP HIT',
      stop_loss: '🛑 SL HIT',
      breakeven_sl: '⚖️ BE SL HIT',
      trailing_sl: '📉 TRAILING SL',
      time_exit: '⏰ TIME EXIT',
      manual: '🖐️ MANUAL',
      backtest_end: '📊 END',
    };

    const durationH = (trade.duration / 3600000).toFixed(1);
    const msg = `
${emoji} *POSITION CLOSED*

\`${trade.symbol}\` ${trade.side.toUpperCase()}
📥 Entry: \`${trade.entryPrice.toFixed(4)}\`
📤 Exit: \`${trade.exitPrice.toFixed(4)}\`
💰 PnL: *$${trade.pnl.toFixed(2)}* (${trade.pnlPercent.toFixed(2)}%)
${exitEmoji[trade.closeReason] || trade.closeReason}
⏱️ Duration: ${durationH}h
📊 Regime: ${trade.regime}
💸 Fees: $${trade.totalFees.toFixed(2)}
    `.trim();

    await this._send(msg);
  }

  // ── Daily Summary ─────────────────────────────────────────────────
  async sendDailySummary(stats) {
    if (!this.enabled) return;
    const msg = `
📊 *DAILY SUMMARY*

💵 Balance: $${stats.balance.toFixed(2)}
📈 Total PnL: $${stats.totalPnL.toFixed(2)} (${stats.totalPnLPercent.toFixed(2)}%)
📅 Daily PnL: $${stats.dailyPnL.toFixed(2)}
🎯 Win Rate: ${stats.winRate}% (${stats.wins}W/${stats.losses}L)
📊 Trades: ${stats.totalTrades}
💸 Fees: $${stats.totalFees.toFixed(2)}
    `.trim();

    await this._send(msg);
  }

  // ── Regime Change Alert ───────────────────────────────────────────
  async sendRegimeChange(symbol, oldRegime, newRegime) {
    if (!this.enabled) return;
    const regimeEmoji = {
      TRENDING: '📈', RANGING: '↔️', VOL_EXPANSION: '💥',
      LOW_VOL: '😴', ABSORPTION: '🧲',
    };

    await this._send(
      `${regimeEmoji[newRegime] || '❓'} *REGIME CHANGE*\n` +
      `\`${symbol}\`: ${oldRegime} → *${newRegime}*`
    );
  }

  // ── Custom Alert ──────────────────────────────────────────────────
  async sendAlert(text) {
    if (!this.enabled) return;
    await this._send(`🔔 ${text}`);
  }

  // ── Engine Stats Snapshot ─────────────────────────────────────────
  async sendStats(stats) {
    if (!this.enabled) return;
    const msg = `
📈 *STATS SNAPSHOT*

💵 Balance: $${stats.balance.toFixed(2)}
📊 Total PnL: $${stats.totalPnL.toFixed(2)} (${stats.totalPnLPercent.toFixed(2)}%)
🎯 Win Rate: ${stats.winRate}%
📊 Trades: ${stats.totalTrades}
    `.trim();

    await this._send(msg);
  }

  // ── Send with rate limiting ───────────────────────────────────────
  async _send(text) {
    return new Promise((resolve) => {
      this.queue.push({ text, resolve });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.sending || this.queue.length === 0) return;
    this.sending = true;

    while (this.queue.length > 0) {
      const { text, resolve } = this.queue.shift();

      // Rate limit
      const now = Date.now();
      const wait = Math.max(0, this.minInterval - (now - this.lastSent));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      try {
        await this._httpSend(text);
        this.lastSent = Date.now();
      } catch (err) {
        console.error(`[Telegram] Send error: ${err.message}`);
      }

      resolve();
    }

    this.sending = false;
  }

  _httpSend(text) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      const options = {
        hostname: 'api.telegram.org',
        path: `/bot${this.botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Telegram API ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}
