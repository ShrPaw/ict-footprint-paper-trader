// ═══════════════════════════════════════════════════════════════════
// BacktestEngine — Event-Driven Simulation
// ═══════════════════════════════════════════════════════════════════
// Responsibilities:
//   - Event-driven simulation across all assets
//   - Support overlapping trades (up to 3 concurrent)
//   - Include fees and slippage
//   - Output: equity curve, drawdown, trade distribution, monthly returns
// ═══════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FundingEngine from './FundingEngine.js';
import PositionManager from './PositionManager.js';
import RiskMonitor from './RiskMonitor.js';
import FundingConfig from './FundingConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default class BacktestEngine {
  constructor(options = {}) {
    this.startDate = options.startDate || '2022-01-01T00:00:00Z';
    this.endDate = options.endDate || '2026-03-31T23:59:00Z';
    this.startingCapital = options.startingCapital || 10000;
    this.fundingEngine = new FundingEngine();
    this.pm = new PositionManager(this.startingCapital);
    this.riskMonitor = new RiskMonitor(this.pm);
    this.equityCurve = [this.startingCapital];
    this.equityTimestamps = [];
  }

  // ── Run Backtest ─────────────────────────────────────────────────

  async run() {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  📊 FUNDING BACKTEST ENGINE                                      ║
║  Entry: funding extremes | Exit: 48h time | No stops            ║
║  Capital: $${this.startingCapital} | Risk: 1% per trade | Max 3 concurrent       ║
╚══════════════════════════════════════════════════════════════════╝
`);

    // Fetch data for all assets
    for (const asset of FundingConfig.assets) {
      await this.fundingEngine.fetchFundingRates(
        asset.symbol, asset.label, this.startDate, this.endDate
      );
      await this.fundingEngine.fetchCandles(
        asset.symbol, asset.label, this.startDate, this.endDate
      );
      this.fundingEngine.computeThresholds(asset.label);
    }

    // Collect all signals across assets, sorted by time
    let allSignals = [];
    for (const asset of FundingConfig.assets) {
      const signals = this.fundingEngine.detectSignals(asset.label);
      // Attach symbol for position tracking
      signals.forEach(s => s.symbol = asset.label);
      allSignals.push(...signals);
    }
    allSignals.sort((a, b) => a.entryTimestamp - b.entryTimestamp);

    console.log(`\n  📊 Total signals: ${allSignals.length}`);
    for (const asset of FundingConfig.assets) {
      const count = allSignals.filter(s => s.label === asset.label).length;
      console.log(`    ${asset.label}: ${count}`);
    }

    // Process signals chronologically
    console.log(`\n  🔄 Processing signals...`);
    let processed = 0;

    for (const signal of allSignals) {
      // Before opening new position, check time exits for existing positions
      const exits = this.pm.checkTimeExits(signal.entryTimestamp, this.fundingEngine.candleData);
      for (const trade of exits) {
        this._updateEquityCurve(trade.exitTime);
      }

      // Try to open position
      const result = this.pm.openPosition(signal);
      if (result.ok) {
        processed++;
      }
    }

    // Close any remaining positions at the end
    const finalTimestamp = new Date(this.endDate).getTime();
    const remainingExits = this.pm.checkTimeExits(finalTimestamp, this.fundingEngine.candleData);
    for (const trade of remainingExits) {
      this._updateEquityCurve(trade.exitTime);
    }

    console.log(`  ✅ Processed: ${processed} trades opened`);

    // Generate report
    return this.generateReport();
  }

  // ── Equity Curve ─────────────────────────────────────────────────

  _updateEquityCurve(timestamp) {
    this.equityCurve.push(this.pm.capital);
    this.equityTimestamps.push(timestamp);
  }

  // ── Report Generation ────────────────────────────────────────────

  generateReport() {
    const stats = this.pm.getStats();
    const trades = this.pm.tradeLog;
    const report = this.riskMonitor.getReport();

    // Monthly returns
    const monthlyPnL = {};
    for (const t of trades) {
      const d = new Date(t.exitTime);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthlyPnL[key] = (monthlyPnL[key] || { pnl: 0, count: 0 });
      monthlyPnL[key].pnl += t.pnl;
      monthlyPnL[key].count++;
    }

    // By asset
    const byAsset = {};
    for (const t of trades) {
      if (!byAsset[t.label]) byAsset[t.label] = { trades: [], pnl: 0 };
      byAsset[t.label].trades.push(t);
      byAsset[t.label].pnl += t.pnl;
    }

    // By signal type
    const bySignal = {};
    for (const t of trades) {
      if (!bySignal[t.signalType]) bySignal[t.signalType] = { trades: [], pnl: 0 };
      bySignal[t.signalType].trades.push(t);
      bySignal[t.signalType].pnl += t.pnl;
    }

    // By year
    const byYear = {};
    for (const t of trades) {
      if (!byYear[t.year]) byYear[t.year] = { trades: [], pnl: 0 };
      byYear[t.year].trades.push(t);
      byYear[t.year].pnl += t.pnl;
    }

    // Trade distribution
    const returns = trades.map(t => t.netReturn);
    const sortedReturns = [...returns].sort((a, b) => a - b);

    // Drawdown curve
    let peak = this.startingCapital;
    const ddCurve = [];
    for (const eq of this.equityCurve) {
      if (eq > peak) peak = eq;
      ddCurve.push((peak - eq) / peak * 100);
    }

    // Generate markdown report
    let r = `# 📊 FUNDING BACKTEST REPORT\n\n`;
    r += `**Period:** ${this.startDate.slice(0, 10)} → ${this.endDate.slice(0, 10)}\n`;
    r += `**Capital:** $${this.startingCapital}\n`;
    r += `**Architecture:** Funding extremes → 48h time exit → No stops\n\n---\n\n`;

    // Summary
    r += `## Summary\n\n`;
    r += `| Metric | Value |\n`;
    r += `|--------|-------|\n`;
    r += `| Final Capital | $${stats.capital.toFixed(2)} |\n`;
    r += `| Total PnL | $${stats.totalPnL.toFixed(2)} |\n`;
    r += `| Total Return | ${stats.totalReturnPct.toFixed(2)}% |\n`;
    r += `| Total Trades | ${stats.totalTrades} |\n`;
    r += `| Win Rate | ${stats.winRate}% |\n`;
    r += `| Profit Factor | ${stats.profitFactor} |\n`;
    r += `| Avg Win | $${stats.avgWin} |\n`;
    r += `| Avg Loss | $${stats.avgLoss} |\n`;
    r += `| Max Drawdown | ${stats.maxDrawdown} |\n`;
    r += `| Total Fees | $${stats.totalFees.toFixed(2)} |\n`;
    r += `| Max Consec. Losses | ${stats.maxConsecutiveLosses} |\n\n`;

    // By Asset
    r += `## By Asset\n\n`;
    r += `| Asset | Trades | PnL | Avg PnL | WR |\n`;
    r += `|-------|--------|-----|---------|----|\n`;
    for (const [label, data] of Object.entries(byAsset)) {
      const wins = data.trades.filter(t => t.pnl > 0).length;
      const wr = (wins / data.trades.length * 100).toFixed(1);
      r += `| ${label} | ${data.trades.length} | $${data.pnl.toFixed(2)} | $${(data.pnl / data.trades.length).toFixed(2)} | ${wr}% |\n`;
    }
    r += `\n`;

    // By Year
    r += `## By Year\n\n`;
    r += `| Year | Trades | PnL | Avg PnL | WR |\n`;
    r += `|------|--------|-----|---------|----|\n`;
    for (const [year, data] of Object.entries(byYear).sort()) {
      const wins = data.trades.filter(t => t.pnl > 0).length;
      const wr = (wins / data.trades.length * 100).toFixed(1);
      r += `| ${year} | ${data.trades.length} | $${data.pnl.toFixed(2)} | $${(data.pnl / data.trades.length).toFixed(2)} | ${wr}% |\n`;
    }
    r += `\n`;

    // By Signal Type
    r += `## By Signal Type\n\n`;
    r += `| Signal | Trades | PnL | Avg PnL | WR |\n`;
    r += `|--------|--------|-----|---------|----|\n`;
    for (const [sig, data] of Object.entries(bySignal)) {
      const wins = data.trades.filter(t => t.pnl > 0).length;
      const wr = (wins / data.trades.length * 100).toFixed(1);
      r += `| ${sig} | ${data.trades.length} | $${data.pnl.toFixed(2)} | $${(data.pnl / data.trades.length).toFixed(2)} | ${wr}% |\n`;
    }
    r += `\n`;

    // Monthly Returns
    r += `## Monthly Returns\n\n`;
    r += `| Month | Trades | PnL |\n`;
    r += `|-------|--------|-----|\n`;
    for (const [month, data] of Object.entries(monthlyPnL).sort()) {
      r += `| ${month} | ${data.count} | $${data.pnl.toFixed(2)} |\n`;
    }
    r += `\n`;
    r += `**Profitable months:** ${report.monthlyStats.profitableMonths}/${report.monthlyStats.totalMonths} (${report.monthlyStats.profitablePct}%)\n\n`;

    // Trade Distribution
    r += `## Trade Distribution\n\n`;
    r += `| Metric | Value |\n`;
    r += `|--------|-------|\n`;
    r += `| Best trade | ${(sortedReturns[sortedReturns.length - 1] * 100).toFixed(2)}% |\n`;
    r += `| Worst trade | ${(sortedReturns[0] * 100).toFixed(2)}% |\n`;
    r += `| Median return | ${(sortedReturns[Math.floor(sortedReturns.length / 2)] * 100).toFixed(2)}% |\n`;
    r += `| p5 return | ${(sortedReturns[Math.floor(sortedReturns.length * 0.05)] * 100).toFixed(2)}% |\n`;
    r += `| p95 return | ${(sortedReturns[Math.floor(sortedReturns.length * 0.95)] * 100).toFixed(2)}% |\n\n`;

    // Validation: compare to research expectations
    r += `## Validation vs Research\n\n`;
    r += `| Asset | Expected PF | Actual PF | Expected bps | Actual bps | Match? |\n`;
    r += `|-------|-------------|-----------|--------------|------------|--------|\n`;
    for (const asset of FundingConfig.assets) {
      const data = byAsset[asset.label];
      if (!data) continue;
      const expected = FundingConfig.assetRisk[asset.label];
      const wins = data.trades.filter(t => t.pnl > 0);
      const losses = data.trades.filter(t => t.pnl <= 0);
      const gp = wins.reduce((s, t) => s + t.pnl, 0);
      const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
      const actualPF = gl > 0 ? (gp / gl).toFixed(2) : '∞';
      const actualBps = (data.pnl / data.trades.length / this.startingCapital * 10000).toFixed(1);
      const match = Math.abs(parseFloat(actualPF) - expected.pf) / expected.pf < 0.3 ? '✅' : '⚠️';
      r += `| ${asset.label} | ${expected.pf} | ${actualPF} | ${expected.expectedBps} | ${actualBps} | ${match} |\n`;
    }

    return {
      report: r,
      stats,
      trades,
      equityCurve: this.equityCurve,
      byAsset,
      byYear,
      bySignal,
      monthlyPnL,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLI Entry Point
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const engine = new BacktestEngine({
    startDate: '2022-01-01T00:00:00Z',
    endDate: '2026-03-31T23:59:00Z',
    startingCapital: 10000,
  });

  const result = await engine.run();

  // Write report
  const reportPath = path.join(__dirname, '..', 'FUNDING_BACKTEST_REPORT.md');
  fs.writeFileSync(reportPath, result.report);
  console.log(`\n  ✅ Report: ${reportPath}`);

  // Write trades
  const tradesPath = path.join(__dirname, '..', 'funding-trades.jsonl');
  const tradesLines = result.trades.map(t => JSON.stringify(t)).join('\n');
  fs.writeFileSync(tradesPath, tradesLines);
  console.log(`  ✅ Trades: ${tradesPath}`);

  // Write equity curve
  const equityPath = path.join(__dirname, '..', 'funding-equity.json');
  fs.writeFileSync(equityPath, JSON.stringify(result.equityCurve));
  console.log(`  ✅ Equity: ${equityPath}`);

  // Print summary
  const s = result.stats;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 BACKTEST RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Capital:    $${s.capital.toFixed(2)} (from $${s.startingCapital})`);
  console.log(`  PnL:        $${s.totalPnL.toFixed(2)} (${s.totalReturnPct.toFixed(2)}%)`);
  console.log(`  Trades:     ${s.totalTrades}`);
  console.log(`  Win Rate:   ${s.winRate}%`);
  console.log(`  PF:         ${s.profitFactor}`);
  console.log(`  Max DD:     ${s.maxDrawdown}`);
  console.log(`  Fees:       $${s.totalFees.toFixed(2)}`);
  console.log(`  Max consec: ${s.maxConsecutiveLosses}`);

  // Per asset
  console.log(`\n  Per Asset:`);
  for (const [label, data] of Object.entries(result.byAsset)) {
    const wins = data.trades.filter(t => t.pnl > 0).length;
    console.log(`    ${label}: $${data.pnl.toFixed(2)} (${data.trades.length} trades, ${(wins / data.trades.length * 100).toFixed(1)}% WR)`);
  }

  console.log(`\n  Done.`);
}

// Run if called directly
if (process.argv[1] && process.argv[1].includes('BacktestEngine')) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1); });
}
