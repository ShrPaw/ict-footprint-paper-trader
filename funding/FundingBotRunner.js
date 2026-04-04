// ═══════════════════════════════════════════════════════════════════
// FundingBotRunner — Live Paper Trading Bot
// ═══════════════════════════════════════════════════════════════════
// Responsibilities:
//   - Monitor funding settlements (every 8h: 00:00, 08:00, 16:00 UTC)
//   - Detect signals and enter positions
//   - Exit after 48h (time-only, no stops)
//   - Log every trade
//   - Telegram alerts
// ═══════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FundingEngine from './FundingEngine.js';
import PositionManager from './PositionManager.js';
import RiskMonitor from './RiskMonitor.js';
import FundingConfig from './FundingConfig.js';
import TelegramAlerter from '../alerts/TelegramAlerter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default class FundingBotRunner {
  constructor(options = {}) {
    this.name = options.name || 'FUNDING-BOT';
    this.startingCapital = options.startingCapital || 10000;
    this.checkIntervalMs = options.checkIntervalMs || 300000; // 5 min

    this.fundingEngine = new FundingEngine();
    this.pm = new PositionManager(this.startingCapital);
    this.riskMonitor = new RiskMonitor(this.pm);
    this.telegram = new TelegramAlerter();

    this.running = false;
    this.dailySummarySent = false;
    this.lastCheckTime = 0;

    // Log file
    this.logDir = path.join(process.cwd(), FundingConfig.logging.logDir);
    if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
    this.tradeLogFile = path.join(this.logDir, FundingConfig.logging.tradeLogFile);
  }

  // ── Start ────────────────────────────────────────────────────────

  async start() {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║   💰 ${this.name.padEnd(47)}║`);
    console.log(`║   Funding Rate Positioning Edge                      ║`);
    console.log(`║   Entry: extremes | Exit: 48h | No stops             ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);

    // Initial data load
    await this._loadData();

    this.running = true;
    await this.telegram.sendAlert(
      `💰 ${this.name} started\n` +
      `Assets: ${FundingConfig.assets.map(a => a.label).join(', ')}\n` +
      `Mode: Funding rate positioning\n` +
      `Exit: 48h time-only | No stops\n` +
      `Risk: 1% per trade | Max 3 concurrent`
    );

    // Start monitoring loop
    this._startMonitoring();
    this._scheduleDailySummary();

    console.log(`[${this.name}] Running. Ctrl+C to stop.\n`);
  }

  // ── Data Loading ─────────────────────────────────────────────────

  async _loadData() {
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(); // 90 days

    for (const asset of FundingConfig.assets) {
      await this.fundingEngine.fetchFundingRates(
        asset.symbol, asset.label, startDate, endDate
      );
      await this.fundingEngine.fetchCandles(
        asset.symbol, asset.label, startDate, endDate
      );
      this.fundingEngine.computeThresholds(asset.label);
    }
  }

  // ── Monitoring Loop ──────────────────────────────────────────────

  _startMonitoring() {
    setInterval(async () => {
      if (!this.running) return;
      try {
        await this._check();
      } catch (e) {
        console.error(`[${this.name}] Check error: ${e.message}`);
      }
    }, this.checkIntervalMs);
  }

  async _check() {
    // Refresh data
    await this._loadData();

    // Check time exits
    const now = Date.now();
    const exits = this.pm.checkTimeExits(now, this.fundingEngine.candleData);
    for (const trade of exits) {
      const emoji = trade.pnl >= 0 ? '✅' : '❌';
      console.log(`${emoji} [${this.name}] TIME EXIT | ${trade.label} | PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(2)}%) | ${trade.holdHours}h`);
      this._logTrade(trade);
      await this.telegram.sendExit(trade);
    }

    // Check for new signals at funding settlement
    for (const asset of FundingConfig.assets) {
      const signal = this.fundingEngine.checkLiveSignal(asset.label);
      if (signal) {
        signal.symbol = asset.label;
        const result = this.pm.openPosition(signal);
        if (result.ok) {
          const p = result.position;
          console.log(`🟢 [${this.name}] ENTRY | ${p.label} ${p.side.toUpperCase()} @ ${p.entryPrice.toFixed(4)} | Signal: ${p.signalType} | Size: ${p.size.toFixed(4)}`);
          await this.telegram.sendAlert(
            `🟢 FUNDING ENTRY\n` +
            `${p.label} LONG @ ${p.entryPrice.toFixed(4)}\n` +
            `Signal: ${p.signalType}\n` +
            `Funding: ${(p.fundingRate * 100).toFixed(4)}%\n` +
            `Size: ${p.size.toFixed(4)}\n` +
            `Exit: 48h (no stops)`
          );
        } else {
          console.log(`⛔ [${this.name}] Rejected ${asset.label}: ${result.reason}`);
        }
      }
    }

    // Risk check
    const alerts = this.riskMonitor.check();
    for (const alert of alerts) {
      console.log(`⚠️ [${this.name}] ${alert.level}: ${alert.message}`);
      if (alert.level === 'CRITICAL') {
        await this.telegram.sendAlert(`🚨 CRITICAL: ${alert.message}`);
      }
    }

    this.lastCheckTime = now;
  }

  // ── Trade Logging ────────────────────────────────────────────────

  _logTrade(trade) {
    try {
      const entry = JSON.stringify({
        label: trade.label,
        signalType: trade.signalType,
        fundingRate: trade.fundingRate,
        side: trade.side,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        entryTime: new Date(trade.entryTime).toISOString(),
        exitTime: new Date(trade.exitTime).toISOString(),
        holdHours: trade.holdHours,
        pnl: trade.pnl,
        pnlPercent: trade.pnlPercent,
        grossReturn: trade.grossReturn,
        netReturn: trade.netReturn,
        totalFees: trade.totalFees,
        exitReason: trade.exitReason,
      });
      fs.appendFileSync(this.tradeLogFile, entry + '\n');
    } catch (e) {
      console.error(`[${this.name}] Log error: ${e.message}`);
    }
  }

  // ── Daily Summary ────────────────────────────────────────────────

  _scheduleDailySummary() {
    setInterval(async () => {
      const now = new Date();
      if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0 && !this.dailySummarySent) {
        this.dailySummarySent = true;
        const report = this.riskMonitor.getReport();
        await this.telegram.sendDailySummary(report);
      }
      if (now.getUTCHours() === 0 && now.getUTCMinutes() === 1) {
        this.dailySummarySent = false;
      }
    }, 60000);
  }

  // ── Stop ─────────────────────────────────────────────────────────

  async stop() {
    this.running = false;
    const stats = this.pm.getStats();
    console.log(`\n── [${this.name}] Final Stats ──────────────────────────`);
    console.log(`  Capital: $${stats.capital.toFixed(2)} | PnL: $${stats.totalPnL.toFixed(2)} | WR: ${stats.winRate}%`);
    await this.telegram.sendAlert(`🛑 ${this.name} stopped. Capital: $${stats.capital.toFixed(2)}`);
  }
}
