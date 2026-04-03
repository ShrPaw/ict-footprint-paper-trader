// ═══════════════════════════════════════════════════════════════
// emergency_stop_forensics.js — WHY did each loss happen?
// ═══════════════════════════════════════════════════════════════
//
// For EACH emergency stop, we need to answer:
//   1. What regime was detected? Was it CORRECT?
//   2. What signal fired? What features drove the confidence?
//   3. What did price do AFTER entry? (the move that killed it)
//   4. Was there a warning sign at entry that we missed?
//   5. Would a tighter emergency stop have saved it?
//   6. What was the delta/order flow doing at entry?
//
// This is NOT about removing components.
// This is about UNDERSTANDING the failure mode so we can FIX it.

import ccxt from 'ccxt';
import config from '../config.js';
import { getProfile } from '../config/assetProfiles.js';
import {
  computeEMA, computeATR, computeADX, computeBollinger,
  computeDelta, computeVolumeMetrics,
  extractRegimes, extractFVGs, extractOrderBlocks,
  extractLiquiditySweeps, extractOTEs,
} from '../engine/Precompute.js';
import OrderFlowEngine from '../engine/OrderFlowEngine.js';
import ModelRouter from '../models/ModelRouter.js';

const SYMBOL = process.argv[2] || 'SOL/USDT:USDT';

async function main() {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║   🔬 EMERGENCY STOP FORENSICS — ${SYMBOL.padEnd(16)}      ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  const exchange = new ccxt.binance({ enableRateLimit: true });

  console.log('  Fetching data...');
  const candles15m = await fetchCandles(exchange, SYMBOL, '15m');
  const candles1h = await fetchCandles(exchange, SYMBOL, '1h');
  console.log(`  15m=${candles15m.length}, 1h=${candles1h.length}`);

  console.log('  Precomputing...');
  const indicators1h = {
    ema9: computeEMA(candles1h, 9),
    ema21: computeEMA(candles1h, 21),
    ema50: computeEMA(candles1h, 50),
    atr: computeATR(candles1h, config.regime.atrPeriod),
    adx: computeADX(candles1h, config.regime.adxPeriod),
    bollinger: computeBollinger(candles1h, 20, 2),
    volumeMetrics: computeVolumeMetrics(candles1h, 20),
  };
  const indicators15m = { delta: computeDelta(candles15m) };
  const regimes = extractRegimes(candles1h, indicators1h);
  const fvgSignals = extractFVGs(candles1h);
  const obSignals = extractOrderBlocks(candles1h);
  const sweepSignals = extractLiquiditySweeps(candles1h);
  const oteSignals = extractOTEs(candles1h);

  const modelRouter = new ModelRouter();
  const profile = getProfile(SYMBOL);

  // 15m→1h mapping
  const m15toH1 = new Array(candles15m.length);
  let hCursor = 0;
  for (let i = 0; i < candles15m.length; i++) {
    while (hCursor < candles1h.length - 1 && candles1h[hCursor + 1].timestamp <= candles15m[i].timestamp) hCursor++;
    m15toH1[i] = hCursor;
  }

  // Run simulation, capture EVERYTHING about emergency stops
  let balance = 10000;
  let position = null;
  const emergencyForensics = [];
  const allTrades = [];
  let lastSignalTime = 0;
  let dailyPnL = 0, dailyTradeCount = 0, lastResetDay = null;
  const peak = { value: 10000 };

  for (let i = 50; i < candles15m.length; i++) {
    const candle = candles15m[i];
    const ts = candle.timestamp;
    const h1Idx = m15toH1[i];
    const day = new Date(ts).toDateString();
    if (day !== lastResetDay) { dailyPnL = 0; dailyTradeCount = 0; lastResetDay = day; }

    if (position) {
      const exitResult = checkExitForensic(position, candle, ts, candles15m, i, indicators15m);
      if (exitResult) {
        allTrades.push(exitResult.trade);
        balance += exitResult.trade.pnl;
        dailyPnL += exitResult.trade.pnl;

        if (exitResult.trade.closeReason === 'emergency_stop') {
          // CAPTURE FULL FORENSIC CONTEXT
          emergencyForensics.push(exitResult.forensic);
        }
        position = null;
      }
    }

    if (!position && h1Idx >= 50) {
      const regimeData = regimes[h1Idx];
      if (!regimeData) continue;
      const regime = regimeData.regime;

      const kz = checkKillzone(ts);
      if (!kz.allowed) continue;
      if (profile.allowedSessions && !profile.allowedSessions.includes(kz.session)) continue;
      const dow = new Date(ts).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (profile.blockedRegimes?.includes(regime)) continue;

      const price = candles1h[h1Idx].close;
      const ema21 = indicators1h.ema21[h1Idx];
      const ema50 = indicators1h.ema50[h1Idx];
      const bullish = price > ema21 && price > ema50;
      const bearish = price < ema21 && price < ema50;
      if (!bullish && !bearish) continue;

      const cooldown = profile.daytrade.signalCooldown || config.strategy.signalCooldown;
      if (lastSignalTime && ts - lastSignalTime < cooldown) continue;

      const ctx = {
        symbol: SYMBOL, price, timestamp: ts, m15Idx: i, h1Idx,
        regime, regimeData, profile, killzone: kz,
        bullish, bearish,
        ema9: indicators1h.ema9[h1Idx], ema21, ema50,
        atr: indicators1h.atr[h1Idx],
        adx: indicators1h.adx[h1Idx],
        bb: { upper: indicators1h.bollinger.upper[h1Idx], middle: indicators1h.bollinger.middle[h1Idx], lower: indicators1h.bollinger.lower[h1Idx] },
        volumeRatio: indicators1h.volumeMetrics.volumeRatio[h1Idx],
        delta: indicators15m.delta.delta[i],
        deltaPercent: indicators15m.delta.deltaPercent[i],
        _allDeltas: indicators15m.delta.delta,
        _allPrices: candles15m,
        fvgSignals: fvgSignals[h1Idx],
        obSignals: obSignals[h1Idx],
        sweepSignals: sweepSignals[h1Idx],
        oteSignals: oteSignals[h1Idx],
        candles1h, candles15m, indicators1h,
        index1h: h1Idx, index15m: i,
        deltaArr: indicators15m.delta.delta,
      };

      const modelCtx = { ...ctx, index1h: h1Idx, index15m: i, regimeResult: regimeData };
      const signal = modelRouter.evaluate(SYMBOL, modelCtx);

      if (signal) {
        // Open position with full feature capture
        const atr = ctx.atr;
        const slMult = (profile.riskOverrides?.slMultiplier ?? config.risk[regime]?.slMultiplier ?? 0.9) * profile.slTightness;
        const tpMult = config.risk[regime]?.tpMultiplier || 2.5;
        const slDist = Math.abs(price - signal.stopLoss);
        if (slDist === 0) continue;
        const riskPct = (config.risk[regime]?.riskPercent || 0.5) * (profile.riskMultiplier ?? 1.0);
        const riskAmt = balance * (riskPct / 100);
        const size = riskAmt / slDist;
        const slippage = price * config.engine.slippage;
        const fillPrice = price + slippage * (signal.action === 'buy' ? 1 : -1);
        const fee = size * fillPrice * config.engine.makerFee;
        const margin = (size * fillPrice) / 10;
        if (margin + fee > balance) continue;
        if (dailyTradeCount >= config.engine.maxDailyTrades) continue;
        dailyTradeCount++;
        balance -= fee;

        // Capture entry features for forensics
        const deltaHistory = [];
        for (let j = Math.max(0, i - 9); j <= i; j++) {
          deltaHistory.push(indicators15m.delta.delta[j] ?? 0);
        }

        position = {
          symbol: SYMBOL,
          side: signal.action === 'buy' ? 'long' : 'short',
          size, entryPrice: fillPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          regime, signalType: signal.type,
          mode: signal.mode || 'DAYTRADE',
          reason: signal.reason || signal.type,
          entryTime: ts, fee, atr,
          highestPrice: fillPrice, lowestPrice: fillPrice,
          trailingActive: false, partialTPDone: false,
          assetProfile: profile.name, profile,
          source: signal.source || 'model',
          // FORENSIC DATA — captured at entry
          entryFeatures: {
            price, ema21, ema50, atr, adx: indicators1h.adx[h1Idx],
            regime, regimeConfidence: regimeData.confidence,
            delta: indicators15m.delta.delta[i],
            deltaPercent: indicators15m.delta.deltaPercent[i],
            deltaHistory: deltaHistory.slice(),
            deltaSum: deltaHistory.reduce((a, b) => a + b, 0),
            volumeRatio: indicators1h.volumeMetrics.volumeRatio[h1Idx],
            signalConfidence: signal.combinedScore || signal.confidence,
            bullish, bearish,
            // Stacked count
            stackedCount: countStacked(deltaHistory),
            // Distance from mean (ATR units)
            distFromMean: Math.abs(price - sma(candles1h, h1Idx, 20)) / atr,
            // ATR z-score
            atrZ: computeATRz(indicators1h.atr, h1Idx),
          },
        };
        lastSignalTime = ts;
      }
    }

    // Track equity
    const unrealized = position ? (position.side === 'long' ? (candle.close - position.entryPrice) * position.size : (position.entryPrice - candle.close) * position.size) : 0;
    const equity = balance + unrealized;
    if (equity > peak.value) peak.value = equity;
  }

  // ═══════════════════════════════════════════════════════════
  // PRINT FORENSIC REPORT
  // ═══════════════════════════════════════════════════════════
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`EMERGENCY STOP FORENSICS — ${SYMBOL}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  console.log(`  Total trades: ${allTrades.length}`);
  console.log(`  Emergency stops: ${emergencyForensics.length}`);
  console.log(`  Total emergency loss: $${emergencyForensics.reduce((s, f) => s + f.pnl, 0).toFixed(2)}`);
  console.log(`  Total PnL (all trades): $${allTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2)}\n`);

  // Detailed forensics for EACH emergency stop
  for (let idx = 0; idx < emergencyForensics.length; idx++) {
    const f = emergencyForensics[idx];
    const ef = f.entryFeatures;
    const date = new Date(f.entryTime).toISOString().slice(0, 16);

    console.log(`╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║ STOP #${idx + 1}: ${date} ${f.side.toUpperCase().padEnd(5)} ${f.regime.padEnd(14)} ${f.signalType.padEnd(24)} ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

    console.log(`  💰 PnL: $${f.pnl.toFixed(2)} | Duration: ${f.durationHours}h`);
    console.log(`  📊 Entry: ${f.entryPrice.toFixed(4)} → Exit: ${f.exitPrice.toFixed(4)} (${f.moveInATR.toFixed(1)} ATR against)`);
    console.log();

    // 1. REGIME ANALYSIS
    console.log(`  ── REGIME AT ENTRY ──────────────────────────────────`);
    console.log(`    Detected: ${ef.regime} (confidence: ${(ef.regimeConfidence * 100).toFixed(0)}%)`);
    console.log(`    ADX: ${ef.adx?.toFixed(1) || '?'}`);
    console.log(`    EMA21: ${ef.ema21?.toFixed(2) || '?'} | EMA50: ${ef.ema50?.toFixed(2) || '?'}`);
    console.log(`    Price: ${ef.price?.toFixed(2) || '?'}`);
    console.log(`    Bullish stack: ${ef.bullish} | Bearish stack: ${ef.bearish}`);
    console.log();

    // 2. SIGNAL ANALYSIS
    console.log(`  ── SIGNAL QUALITY ───────────────────────────────────`);
    console.log(`    Type: ${f.signalType}`);
    console.log(`    Confidence: ${(ef.signalConfidence * 100).toFixed(0)}%`);
    console.log(`    ATR: ${ef.atr?.toFixed(4) || '?'}`);
    console.log(`    ATR z-score: ${ef.atrZ?.toFixed(2) || '?'}`);
    console.log(`    Dist from 20-SMA: ${ef.distFromMean?.toFixed(2) || '?'} ATR`);
    console.log();

    // 3. DELTA / ORDER FLOW
    console.log(`  ── ORDER FLOW AT ENTRY ──────────────────────────────`);
    console.log(`    Current delta: ${ef.delta?.toFixed(0) || '?'}`);
    console.log(`    Delta %: ${ef.deltaPercent?.toFixed(1) || '?'}%`);
    console.log(`    Delta sum (10 candles): ${ef.deltaSum?.toFixed(0) || '?'}`);
    console.log(`    Stacked count: ${ef.stackedCount || '?'}`);
    console.log(`    Volume ratio: ${ef.volumeRatio?.toFixed(2) || '?'}x`);
    console.log(`    Delta history: [${(ef.deltaHistory || []).map(d => d.toFixed(0)).join(', ')}]`);
    console.log();

    // 4. POST-ENTRY PRICE ACTION
    console.log(`  ── WHAT HAPPENED AFTER ENTRY ────────────────────────`);
    console.log(`    Entry: ${f.entryPrice.toFixed(4)}`);
    console.log(`    Worst point: ${f.worstPrice.toFixed(4)} (${f.maxAdverseExcursion.toFixed(1)} ATR against)`);
    console.log(`    Best point: ${f.bestPrice.toFixed(4)} (${f.maxFavorableExcursion.toFixed(1)} ATR in favor)`);
    console.log(`    Exit: ${f.exitPrice.toFixed(4)} (${f.moveInATR.toFixed(1)} ATR against)`);
    console.log(`    Emergency SL: ${f.emergencySL.toFixed(4)} (${f.emergencyATR} ATR from entry)`);
    console.log();

    // 5. WOULD TIGHTER STOP HAVE SAVED IT?
    console.log(`  ── STOP LOSS SENSITIVITY ────────────────────────────`);
    for (const testATR of [3, 4, 5, 6, 8, 10, 12]) {
      const testSL = f.side === 'long'
        ? f.entryPrice - f.atr * testATR
        : f.entryPrice + f.atr * testATR;
      const wouldHit = f.side === 'long'
        ? f.worstPrice <= testSL
        : f.worstPrice >= testSL;
      const savedLoss = wouldHit ? `STOPPED @ ${testSL.toFixed(4)} (loss: $${(Math.abs(testSL - f.entryPrice) * f.size - f.fee).toFixed(0)})` : 'survived';
      console.log(`    ${String(testATR).padStart(2)} ATR: ${wouldHit ? '❌' : '✅'} ${savedLoss}`);
    }
    console.log();

    // 6. WARNING SIGNS WE MISSED
    console.log(`  ── WARNING SIGNS (what we SHOULD have caught) ───────`);
    const warnings = [];
    if (ef.atrZ > 1.5) warnings.push(`ATR z-score was ${ef.atrZ.toFixed(2)} (elevated volatility)`);
    if (ef.distFromMean > 1.5) warnings.push(`Price was ${ef.distFromMean.toFixed(1)} ATR from mean (extended)`);
    if (ef.stackedCount >= 5) warnings.push(`${ef.stackedCount} stacked candles (exhaustion zone)`);
    if (ef.volumeRatio > 2.0) warnings.push(`Volume was ${ef.volumeRatio.toFixed(1)}x average (climax)`);
    if (ef.regime === 'TRENDING_UP' && ef.adx > 40) warnings.push(`ADX was ${ef.adx.toFixed(1)} (very strong trend — late entry)`);
    if (ef.regime === 'VOL_EXPANSION' && ef.atrZ > 2.0) warnings.push(`VOL_EXP + high ATR-z = late move`);

    // Check if delta diverged from price at entry
    if (ef.deltaHistory && ef.deltaHistory.length >= 5) {
      const recentDelta = ef.deltaHistory.slice(-3).reduce((a, b) => a + b, 0);
      const olderDelta = ef.deltaHistory.slice(-6, -3).reduce((a, b) => a + b, 0);
      if (f.side === 'long' && recentDelta < olderDelta && recentDelta > 0) {
        warnings.push(`Delta was decelerating (recent ${recentDelta.toFixed(0)} vs older ${olderDelta.toFixed(0)})`);
      }
      if (f.side === 'short' && recentDelta > olderDelta && recentDelta < 0) {
        warnings.push(`Delta was decelerating (selling pressure weakening)`);
      }
    }

    if (warnings.length === 0) warnings.push('No obvious warning signs — signal quality looked normal');

    for (const w of warnings) {
      console.log(`    ⚠️  ${w}`);
    }

    console.log(`\n${'═'.repeat(64)}\n`);
  }

  // PATTERN SUMMARY
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`PATTERN SUMMARY — What do ALL emergency stops have in common?`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const byRegime = {};
  const bySignal = {};
  const atrZs = [];
  const distFromMeans = [];
  const stackedCounts = [];
  const adxs = [];

  for (const f of emergencyForensics) {
    const ef = f.entryFeatures;
    byRegime[f.regime] = (byRegime[f.regime] || 0) + 1;
    bySignal[f.signalType] = (bySignal[f.signalType] || 0) + 1;
    if (ef.atrZ != null) atrZs.push(ef.atrZ);
    if (ef.distFromMean != null) distFromMeans.push(ef.distFromMean);
    if (ef.stackedCount != null) stackedCounts.push(ef.stackedCount);
    if (ef.adx != null) adxs.push(ef.adx);
  }

  console.log(`  By regime:`);
  for (const [rg, count] of Object.entries(byRegime).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${rg}: ${count} stops (${(count / emergencyForensics.length * 100).toFixed(0)}%)`);
  }

  console.log(`\n  By signal type:`);
  for (const [sig, count] of Object.entries(bySignal).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${sig}: ${count} stops (${(count / emergencyForensics.length * 100).toFixed(0)}%)`);
  }

  console.log(`\n  Average features at entry:`);
  if (atrZs.length) console.log(`    ATR z-score: ${(atrZs.reduce((a, b) => a + b, 0) / atrZs.length).toFixed(2)} (range: ${Math.min(...atrZs).toFixed(2)} - ${Math.max(...atrZs).toFixed(2)})`);
  if (distFromMeans.length) console.log(`    Dist from mean: ${(distFromMeans.reduce((a, b) => a + b, 0) / distFromMeans.length).toFixed(2)} ATR (range: ${Math.min(...distFromMeans).toFixed(2)} - ${Math.max(...distFromMeans).toFixed(2)})`);
  if (stackedCounts.length) console.log(`    Stacked count: ${(stackedCounts.reduce((a, b) => a + b, 0) / stackedCounts.length).toFixed(1)} (range: ${Math.min(...stackedCounts)} - ${Math.max(...stackedCounts)})`);
  if (adxs.length) console.log(`    ADX: ${(adxs.reduce((a, b) => a + b, 0) / adxs.length).toFixed(1)} (range: ${Math.min(...adxs).toFixed(1)} - ${Math.max(...adxs).toFixed(1)})`);

  console.log('');
}

function checkExitForensic(pos, candle, ts, candles15m, idx, indicators15m) {
  const price = candle.close;
  const high = candle.high, low = candle.low;
  if (pos.side === 'long') { if (high > pos.highestPrice) pos.highestPrice = high; }
  else { if (low < pos.lowestPrice) pos.lowestPrice = low; }

  // Partial TP (same as normal)
  if (config.engine.partialTP?.enabled && !pos.partialTPDone) {
    const tp1Dist = pos.atr * config.engine.partialTP.tpMultiplier;
    let hit = false;
    if (pos.side === 'long' && high >= pos.entryPrice + tp1Dist) hit = true;
    if (pos.side === 'short' && low <= pos.entryPrice - tp1Dist) hit = true;
    if (hit) {
      const partialSize = pos.size * config.engine.partialTP.closePercent;
      const tp1Price = pos.side === 'long' ? pos.entryPrice + tp1Dist : pos.entryPrice - tp1Dist;
      const fee = partialSize * tp1Price * config.engine.takerFee;
      const diff = pos.side === 'long' ? tp1Price - pos.entryPrice : pos.entryPrice - tp1Price;
      const pnl = diff * partialSize - (pos.fee * config.engine.partialTP.closePercent) - fee;
      pos.size *= (1 - config.engine.partialTP.closePercent);
      pos.fee *= (1 - config.engine.partialTP.closePercent);
      pos.partialTPDone = true;
      // Don't return — continue tracking the remaining position
    }
  }

  // Trailing
  if (config.engine.trailingStop.enabled) {
    const ro = pos.profile?.riskOverrides;
    const actATR = ro?.trailingStop?.activationATR ?? config.engine.trailingStop.activationATR;
    const trailATR = ro?.trailingStop?.trailATR ?? config.engine.trailingStop.trailATR;
    if (!pos.trailingActive) {
      if (pos.side === 'long' && high >= pos.entryPrice + pos.atr * actATR) pos.trailingActive = true;
      else if (pos.side === 'short' && low <= pos.entryPrice - pos.atr * actATR) pos.trailingActive = true;
    }
    if (pos.trailingActive) {
      if (pos.side === 'long') { const nsl = pos.highestPrice - pos.atr * trailATR; if (nsl > pos.stopLoss) pos.stopLoss = nsl; }
      else { const nsl = pos.lowestPrice + pos.atr * trailATR; if (nsl < pos.stopLoss) pos.stopLoss = nsl; }
    }
  }

  // Emergency SL
  const emATR = pos.profile?.riskOverrides?.emergencyATR ?? 12.0;
  const emDist = pos.atr * emATR;
  const emSL = pos.side === 'long' ? pos.entryPrice - emDist : pos.entryPrice + emDist;

  if ((pos.side === 'long' && low <= emSL) || (pos.side === 'short' && high >= emSL)) {
    const slippage = emSL * config.engine.slippage * (pos.side === 'long' ? -1 : 1);
    const fillPrice = emSL + slippage;
    const fee = pos.size * fillPrice * config.engine.takerFee;
    const diff = pos.side === 'long' ? fillPrice - pos.entryPrice : pos.entryPrice - fillPrice;
    const pnl = diff * pos.size - pos.fee - fee;

    // Calculate max adverse/favorable excursion
    const maxAE = pos.side === 'long'
      ? (pos.entryPrice - pos.lowestPrice) / pos.atr
      : (pos.highestPrice - pos.entryPrice) / pos.atr;
    const maxFE = pos.side === 'long'
      ? (pos.highestPrice - pos.entryPrice) / pos.atr
      : (pos.entryPrice - pos.lowestPrice) / pos.atr;

    const trade = {
      symbol: pos.symbol, side: pos.side, size: pos.size,
      entryPrice: pos.entryPrice, exitPrice: fillPrice,
      entryTime: pos.entryTime, exitTime: ts,
      closeReason: 'emergency_stop', regime: pos.regime,
      signalType: pos.signalType, mode: pos.mode,
      pnl, pnlPercent: pnl / (pos.size * pos.entryPrice) * 100,
      totalFees: pos.fee + fee,
      duration: ts - pos.entryTime,
      durationMin: Math.round((ts - pos.entryTime) / 60000),
      assetProfile: pos.assetProfile,
    };

    return {
      trade,
      forensic: {
        ...trade,
        entryPrice: pos.entryPrice,
        exitPrice: fillPrice,
        atr: pos.atr,
        size: pos.size,
        fee: pos.fee,
        moveInATR: Math.abs(fillPrice - pos.entryPrice) / pos.atr,
        maxAdverseExcursion: maxAE,
        maxFavorableExcursion: maxFE,
        worstPrice: pos.side === 'long' ? pos.lowestPrice : pos.highestPrice,
        bestPrice: pos.side === 'long' ? pos.highestPrice : pos.lowestPrice,
        emergencySL: emSL,
        emergencyATR: emATR,
        durationHours: ((ts - pos.entryTime) / 3600000).toFixed(1),
        entryFeatures: pos.entryFeatures,
      },
    };
  }

  // TP
  if (pos.side === 'long' && high >= pos.takeProfit) {
    const slippage = pos.takeProfit * config.engine.slippage * -1;
    const fillPrice = pos.takeProfit + slippage;
    const fee = pos.size * fillPrice * config.engine.takerFee;
    const diff = fillPrice - pos.entryPrice;
    const pnl = diff * pos.size - pos.fee - fee;
    return { trade: { symbol: pos.symbol, side: pos.side, size: pos.size, entryPrice: pos.entryPrice, exitPrice: fillPrice, entryTime: pos.entryTime, exitTime: ts, closeReason: 'take_profit', regime: pos.regime, signalType: pos.signalType, mode: pos.mode, pnl, pnlPercent: pnl / (pos.size * pos.entryPrice) * 100, totalFees: pos.fee + fee, duration: ts - pos.entryTime, durationMin: Math.round((ts - pos.entryTime) / 60000), assetProfile: pos.assetProfile } };
  }
  if (pos.side === 'short' && low <= pos.takeProfit) {
    const slippage = pos.takeProfit * config.engine.slippage;
    const fillPrice = pos.takeProfit + slippage;
    const fee = pos.size * fillPrice * config.engine.takerFee;
    const diff = pos.entryPrice - fillPrice;
    const pnl = diff * pos.size - pos.fee - fee;
    return { trade: { symbol: pos.symbol, side: pos.side, size: pos.size, entryPrice: pos.entryPrice, exitPrice: fillPrice, entryTime: pos.entryTime, exitTime: ts, closeReason: 'take_profit', regime: pos.regime, signalType: pos.signalType, mode: pos.mode, pnl, pnlPercent: pnl / (pos.size * pos.entryPrice) * 100, totalFees: pos.fee + fee, duration: ts - pos.entryTime, durationMin: Math.round((ts - pos.entryTime) / 60000), assetProfile: pos.assetProfile } };
  }

  return null;
}

function countStacked(deltas) {
  if (deltas.length < 2) return 0;
  let max = 1, cur = 1, last = Math.sign(deltas[0]);
  for (let i = 1; i < deltas.length; i++) {
    const s = Math.sign(deltas[i]);
    if (s === last && s !== 0) { cur++; max = Math.max(max, cur); }
    else { cur = 1; last = s; }
  }
  return max;
}

function sma(candles, index, period) {
  const start = Math.max(0, index - period + 1);
  let sum = 0;
  for (let i = start; i <= index; i++) sum += candles[i].close;
  return sum / (index - start + 1);
}

function computeATRz(atrArr, index, lookback = 50) {
  if (!atrArr || index == null || index < lookback) return 0;
  const cur = atrArr[index];
  if (!cur || cur === 0) return 0;
  let sum = 0, sumSq = 0;
  const start = Math.max(0, index - lookback);
  const count = index - start + 1;
  for (let j = start; j <= index; j++) { const v = atrArr[j] || 0; sum += v; sumSq += v * v; }
  const mean = sum / count;
  const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
  return std > 0 ? (cur - mean) / std : 0;
}

function checkKillzone(ts) {
  const h = new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60;
  const kz = config.killzones;
  if (kz.deadzones.some(dz => h >= dz.start && h < dz.end)) return { allowed: false, session: 'dead' };
  const inL = h >= kz.london.start && h < kz.london.end;
  const inN = h >= kz.ny.start && h < kz.ny.end;
  const inO = h >= kz.overlap.start && h < kz.overlap.end;
  const inA = (h >= kz.asia.start || h < kz.asia.end);
  const s = inO ? 'overlap' : inN ? 'ny' : inL ? 'london' : inA ? 'asia' : 'off';
  if (s === 'off') return { allowed: false, session: s };
  return { allowed: true, session: s };
}

async function fetchCandles(exchange, symbol, tf) {
  const all = []; let since = new Date('2022-01-01').getTime(); const end = new Date('2026-03-31').getTime();
  while (true) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, tf, since, 1000);
      if (!ohlcv.length) break;
      all.push(...ohlcv.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })));
      const last = ohlcv[ohlcv.length - 1][0];
      if (last >= end || ohlcv.length < 1000) break;
      since = last + 1;
      await new Promise(r => setTimeout(r, exchange.rateLimit));
    } catch (e) { console.error(`  Fetch error: ${e.message}`); break; }
  }
  return all.filter(c => c.timestamp <= end);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
