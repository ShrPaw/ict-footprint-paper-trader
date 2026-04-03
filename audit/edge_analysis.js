// ═══════════════════════════════════════════════════════════════════
// edge_analysis.js — Statistical Edge Discovery
// ═══════════════════════════════════════════════════════════════════
//
// PURPOSE: Analyze signal dataset to discover real edge.
// Answers:
//   1. Which conditions generate real edge?
//   2. Which conditions destroy the system?
//   3. Which features are misleading?
//
// INPUT: data/signal-dataset-*.jsonl + data/trade-outcomes-*.json
// OUTPUT: Console report + data/edge-report-*.md
//
// USAGE:
//   node audit/edge_analysis.js --signals data/signal-dataset-XXX.jsonl --trades data/trade-outcomes-XXX.json

import fs from 'fs';
import path from 'path';

class EdgeAnalyzer {
  constructor(signalsPath, tradesPath) {
    this.signals = [];
    this.trades = [];

    // Load signal log
    if (fs.existsSync(signalsPath)) {
      const lines = fs.readFileSync(signalsPath, 'utf8').trim().split('\n');
      this.signals = lines.map(l => JSON.parse(l));
      console.log(`📥 Loaded ${this.signals.length} signal evaluations`);
    }

    // Load trades
    if (fs.existsSync(tradesPath)) {
      this.trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
      console.log(`📥 Loaded ${this.trades.length} trade outcomes`);
    }
  }

  analyze() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   🔬 EDGE ANALYSIS — Signal → Outcome Correlation    ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    const report = [];

    // ═══════════════════════════════════════════════════════════════
    // 1. SIGNAL FUNNEL ANALYSIS
    // ═══════════════════════════════════════════════════════════════
    report.push(this._analyzeFunnel());

    // ═══════════════════════════════════════════════════════════════
    // 2. PROFITABLE CONDITIONS ANALYSIS
    // ═══════════════════════════════════════════════════════════════
    report.push(this._analyzeProfitableConditions());

    // ═══════════════════════════════════════════════════════════════
    // 3. LOSS CLUSTER ANALYSIS (emergency stops focus)
    // ═══════════════════════════════════════════════════════════════
    report.push(this._analyzeLossClusters());

    // ═══════════════════════════════════════════════════════════════
    // 4. FALSE SIGNAL ANALYSIS
    // ═══════════════════════════════════════════════════════════════
    report.push(this._analyzeFalseSignals());

    // ═══════════════════════════════════════════════════════════════
    // 5. FEATURE CORRELATION ANALYSIS
    // ═══════════════════════════════════════════════════════════════
    report.push(this._analyzeFeatureCorrelations());

    // ═══════════════════════════════════════════════════════════════
    // 6. REGIME × SIGNAL TYPE MATRIX
    // ═══════════════════════════════════════════════════════════════
    report.push(this._analyzeRegimeSignalMatrix());

    // ═══════════════════════════════════════════════════════════════
    // 7. DURATION ANALYSIS
    // ═══════════════════════════════════════════════════════════════
    report.push(this._analyzeDuration());

    // ═══════════════════════════════════════════════════════════════
    // 8. FINAL VERDICT
    // ═══════════════════════════════════════════════════════════════
    report.push(this._generateVerdict());

    // Export report
    this._exportReport(report.join('\n'));
  }

  _analyzeFunnel() {
    console.log('\n━━━ 1. SIGNAL FUNNEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const lines = [];

    const decisions = {};
    for (const s of this.signals) {
      decisions[s.decision] = (decisions[s.decision] || 0) + 1;
    }

    lines.push('## 1. Signal Funnel\n');
    lines.push('| Stage | Count | % of Total |');
    lines.push('|-------|-------|------------|');

    const total = this.signals.length;
    for (const [dec, count] of Object.entries(decisions).sort((a, b) => b[1] - a[1])) {
      const pct = (count / total * 100).toFixed(1);
      lines.push(`| ${dec} | ${count} | ${pct}% |`);
      console.log(`  ${dec.padEnd(30)} ${String(count).padStart(6)} (${pct}%)`);
    }

    // Accepted signals
    const accepted = decisions['SIGNAL_GENERATED'] || 0;
    const opened = decisions['TRADE_OPENED'] || 0;
    const filtered = accepted - opened;
    console.log(`\n  Signal → Trade conversion: ${opened}/${accepted} (${accepted > 0 ? (opened/accepted*100).toFixed(0) : 0}%)`);

    lines.push(`\nSignal → Trade conversion: ${opened}/${accepted}`);
    lines.push('');

    return lines.join('\n');
  }

  _analyzeProfitableConditions() {
    console.log('\n━━━ 2. PROFITABLE CONDITIONS ━━━━━━━━━━━━━━━━━━');
    const lines = [];
    lines.push('## 2. Profitable Conditions (PF > 1.2)\n');

    // Build signal lookup by timestamp
    const signalByTime = {};
    for (const s of this.signals) {
      if (s.decision === 'TRADE_OPENED') {
        signalByTime[s.timestamp] = s;
      }
    }

    // ── By Regime ──────────────────────────────────────────────
    console.log('\n  ── By Regime ──');
    lines.push('### By Regime\n');
    lines.push('| Regime | Trades | WR | PnL | PF | Avg Win | Avg Loss |');
    lines.push('|--------|--------|----|----|----|---------|----------|');

    const byRegime = this._groupBy(this.trades, 'regime');
    for (const [regime, trades] of Object.entries(byRegime).sort((a, b) => this._pnl(b[1]) - this._pnl(a[1]))) {
      const stats = this._tradeStats(trades);
      const line = `| ${regime} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} | ${stats.pf} | $${stats.avgWin.toFixed(2)} | $${stats.avgLoss.toFixed(2)} |`;
      lines.push(line);
      console.log(`  ${regime.padEnd(16)} ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)} | PF ${stats.pf}`);
    }

    // ── By Signal Type ─────────────────────────────────────────
    console.log('\n  ── By Signal Type ──');
    lines.push('\n### By Signal Type\n');
    lines.push('| Signal Type | Trades | WR | PnL | PF |');
    lines.push('|-------------|--------|----|----|----|');

    const bySignal = this._groupBy(this.trades, 'signalType');
    for (const [type, trades] of Object.entries(bySignal).sort((a, b) => this._pnl(b[1]) - this._pnl(a[1]))) {
      const stats = this._tradeStats(trades);
      const line = `| ${type || 'unknown'} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} | ${stats.pf} |`;
      lines.push(line);
      console.log(`  ${(type || 'unknown').padEnd(24)} ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)} | PF ${stats.pf}`);
    }

    // ── By Regime × Signal Type ────────────────────────────────
    console.log('\n  ── By Regime × Signal Type ──');
    lines.push('\n### Regime × Signal Type Matrix\n');
    lines.push('| Regime | Signal Type | Trades | WR | PnL |');
    lines.push('|--------|-------------|--------|----|----|');

    const matrix = {};
    for (const t of this.trades) {
      const key = `${t.regime}|${t.signalType || 'unknown'}`;
      if (!matrix[key]) matrix[key] = [];
      matrix[key].push(t);
    }

    for (const [key, trades] of Object.entries(matrix).sort((a, b) => this._pnl(b[1]) - this._pnl(a[1]))) {
      const stats = this._tradeStats(trades);
      const [regime, type] = key.split('|');
      const line = `| ${regime} | ${type} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} |`;
      lines.push(line);
      if (stats.count >= 3) { // Only show meaningful combos
        console.log(`  ${regime.padEnd(16)} ${(type||'').padEnd(24)} ${String(stats.count).padStart(3)} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)}`);
      }
    }

    // ── Feature bins for executed trades ───────────────────────
    console.log('\n  ── Stacked Count Distribution (executed trades) ──');
    lines.push('\n### Stacked Count vs Outcome\n');
    lines.push('| Stacked | Trades | WR | PnL | Emergency Stops |');
    lines.push('|---------|--------|----|----|----------------|');

    const withFeatures = this.trades.map(t => ({
      ...t,
      signal: signalByTime[t.entryTime] || signalByTime[Object.keys(signalByTime).find(k => Math.abs(parseInt(k) - t.entryTime) < 900000)]
    })).filter(t => t.signal?.features);

    const byStacked = {};
    for (const t of withFeatures) {
      const sc = t.signal.features.stackedCount;
      const bucket = sc >= 6 ? '6+' : String(sc);
      if (!byStacked[bucket]) byStacked[bucket] = [];
      byStacked[bucket].push(t);
    }

    for (const [bucket, trades] of Object.entries(byStacked).sort()) {
      const stats = this._tradeStats(trades);
      const emergency = trades.filter(t => t.closeReason === 'emergency_stop').length;
      const line = `| ${bucket} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} | ${emergency} |`;
      lines.push(line);
      console.log(`  stacked=${bucket.padEnd(4)} ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)} | ${emergency} emergency`);
    }

    // ── ATR-z distribution ─────────────────────────────────────
    console.log('\n  ── ATR-z at Entry vs Outcome ──');
    lines.push('\n### ATR-z at Entry vs Outcome\n');
    lines.push('| ATR-z Range | Trades | WR | PnL | Emergency Stops |');
    lines.push('|-------------|--------|----|----|----------------|');

    const byATRz = {};
    for (const t of withFeatures) {
      const az = t.signal.features.atrZ;
      const bucket = az < 0 ? '<0' : az < 0.5 ? '0-0.5' : az < 1.0 ? '0.5-1.0' : az < 1.5 ? '1.0-1.5' : '1.5+';
      if (!byATRz[bucket]) byATRz[bucket] = [];
      byATRz[bucket].push(t);
    }

    for (const [bucket, trades] of Object.entries(byATRz).sort()) {
      const stats = this._tradeStats(trades);
      const emergency = trades.filter(t => t.closeReason === 'emergency_stop').length;
      const line = `| ${bucket} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} | ${emergency} |`;
      lines.push(line);
      console.log(`  ATR-z ${bucket.padEnd(8)} ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)} | ${emergency} emergency`);
    }

    // ── Dist from Mean distribution ────────────────────────────
    console.log('\n  ── Dist from Mean at Entry vs Outcome ──');
    lines.push('\n### Distance from Mean at Entry vs Outcome\n');
    lines.push('| Dist (ATR) | Trades | WR | PnL | Emergency Stops |');
    lines.push('|------------|--------|----|----|----------------|');

    const byDist = {};
    for (const t of withFeatures) {
      const d = t.signal.features.distFromMean;
      const bucket = d < 0.5 ? '<0.5' : d < 1.0 ? '0.5-1.0' : d < 1.5 ? '1.0-1.5' : '1.5+';
      if (!byDist[bucket]) byDist[bucket] = [];
      byDist[bucket].push(t);
    }

    for (const [bucket, trades] of Object.entries(byDist).sort()) {
      const stats = this._tradeStats(trades);
      const emergency = trades.filter(t => t.closeReason === 'emergency_stop').length;
      const line = `| ${bucket} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} | ${emergency} |`;
      lines.push(line);
      console.log(`  dist ${bucket.padEnd(8)} ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)} | ${emergency} emergency`);
    }

    // ── Momentum distribution ──────────────────────────────────
    console.log('\n  ── Momentum at Entry vs Outcome ──');
    lines.push('\n### Momentum at Entry vs Outcome\n');
    lines.push('| Momentum | Trades | WR | PnL |');
    lines.push('|----------|--------|----|----|');

    const byMom = {};
    for (const t of withFeatures) {
      const m = Math.abs(t.signal.features.momentum);
      const bucket = m < 0.002 ? 'weak (<0.2%)' : m < 0.005 ? 'moderate (0.2-0.5%)' : 'strong (>0.5%)';
      if (!byMom[bucket]) byMom[bucket] = [];
      byMom[bucket].push(t);
    }

    for (const [bucket, trades] of Object.entries(byMom).sort()) {
      const stats = this._tradeStats(trades);
      const line = `| ${bucket} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} |`;
      lines.push(line);
      console.log(`  ${bucket.padEnd(24)} ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  _analyzeLossClusters() {
    console.log('\n━━━ 3. LOSS CLUSTERS (Emergency Stops) ━━━━━━━━');
    const lines = [];
    lines.push('## 3. Loss Clusters — Emergency Stop Analysis\n');

    const emergencyTrades = this.trades.filter(t => t.closeReason === 'emergency_stop');
    const otherLosses = this.trades.filter(t => t.pnl <= 0 && t.closeReason !== 'emergency_stop');

    console.log(`  Emergency stops: ${emergencyTrades.length} trades`);
    console.log(`  Other losses:    ${otherLosses.length} trades`);

    lines.push(`Emergency stops: ${emergencyTrades.length} trades`);
    lines.push(`Other losses: ${otherLosses.length} trades\n`);

    if (emergencyTrades.length === 0) {
      console.log('  ✅ No emergency stops — system not tested under pressure');
      lines.push('No emergency stops found.\n');
      return lines.join('\n');
    }

    const totalEmergencyLoss = emergencyTrades.reduce((s, t) => s + t.pnl, 0);
    const avgEmergencyLoss = totalEmergencyLoss / emergencyTrades.length;
    console.log(`  Total emergency loss: $${totalEmergencyLoss.toFixed(2)}`);
    console.log(`  Avg emergency loss:   $${avgEmergencyLoss.toFixed(2)}`);

    lines.push(`Total emergency loss: $${totalEmergencyLoss.toFixed(2)}`);
    lines.push(`Avg emergency loss: $${avgEmergencyLoss.toFixed(2)}\n`);

    // Get features for emergency stop trades
    const signalByTime = {};
    for (const s of this.signals) {
      if (s.decision === 'TRADE_OPENED') {
        signalByTime[s.timestamp] = s;
      }
    }

    const emergencyWithFeatures = emergencyTrades.map(t => {
      const signal = signalByTime[t.entryTime] ||
        signalByTime[Object.keys(signalByTime).find(k => Math.abs(parseInt(k) - t.entryTime) < 900000)];
      return { ...t, signal };
    }).filter(t => t.signal?.features);

    if (emergencyWithFeatures.length > 0) {
      // Feature profile of emergency stops
      const avgFeatures = {
        stackedCount: 0, atrZ: 0, distFromMean: 0, momentum: 0, volRatio: 0,
      };

      for (const t of emergencyWithFeatures) {
        avgFeatures.stackedCount += t.signal.features.stackedCount;
        avgFeatures.atrZ += t.signal.features.atrZ;
        avgFeatures.distFromMean += t.signal.features.distFromMean;
        avgFeatures.momentum += Math.abs(t.signal.features.momentum);
        avgFeatures.volRatio += t.signal.features.volRatio;
      }

      const n = emergencyWithFeatures.length;
      for (const k of Object.keys(avgFeatures)) avgFeatures[k] /= n;

      console.log('\n  ── Average Feature Profile at Entry (Emergency Stops) ──');
      console.log(`    Stacked count:   ${avgFeatures.stackedCount.toFixed(1)}`);
      console.log(`    ATR-z:           ${avgFeatures.atrZ.toFixed(3)}`);
      console.log(`    Dist from mean:  ${avgFeatures.distFromMean.toFixed(3)} ATR`);
      console.log(`    Momentum:        ${(avgFeatures.momentum * 100).toFixed(3)}%`);
      console.log(`    Vol ratio:       ${avgFeatures.volRatio.toFixed(2)}x`);

      lines.push('### Average Features at Entry (Emergency Stops)\n');
      lines.push('| Feature | Avg Value |');
      lines.push('|---------|-----------|');
      lines.push(`| Stacked Count | ${avgFeatures.stackedCount.toFixed(1)} |`);
      lines.push(`| ATR-z | ${avgFeatures.atrZ.toFixed(3)} |`);
      lines.push(`| Dist from Mean (ATR) | ${avgFeatures.distFromMean.toFixed(3)} |`);
      lines.push(`| Momentum | ${(avgFeatures.momentum * 100).toFixed(3)}% |`);
      lines.push(`| Volume Ratio | ${avgFeatures.volRatio.toFixed(2)}x |`);

      // Compare with winning trades
      const winningTrades = this.trades.filter(t => t.pnl > 0);
      const winWithFeatures = winningTrades.map(t => {
        const signal = signalByTime[t.entryTime] ||
          signalByTime[Object.keys(signalByTime).find(k => Math.abs(parseInt(k) - t.entryTime) < 900000)];
        return { ...t, signal };
      }).filter(t => t.signal?.features);

      if (winWithFeatures.length > 0) {
        const winAvg = { stackedCount: 0, atrZ: 0, distFromMean: 0, momentum: 0, volRatio: 0 };
        for (const t of winWithFeatures) {
          winAvg.stackedCount += t.signal.features.stackedCount;
          winAvg.atrZ += t.signal.features.atrZ;
          winAvg.distFromMean += t.signal.features.distFromMean;
          winAvg.momentum += Math.abs(t.signal.features.momentum);
          winAvg.volRatio += t.signal.features.volRatio;
        }
        const wn = winWithFeatures.length;
        for (const k of Object.keys(winAvg)) winAvg[k] /= wn;

        console.log('\n  ── Comparison: Emergency vs Winners ──');
        console.log(`    Feature         | Emergency | Winner   | Delta`);
        console.log(`    ────────────────┼───────────┼──────────┼──────────`);
        console.log(`    Stacked         | ${avgFeatures.stackedCount.toFixed(1).padStart(9)} | ${winAvg.stackedCount.toFixed(1).padStart(8)} | ${(avgFeatures.stackedCount - winAvg.stackedCount).toFixed(1).padStart(9)}`);
        console.log(`    ATR-z           | ${avgFeatures.atrZ.toFixed(3).padStart(9)} | ${winAvg.atrZ.toFixed(3).padStart(8)} | ${(avgFeatures.atrZ - winAvg.atrZ).toFixed(3).padStart(9)}`);
        console.log(`    Dist (ATR)      | ${avgFeatures.distFromMean.toFixed(3).padStart(9)} | ${winAvg.distFromMean.toFixed(3).padStart(8)} | ${(avgFeatures.distFromMean - winAvg.distFromMean).toFixed(3).padStart(9)}`);
        console.log(`    Momentum        | ${(avgFeatures.momentum*100).toFixed(3).padStart(8)}% | ${(winAvg.momentum*100).toFixed(3).padStart(7)}% | ${((avgFeatures.momentum-winAvg.momentum)*100).toFixed(3).padStart(8)}%`);

        lines.push('\n### Emergency Stops vs Winners — Feature Comparison\n');
        lines.push('| Feature | Emergency Avg | Winner Avg | Delta |');
        lines.push('|---------|--------------|------------|-------|');
        lines.push(`| Stacked Count | ${avgFeatures.stackedCount.toFixed(1)} | ${winAvg.stackedCount.toFixed(1)} | ${(avgFeatures.stackedCount - winAvg.stackedCount).toFixed(1)} |`);
        lines.push(`| ATR-z | ${avgFeatures.atrZ.toFixed(3)} | ${winAvg.atrZ.toFixed(3)} | ${(avgFeatures.atrZ - winAvg.atrZ).toFixed(3)} |`);
        lines.push(`| Dist from Mean | ${avgFeatures.distFromMean.toFixed(3)} | ${winAvg.distFromMean.toFixed(3)} | ${(avgFeatures.distFromMean - winAvg.distFromMean).toFixed(3)} |`);
        lines.push(`| Momentum | ${(avgFeatures.momentum*100).toFixed(3)}% | ${(winAvg.momentum*100).toFixed(3)}% | ${((avgFeatures.momentum-winAvg.momentum)*100).toFixed(3)}% |`);
        lines.push(`| Vol Ratio | ${avgFeatures.volRatio.toFixed(2)}x | ${winAvg.volRatio.toFixed(2)}x | ${(avgFeatures.volRatio - winAvg.volRatio).toFixed(2)}x |`);
      }

      // Context state of emergency stops
      console.log('\n  ── Context State Distribution (Emergency Stops) ──');
      const ctxDist = {};
      for (const t of emergencyWithFeatures) {
        const flowCtx = t.signal.details?.flowCtx;
        if (!flowCtx) continue;
        const key = `${flowCtx.volatilityState}|${flowCtx.orderflowState}|${flowCtx.extensionState}`;
        ctxDist[key] = (ctxDist[key] || 0) + 1;
      }
      for (const [key, count] of Object.entries(ctxDist).sort((a, b) => b[1] - a[1])) {
        const [vol, flow, ext] = key.split('|');
        console.log(`    ${vol.padEnd(8)} vol | ${flow.padEnd(12)} flow | ${ext.padEnd(6)} ext → ${count} stops`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  _analyzeFalseSignals() {
    console.log('\n━━━ 4. FALSE SIGNAL ANALYSIS ━━━━━━━━━━━━━━━━━');
    const lines = [];
    lines.push('## 4. False Signals — Looks Valid, Consistently Loses\n');

    // Find signals that were generated (passed all gates) but lost
    const losingTrades = this.trades.filter(t => t.pnl <= 0);
    const winningTrades = this.trades.filter(t => t.pnl > 0);

    const signalByTime = {};
    for (const s of this.signals) {
      if (s.decision === 'TRADE_OPENED') signalByTime[s.timestamp] = s;
    }

    // Look at context states of losers vs winners
    const losingSignals = losingTrades.map(t => {
      return signalByTime[t.entryTime] || signalByTime[Object.keys(signalByTime).find(k => Math.abs(parseInt(k) - t.entryTime) < 900000)];
    }).filter(Boolean);

    const winningSignals = winningTrades.map(t => {
      return signalByTime[t.entryTime] || signalByTime[Object.keys(signalByTime).find(k => Math.abs(parseInt(k) - t.entryTime) < 900000)];
    }).filter(Boolean);

    // Orderflow state distribution: losers vs winners
    console.log('\n  ── Orderflow State: Losers vs Winners ──');
    lines.push('### Orderflow State Distribution\n');
    lines.push('| State | Losers | Winners | Loser % | Winner % | Edge |');
    lines.push('|-------|--------|---------|---------|----------|------|');

    const loserFlow = this._countBy(losingSignals, s => s.details?.flowCtx?.orderflowState || 'unknown');
    const winnerFlow = this._countBy(winningSignals, s => s.details?.flowCtx?.orderflowState || 'unknown');

    const allStates = new Set([...Object.keys(loserFlow), ...Object.keys(winnerFlow)]);
    for (const state of allStates) {
      const l = loserFlow[state] || 0;
      const w = winnerFlow[state] || 0;
      const lPct = losingSignals.length > 0 ? (l / losingSignals.length * 100).toFixed(0) : '0';
      const wPct = winningSignals.length > 0 ? (w / winningSignals.length * 100).toFixed(0) : '0';
      const edge = l > w ? '🔴' : w > l ? '🟢' : '⚪';
      const line = `| ${state} | ${l} | ${w} | ${lPct}% | ${wPct}% | ${edge} |`;
      lines.push(line);
      console.log(`  ${state.padEnd(12)} ${edge} Losers: ${l} (${lPct}%) | Winners: ${w} (${wPct}%)`);
    }

    // Volatility state: losers vs winners
    console.log('\n  ── Volatility State: Losers vs Winners ──');
    lines.push('\n### Volatility State Distribution\n');
    lines.push('| State | Losers | Winners | Edge |');
    lines.push('|-------|--------|---------|------|');

    const loserVol = this._countBy(losingSignals, s => s.details?.flowCtx?.volatilityState || 'unknown');
    const winnerVol = this._countBy(winningSignals, s => s.details?.flowCtx?.volatilityState || 'unknown');

    const allVol = new Set([...Object.keys(loserVol), ...Object.keys(winnerVol)]);
    for (const state of allVol) {
      const l = loserVol[state] || 0;
      const w = winnerVol[state] || 0;
      const edge = l > w ? '🔴' : w > l ? '🟢' : '⚪';
      const line = `| ${state} | ${l} | ${w} | ${edge} |`;
      lines.push(line);
      console.log(`  ${state.padEnd(8)} ${edge} Losers: ${l} | Winners: ${w}`);
    }

    // Signal type: losers vs winners
    console.log('\n  ── Signal Type: Losers vs Winners ──');
    lines.push('\n### Signal Type Distribution\n');
    lines.push('| Signal Type | Losers | Winners | L WR | W WR |');
    lines.push('|-------------|--------|---------|------|------|');

    const loserSig = this._countBy(losingSignals, s => s.details?.signalType || 'unknown');
    const winnerSig = this._countBy(winningSignals, s => s.details?.signalType || 'unknown');

    const allSig = new Set([...Object.keys(loserSig), ...Object.keys(winnerSig)]);
    for (const type of allSig) {
      const l = loserSig[type] || 0;
      const w = winnerSig[type] || 0;
      const line = `| ${type} | ${l} | ${w} | - | - |`;
      lines.push(line);
      console.log(`  ${(type || 'unknown').padEnd(24)} Losers: ${l} | Winners: ${w}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  _analyzeFeatureCorrelations() {
    console.log('\n━━━ 5. FEATURE CORRELATIONS ━━━━━━━━━━━━━━━━━━');
    const lines = [];
    lines.push('## 5. Feature Correlations with Outcome\n');

    const signalByTime = {};
    for (const s of this.signals) {
      if (s.decision === 'TRADE_OPENED') signalByTime[s.timestamp] = s;
    }

    const withFeatures = this.trades.map(t => {
      const signal = signalByTime[t.entryTime] ||
        signalByTime[Object.keys(signalByTime).find(k => Math.abs(parseInt(k) - t.entryTime) < 900000)];
      return { ...t, signal };
    }).filter(t => t.signal?.features);

    if (withFeatures.length < 10) {
      console.log('  ⚠️  Too few trades with features for correlation analysis');
      lines.push('Too few trades with features for correlation analysis.\n');
      return lines.join('\n');
    }

    // Compute correlations between features and PnL
    const features = ['stackedCount', 'atrZ', 'distFromMean', 'momentum', 'volRatio', 'currentDelta'];
    const correlations = {};

    for (const feat of features) {
      const x = withFeatures.map(t => {
        const v = t.signal.features[feat];
        return feat === 'momentum' ? Math.abs(v) : Math.abs(v || 0);
      });
      const y = withFeatures.map(t => t.pnl);

      correlations[feat] = this._pearsonCorrelation(x, y);
    }

    console.log('\n  ── Pearson Correlation: Feature → PnL ──');
    lines.push('### Pearson Correlation: Feature → PnL\n');
    lines.push('| Feature | Correlation | Interpretation |');
    lines.push('|---------|-------------|----------------|');

    for (const [feat, corr] of Object.entries(correlations).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
      const interp = Math.abs(corr) < 0.1 ? 'no relationship' :
                     Math.abs(corr) < 0.3 ? 'weak' :
                     Math.abs(corr) < 0.5 ? 'moderate' : 'strong';
      const dir = corr > 0 ? 'positive' : 'negative';
      const line = `| ${feat} | ${corr.toFixed(3)} | ${interp} ${dir} |`;
      lines.push(line);
      console.log(`  ${feat.padEnd(16)} r = ${corr.toFixed(3).padStart(7)} (${interp} ${dir})`);
    }

    // Binary split analysis: above/below median for each feature
    console.log('\n  ── Binary Split: Above vs Below Median ──');
    lines.push('\n### Binary Split Analysis\n');
    lines.push('| Feature | Below Med WR | Above Med WR | Below Med PnL | Above Med PnL | Edge Side |');
    lines.push('|---------|-------------|-------------|--------------|--------------|-----------|');

    for (const feat of features) {
      const vals = withFeatures.map(t => {
        const v = t.signal.features[feat];
        return feat === 'momentum' ? Math.abs(v) : Math.abs(v || 0);
      }).sort((a, b) => a - b);

      const median = vals[Math.floor(vals.length / 2)];

      const below = withFeatures.filter(t => {
        const v = t.signal.features[feat];
        return (feat === 'momentum' ? Math.abs(v) : Math.abs(v || 0)) < median;
      });
      const above = withFeatures.filter(t => {
        const v = t.signal.features[feat];
        return (feat === 'momentum' ? Math.abs(v) : Math.abs(v || 0)) >= median;
      });

      const belowStats = this._tradeStats(below);
      const aboveStats = this._tradeStats(above);

      const edgeSide = aboveStats.pnl > belowStats.pnl ? 'Above' :
                       belowStats.pnl > aboveStats.pnl ? 'Below' : 'Equal';

      const line = `| ${feat} | ${belowStats.wr}% | ${aboveStats.wr}% | $${belowStats.pnl.toFixed(0)} | $${aboveStats.pnl.toFixed(0)} | ${edgeSide} |`;
      lines.push(line);
      console.log(`  ${feat.padEnd(16)} Below: ${belowStats.wr}% WR / $${belowStats.pnl.toFixed(0)} | Above: ${aboveStats.wr}% WR / $${aboveStats.pnl.toFixed(0)} → Edge: ${edgeSide}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  _analyzeRegimeSignalMatrix() {
    console.log('\n━━━ 6. REGIME × SIGNAL TYPE MATRIX ━━━━━━━━━━━');
    const lines = [];
    lines.push('## 6. Regime × Signal Type — Full Matrix\n');

    // Already covered in section 2, but add session × regime
    const bySession = {};
    for (const t of this.trades) {
      const session = t.session || 'unknown';
      if (!bySession[session]) bySession[session] = {};
      if (!bySession[session][t.regime]) bySession[session][t.regime] = [];
      bySession[session][t.regime].push(t);
    }

    console.log('\n  ── Session × Regime ──');
    lines.push('### Session × Regime\n');
    lines.push('| Session | Regime | Trades | WR | PnL |');
    lines.push('|---------|--------|--------|----|----|');

    for (const [session, regimes] of Object.entries(bySession).sort()) {
      for (const [regime, trades] of Object.entries(regimes).sort((a, b) => this._pnl(b[1]) - this._pnl(a[1]))) {
        const stats = this._tradeStats(trades);
        const line = `| ${session} | ${regime} | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} |`;
        lines.push(line);
        console.log(`  ${session.padEnd(10)} ${regime.padEnd(16)} ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  _analyzeDuration() {
    console.log('\n━━━ 7. DURATION ANALYSIS ━━━━━━━━━━━━━━━━━━━━━');
    const lines = [];
    lines.push('## 7. Duration Analysis\n');

    const winners = this.trades.filter(t => t.pnl > 0);
    const losers = this.trades.filter(t => t.pnl <= 0);
    const emergencyStops = this.trades.filter(t => t.closeReason === 'emergency_stop');

    if (winners.length > 0) {
      const winDurations = winners.map(t => t.durationMin).sort((a, b) => a - b);
      const avgWinDuration = winDurations.reduce((a, b) => a + b, 0) / winDurations.length;
      const medianWinDuration = winDurations[Math.floor(winDurations.length / 2)];
      const maxWinDuration = Math.max(...winDurations);

      console.log(`  Winners: avg ${avgWinDuration.toFixed(0)}min | median ${medianWinDuration}min | max ${maxWinDuration}min`);
      lines.push(`**Winners:** avg ${avgWinDuration.toFixed(0)}min | median ${medianWinDuration}min | max ${maxWinDuration}min\n`);
    }

    if (losers.length > 0) {
      const lossDurations = losers.map(t => t.durationMin).sort((a, b) => a - b);
      const avgLossDuration = lossDurations.reduce((a, b) => a + b, 0) / lossDurations.length;
      const medianLossDuration = lossDurations[Math.floor(lossDurations.length / 2)];
      const maxLossDuration = Math.max(...lossDurations);

      console.log(`  Losers:  avg ${avgLossDuration.toFixed(0)}min | median ${medianLossDuration}min | max ${maxLossDuration}min`);
      lines.push(`**Losers:** avg ${avgLossDuration.toFixed(0)}min | median ${medianLossDuration}min | max ${maxLossDuration}min\n`);
    }

    if (emergencyStops.length > 0) {
      const esDurations = emergencyStops.map(t => t.durationMin).sort((a, b) => a - b);
      const avgES = esDurations.reduce((a, b) => a + b, 0) / esDurations.length;
      console.log(`  Emergency: avg ${avgES.toFixed(0)}min | min ${esDurations[0]}min | max ${esDurations[esDurations.length-1]}min`);
      lines.push(`**Emergency stops:** avg ${avgES.toFixed(0)}min | min ${esDurations[0]}min | max ${esDurations[esDurations.length-1]}min\n`);
    }

    // Duration threshold analysis
    if (winners.length > 0 && losers.length > 0) {
      const allDurations = this.trades.map(t => t.durationMin).sort((a, b) => a - b);
      const thresholds = [60, 120, 240, 480, 720]; // 1h, 2h, 4h, 8h, 12h

      console.log('\n  ── Win Rate by Duration Threshold ──');
      lines.push('### Win Rate by Duration\n');
      lines.push('| Duration | Trades | WR | PnL |');
      lines.push('|----------|--------|----|----|');

      for (const thresh of thresholds) {
        const under = this.trades.filter(t => t.durationMin <= thresh);
        const over = this.trades.filter(t => t.durationMin > thresh);
        if (under.length > 0) {
          const stats = this._tradeStats(under);
          const line = `| ≤${thresh}min | ${stats.count} | ${stats.wr}% | $${stats.pnl.toFixed(2)} |`;
          lines.push(line);
          console.log(`  ≤${String(thresh).padStart(4)}min: ${stats.count} trades | ${stats.wr}% WR | $${stats.pnl.toFixed(2).padStart(10)}`);
        }
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  _generateVerdict() {
    console.log('\n━━━ 8. VERDICT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const lines = [];
    lines.push('## 8. Edge Discovery Verdict\n');

    const totalPnL = this.trades.reduce((s, t) => s + t.pnl, 0);
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    const emergencyStops = this.trades.filter(t => t.closeReason === 'emergency_stop');
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    // Find which regime/signal combos have PF > 1.2
    const edges = [];
    const matrix = {};
    for (const t of this.trades) {
      const key = `${t.regime}|${t.signalType || 'unknown'}`;
      if (!matrix[key]) matrix[key] = [];
      matrix[key].push(t);
    }

    for (const [key, trades] of Object.entries(matrix)) {
      const stats = this._tradeStats(trades);
      if (stats.pf !== '∞' && parseFloat(stats.pf) >= 1.2 && stats.count >= 5) {
        edges.push({ key, ...stats });
      }
    }

    lines.push(`**Total trades:** ${this.trades.length}`);
    lines.push(`**Total PnL:** $${totalPnL.toFixed(2)}`);
    lines.push(`**Profit Factor:** ${pf === Infinity ? '∞' : pf.toFixed(2)}`);
    lines.push(`**Win Rate:** ${(wins.length / this.trades.length * 100).toFixed(1)}%`);
    lines.push(`**Emergency stops:** ${emergencyStops.length} ($${emergencyStops.reduce((s, t) => s + t.pnl, 0).toFixed(2)})\n`);

    console.log(`\n  Total: ${this.trades.length} trades | $${totalPnL.toFixed(2)} | PF ${pf === Infinity ? '∞' : pf.toFixed(2)} | ${emergencyStops.length} emergency stops`);

    if (edges.length > 0) {
      console.log('\n  ✅ EDGES FOUND (PF ≥ 1.2, n ≥ 5):');
      lines.push('### Edges Found (PF ≥ 1.2, n ≥ 5)\n');
      for (const e of edges.sort((a, b) => parseFloat(b.pf) - parseFloat(a.pf))) {
        const [regime, type] = e.key.split('|');
        console.log(`    ✅ ${regime} + ${type}: PF ${e.pf} | ${e.count} trades | ${e.wr}% WR | $${e.pnl.toFixed(2)}`);
        lines.push(`- **${regime} + ${type}:** PF ${e.pf} | ${e.count} trades | ${e.wr}% WR | $${e.pnl.toFixed(2)}`);
      }
    } else {
      console.log('\n  ❌ NO EDGES FOUND with PF ≥ 1.2 and n ≥ 5');
      lines.push('### ❌ No Edges Found\n');
      lines.push('No regime + signal type combination achieves PF ≥ 1.2 with n ≥ 5.\n');
    }

    // Misleading features
    console.log('\n  ── Feature Assessment ──');
    lines.push('\n### Feature Assessment\n');

    const verdicts = [];

    if (emergencyStops.length > wins.length * 0.3) {
      verdicts.push('🔴 **Stacked imbalance is misleading** — appears in more emergency stops than winners. The "momentum" interpretation is inverted.');
    }

    if (pf < 1.1) {
      verdicts.push('🔴 **No structural entry edge** — PF < 1.1 means the system is breakeven before fees. Exit management is the only edge.');
    }

    if (pf >= 1.1 && pf < 1.3) {
      verdicts.push('🟡 **Marginal edge** — PF 1.1-1.3. May exist but fragile. Needs regime-specific filtering to be tradeable.');
    }

    if (pf >= 1.3) {
      verdicts.push('🟢 **Real edge detected** — PF > 1.3. System has structural advantage in entry signals.');
    }

    // Duration verdict
    const winnerDurations = wins.map(t => t.durationMin);
    const loserDurations = losses.map(t => t.durationMin);
    if (winnerDurations.length > 0 && loserDurations.length > 0) {
      const avgWinDur = winnerDurations.reduce((a, b) => a + b, 0) / winnerDurations.length;
      const avgLossDur = loserDurations.reduce((a, b) => a + b, 0) / loserDurations.length;
      if (avgLossDur > avgWinDur * 2) {
        verdicts.push(`🔴 **Duration is a losing indicator** — losers hold ${avgLossDur.toFixed(0)}min vs winners ${avgWinDur.toFixed(0)}min. Stale trades are dead trades.`);
      }
    }

    for (const v of verdicts) {
      console.log(`    ${v}`);
      lines.push(v);
    }

    lines.push('');
    return lines.join('\n');
  }

  // ── Utility Methods ───────────────────────────────────────────

  _groupBy(arr, key) {
    const groups = {};
    for (const item of arr) {
      const k = item[key] || 'unknown';
      if (!groups[k]) groups[k] = [];
      groups[k].push(item);
    }
    return groups;
  }

  _countBy(arr, fn) {
    const counts = {};
    for (const item of arr) {
      const k = fn(item);
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }

  _tradeStats(trades) {
    if (trades.length === 0) return { count: 0, wins: 0, wr: '0.0', pnl: 0, pf: 'N/A', avgWin: 0, avgLoss: 0 };
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const pnl = trades.reduce((s, t) => s + t.pnl, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞';
    const wr = (wins.length / trades.length * 100).toFixed(1);
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    return { count: trades.length, wins: wins.length, wr, pnl, pf, avgWin, avgLoss };
  }

  _pnl(trades) {
    return trades.reduce((s, t) => s + t.pnl, 0);
  }

  _pearsonCorrelation(x, y) {
    const n = x.length;
    if (n < 3) return 0;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den > 0 ? num / den : 0;
  }

  _exportReport(report) {
    const outDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(outDir, `edge-report-${ts}.md`);
    fs.writeFileSync(reportPath, `# Edge Discovery Report\n\nGenerated: ${new Date().toISOString()}\n\n${report}`);
    console.log(`\n📁 Report exported: ${reportPath}`);
  }
}

// ── CLI ──
const args = process.argv.slice(2);
let signalsPath = null, tradesPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--signals' && args[i + 1]) signalsPath = args[++i];
  if (args[i] === '--trades' && args[i + 1]) tradesPath = args[++i];
}

// Auto-detect latest files if not specified
if (!signalsPath || !tradesPath) {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).sort().reverse();
    if (!signalsPath) signalsPath = files.find(f => f.startsWith('signal-dataset-') && f.endsWith('.jsonl'));
    if (!tradesPath) tradesPath = files.find(f => f.startsWith('trade-outcomes-') && f.endsWith('.json'));
    if (signalsPath) signalsPath = path.join(dataDir, signalsPath);
    if (tradesPath) tradesPath = path.join(dataDir, tradesPath);
  }
}

if (!signalsPath || !tradesPath) {
  console.error('Usage: node audit/edge_analysis.js --signals <path> --trades <path>');
  console.error('Or run signal_dataset.js first to generate data files.');
  process.exit(1);
}

const analyzer = new EdgeAnalyzer(signalsPath, tradesPath);
analyzer.analyze();
