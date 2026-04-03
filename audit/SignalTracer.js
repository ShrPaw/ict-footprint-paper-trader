// ═══════════════════════════════════════════════════════════════
// SignalTracer.js — Full Observability & Edge Discovery Engine
// ═══════════════════════════════════════════════════════════════
//
// PURPOSE: Trace EVERY signal decision. Answer WHY trades were
// accepted or rejected. Find where REAL edge exists.
//
// This is NOT an optimizer. This is a forensic tool.
//
// Produces:
//   1. Signal trace log (every signal, accepted or blocked)
//   2. Blocking dominance analysis
//   3. False negative detection
//   4. Win vs Loss feature comparison
//   5. Emergency stop forensics
//   6. Time distribution validation

import fs from 'fs';
import path from 'path';

export default class SignalTracer {
  constructor(options = {}) {
    this.traces = [];
    this.rejections = [];
    this.tradeOutcomes = [];
    this.outputDir = options.outputDir || path.join(process.cwd(), 'backtest-results');

    // Blocking counters
    this.blockCounts = {
      regimeBlocked: 0,
      killzoneBlocked: 0,
      sessionBlocked: 0,
      weekendBlocked: 0,
      emaAlignmentBlocked: 0,
      cooldownBlocked: 0,
      modelReturnedNull: 0,
      exhaustionBlocked: 0,
      portfolioRiskBlocked: 0,
      thresholdBlocked: 0,
      confluenceBlocked: 0,
      directionBlocked: 0,
      totalSignals: 0,
      totalExecuted: 0,
    };

    // Per-asset tracking
    this.assetTraces = {};
  }

  /**
   * Log a signal evaluation — call at every decision point
   */
  logSignal(trace) {
    // trace = { timestamp, symbol, stage, accepted, reason, features, scores, ... }
    this.traces.push({
      ...trace,
      _index: this.traces.length,
    });
    this.blockCounts.totalSignals++;

    // Track per-asset
    const asset = trace.symbol?.split('/')[0]?.split(':')[0] || 'UNKNOWN';
    if (!this.assetTraces[asset]) this.assetTraces[asset] = { signals: 0, accepted: 0, rejected: 0, rejections: {} };
    this.assetTraces[asset].signals++;
    if (trace.accepted) {
      this.assetTraces[asset].accepted++;
    } else {
      this.assetTraces[asset].rejected++;
      const cat = trace.rejectionCategory || 'unknown';
      this.assetTraces[asset].rejections[cat] = (this.assetTraces[asset].rejections[cat] || 0) + 1;
    }
  }

  /**
   * Log a gate rejection — pre-signal filtering
   */
  logGateRejection(symbol, gate, reason, context = {}) {
    const cat = `${gate}Blocked`;
    if (this.blockCounts[cat] !== undefined) this.blockCounts[cat]++;
    this.rejections.push({
      timestamp: context.timestamp,
      symbol,
      gate,
      reason,
      context,
      category: 'gate_rejection',
    });
  }

  /**
   * Log an executed trade with full lifecycle
   */
  logTradeOutcome(trade) {
    this.tradeOutcomes.push(trade);
    this.blockCounts.totalExecuted++;
  }

  /**
   * Compute blocking dominance — which gates block most trades?
   */
  computeBlockingDominance() {
    const total = this.blockCounts.totalSignals;
    if (total === 0) return {};

    const dominance = {};
    for (const [gate, count] of Object.entries(this.blockCounts)) {
      if (gate.startsWith('total')) continue;
      if (count === 0) continue;
      dominance[gate] = {
        count,
        percentOfTotal: ((count / total) * 100).toFixed(2),
      };
    }

    // Sort by count descending
    const sorted = Object.entries(dominance)
      .sort((a, b) => b[1].count - a[1].count);

    return { total, dominance: Object.fromEntries(sorted) };
  }

  /**
   * Find false negatives — blocked signals that would have been profitable
   * Requires forward-looking price data
   */
  detectFalseNegatives(forwardReturns = []) {
    // forwardReturns = [{ timestamp, symbol, blocked, reason, futurePnL (if it had been taken) }]
    const falseNegatives = [];

    for (const trace of this.traces) {
      if (trace.accepted) continue;
      if (trace.futurePnL === undefined) continue;

      if (trace.futurePnL > 0) {
        falseNegatives.push({
          timestamp: trace.timestamp,
          symbol: trace.symbol,
          reason: trace.rejectionCategory,
          futurePnL: trace.futurePnL,
          features: trace.features,
        });
      }
    }

    return {
      totalBlocked: this.traces.filter(t => !t.accepted).length,
      falseNegatives: falseNegatives.length,
      falseNegativePnL: falseNegatives.reduce((s, t) => s + t.futurePnL, 0),
      byGate: this._groupBy(falseNegatives, 'reason'),
    };
  }

  /**
   * Compare features of winning vs losing trades
   */
  analyzeWinLossFeatures() {
    const wins = this.tradeOutcomes.filter(t => t.pnl > 0);
    const losses = this.tradeOutcomes.filter(t => t.pnl <= 0);

    if (wins.length === 0 || losses.length === 0) {
      return { wins: wins.length, losses: losses.length, message: 'Insufficient data for comparison' };
    }

    const featureKeys = ['atrZ', 'distFromMean', 'stackedCount', 'deltaSum', 'volRatio', 'momentum'];

    const comparison = {};
    for (const key of featureKeys) {
      const winVals = wins.map(t => t.features?.[key]).filter(v => v !== undefined);
      const lossVals = losses.map(t => t.features?.[key]).filter(v => v !== undefined);

      if (winVals.length > 0 && lossVals.length > 0) {
        comparison[key] = {
          winMean: (winVals.reduce((a, b) => a + b, 0) / winVals.length).toFixed(4),
          lossMean: (lossVals.reduce((a, b) => a + b, 0) / lossVals.length).toFixed(4),
          winMedian: winVals.sort((a, b) => a - b)[Math.floor(winVals.length / 2)]?.toFixed(4),
          lossMedian: lossVals.sort((a, b) => a - b)[Math.floor(lossVals.length / 2)]?.toFixed(4),
          divergence: Math.abs(
            (winVals.reduce((a, b) => a + b, 0) / winVals.length) -
            (lossVals.reduce((a, b) => a + b, 0) / lossVals.length)
          ).toFixed(4),
        };
      }
    }

    return {
      wins: wins.length,
      losses: losses.length,
      comparison,
      lossDetails: losses.map(t => ({
        timestamp: t.timestamp,
        symbol: t.symbol,
        pnl: t.pnl,
        closeReason: t.closeReason,
        signalType: t.signalType,
        regime: t.regime,
        features: t.features,
      })),
    };
  }

  /**
   * Emergency stop forensics — why were losing trades allowed?
   */
  analyzeEmergencyStops() {
    const emergencyTrades = this.tradeOutcomes.filter(t => t.closeReason === 'emergency_stop');

    return {
      count: emergencyTrades.length,
      totalLoss: emergencyTrades.reduce((s, t) => s + t.pnl, 0),
      avgLoss: emergencyTrades.length > 0
        ? emergencyTrades.reduce((s, t) => s + t.pnl, 0) / emergencyTrades.length
        : 0,
      byRegime: this._groupBy(emergencyTrades, 'regime'),
      bySignalType: this._groupBy(emergencyTrades, 'signalType'),
      details: emergencyTrades.map(t => ({
        timestamp: t.timestamp,
        symbol: t.symbol,
        pnl: t.pnl,
        regime: t.regime,
        signalType: t.signalType,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        atr: t.atr,
        durationMin: t.durationMin,
        features: t.features,
        // Why was this trade allowed?
        allowedBecause: t.allowedReason || 'unknown',
      })),
    };
  }

  /**
   * Validate time distribution — do trades exist across full dataset?
   */
  validateTimeDistribution() {
    if (this.tradeOutcomes.length === 0) {
      return { valid: false, reason: 'No trades recorded' };
    }

    const byYear = {};
    const byMonth = {};
    const byHour = {};

    for (const t of this.tradeOutcomes) {
      const date = new Date(t.entryTime || t.timestamp);
      const year = date.getUTCFullYear();
      const month = date.toISOString().slice(0, 7);
      const hour = date.getUTCHours();

      byYear[year] = (byYear[year] || 0) + 1;
      byMonth[month] = (byMonth[month] || 0) + 1;
      byHour[hour] = (byHour[hour] || 0) + 1;
    }

    const years = Object.keys(byYear).sort();
    const gaps = [];
    for (let i = 1; i < years.length; i++) {
      if (parseInt(years[i]) - parseInt(years[i - 1]) > 1) {
        gaps.push(`${years[i - 1]} → ${years[i]}`);
      }
    }

    // Check if >50% of trades are in a single year
    const totalTrades = this.tradeOutcomes.length;
    const maxYearTrades = Math.max(...Object.values(byYear));
    const concentrated = maxYearTrades / totalTrades > 0.5;

    return {
      valid: gaps.length === 0 && !concentrated,
      years,
      byYear,
      byMonth,
      byHour,
      gaps,
      concentration: concentrated
        ? `WARNING: ${((maxYearTrades / totalTrades) * 100).toFixed(0)}% of trades in single year`
        : 'OK',
    };
  }

  /**
   * Full analysis report
   */
  generateReport() {
    const blocking = this.computeBlockingDominance();
    const timeDist = this.validateTimeDistribution();
    const winLoss = this.analyzeWinLossFeatures();
    const emergency = this.analyzeEmergencyStops();

    const report = {
      summary: {
        totalSignals: this.blockCounts.totalSignals,
        totalExecuted: this.blockCounts.totalExecuted,
        totalRejected: this.blockCounts.totalSignals - this.blockCounts.totalExecuted,
        filterRate: this.blockCounts.totalSignals > 0
          ? ((this.blockCounts.totalSignals - this.blockCounts.totalExecuted) / this.blockCounts.totalSignals * 100).toFixed(1) + '%'
          : 'N/A',
        systemValid: parseFloat(
          ((this.blockCounts.totalSignals - this.blockCounts.totalExecuted) / Math.max(1, this.blockCounts.totalSignals) * 100)
        ) <= 95,
      },
      blockingDominance: blocking,
      timeDistribution: timeDist,
      winLossComparison: winLoss,
      emergencyStopForensics: emergency,
      perAsset: this.assetTraces,
    };

    return report;
  }

  /**
   * Export full trace data to JSON
   */
  export() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const report = this.generateReport();

    // Write report
    const reportPath = path.join(this.outputDir, `trace-report-${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Write raw traces (for deep analysis)
    const tracesPath = path.join(this.outputDir, `signal-traces-${timestamp}.json`);
    fs.writeFileSync(tracesPath, JSON.stringify(this.traces, null, 2));

    // Write rejections
    const rejPath = path.join(this.outputDir, `rejections-${timestamp}.json`);
    fs.writeFileSync(rejPath, JSON.stringify(this.rejections, null, 2));

    console.log(`\n📁 Trace data exported to:`);
    console.log(`   ${reportPath}`);
    console.log(`   ${tracesPath}`);
    console.log(`   ${rejPath}`);

    return report;
  }

  /**
   * Print human-readable report
   */
  printReport() {
    const report = this.generateReport();

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   🔬 SIGNAL TRACE ANALYSIS                          ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // Summary
    const s = report.summary;
    console.log('── Summary ─────────────────────────────────────────');
    console.log(`  Total signals:     ${s.totalSignals}`);
    console.log(`  Executed:          ${s.totalExecuted}`);
    console.log(`  Rejected:          ${s.totalRejected}`);
    console.log(`  Filter rate:       ${s.filterRate}`);
    console.log(`  System valid:      ${s.systemValid ? '✅ YES' : '🚨 NO (>95% blocked)'}`);

    // Blocking dominance
    console.log('\n── Blocking Dominance ──────────────────────────────');
    if (report.blockingDominance.dominance) {
      for (const [gate, data] of Object.entries(report.blockingDominance.dominance)) {
        const bar = '█'.repeat(Math.min(30, Math.round(parseFloat(data.percentOfTotal) / 2)));
        console.log(`  ${gate.padEnd(25)} ${String(data.count).padStart(6)} (${data.percentOfTotal}%) ${bar}`);
      }
    }

    // Time distribution
    console.log('\n── Time Distribution ──────────────────────────────');
    console.log(`  Valid: ${report.timeDistribution.valid ? '✅' : '🚨 ' + report.timeDistribution.concentration}`);
    console.log(`  Years: ${report.timeDistribution.years?.join(', ') || 'none'}`);
    if (report.timeDistribution.gaps?.length > 0) {
      console.log(`  ⚠️  Gaps: ${report.timeDistribution.gaps.join(', ')}`);
    }
    if (report.timeDistribution.byYear) {
      for (const [year, count] of Object.entries(report.timeDistribution.byYear).sort()) {
        console.log(`    ${year}: ${count} trades`);
      }
    }

    // Win/Loss comparison
    console.log('\n── Win vs Loss Feature Distribution ───────────────');
    console.log(`  Wins: ${report.winLossComparison.wins} | Losses: ${report.winLossComparison.losses}`);
    if (report.winLossComparison.comparison) {
      for (const [feat, data] of Object.entries(report.winLossComparison.comparison)) {
        console.log(`  ${feat}:`);
        console.log(`    Win mean: ${data.winMean} | Loss mean: ${data.lossMean} | Δ: ${data.divergence}`);
      }
    }

    // Emergency stops
    console.log('\n── Emergency Stop Forensics ────────────────────────');
    const em = report.emergencyStopForensics;
    console.log(`  Stops: ${em.count} | Total loss: $${em.totalLoss.toFixed(2)} | Avg: $${em.avgLoss.toFixed(2)}`);
    if (em.details) {
      for (const d of em.details) {
        const date = d.timestamp ? new Date(d.timestamp).toISOString().slice(0, 10) : '?';
        console.log(`    ${date} ${d.symbol} ${d.regime} ${d.signalType} PnL=$${d.pnl.toFixed(2)} ATR=${d.atr?.toFixed(4)}`);
      }
    }

    // Per-asset
    console.log('\n── Per-Asset Trace Summary ────────────────────────');
    for (const [asset, data] of Object.entries(report.perAsset)) {
      console.log(`  ${asset}: ${data.signals} signals, ${data.accepted} accepted, ${data.rejected} rejected`);
      if (Object.keys(data.rejections).length > 0) {
        for (const [cat, count] of Object.entries(data.rejections)) {
          console.log(`    ${cat}: ${count}`);
        }
      }
    }

    return report;
  }

  _groupBy(arr, key) {
    const result = {};
    for (const item of arr) {
      const k = item[key] || 'unknown';
      if (!result[k]) result[k] = { count: 0, pnl: 0, items: [] };
      result[k].count++;
      result[k].pnl += (item.pnl || 0);
      result[k].items.push(item);
    }
    return result;
  }
}
