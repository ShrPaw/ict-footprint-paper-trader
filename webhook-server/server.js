import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.WEBHOOK_PORT || 3450;
const DATA_FILE = path.join(__dirname, 'paper_trades.json');

// ── State ─────────────────────────────────────────────────────────

let state = loadState();

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    balance: 10000,
    startingBalance: 10000,
    positions: {},
    trades: [],
    lastSignals: {},
  };
}

function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

// ── Trade Logic ───────────────────────────────────────────────────

function handleSignal(signal) {
  const { action, symbol, price, stopLoss, takeProfit, regime, score } = signal;

  if (!action || !symbol || !price) {
    return { ok: false, reason: 'missing fields' };
  }

  const sym = symbol.toUpperCase();

  // Check if already in position
  if (state.positions[sym]) {
    console.log(`⚠️  Already in ${sym}, ignoring ${action}`);
    return { ok: false, reason: 'already_in_position' };
  }

  // Cooldown check (45 minutes)
  const now = Date.now();
  if (state.lastSignals[sym] && (now - state.lastSignals[sym]) < 45 * 60 * 1000) {
    console.log(`⏳ Cooldown active for ${sym}`);
    return { ok: false, reason: 'cooldown' };
  }

  const side = action.toLowerCase() === 'buy' ? 'long' : 'short';
  const riskAmount = state.balance * 0.005; // 0.5% risk
  const sl = parseFloat(stopLoss);
  const tp = parseFloat(takeProfit);
  const slDist = Math.abs(price - sl);
  const size = slDist > 0 ? riskAmount / slDist : 0;
  const fee = size * price * 0.0005;

  const position = {
    symbol: sym,
    side,
    size: parseFloat(size.toFixed(6)),
    entryPrice: parseFloat(price),
    stopLoss: sl,
    takeProfit: tp,
    regime: regime || 'UNKNOWN',
    score: parseFloat(score) || 0,
    entryTime: now,
    fee,
    reason: `${regime} | score: ${score}`,
  };

  state.positions[sym] = position;
  state.lastSignals[sym] = now;
  state.balance -= fee;
  saveState();

  const emoji = side === 'long' ? '🟢' : '🔴';
  console.log(`\n${emoji} ENTRY: ${side.toUpperCase()} ${sym} @ ${price}`);
  console.log(`   SL: ${sl} | TP: ${tp} | Size: ${size.toFixed(4)} | Regime: ${regime}`);

  return { ok: true, position };
}

function handleClose(signal) {
  const { symbol, price } = signal;
  const sym = symbol?.toUpperCase();

  if (!sym || !state.positions[sym]) {
    return { ok: false, reason: 'no_position' };
  }

  closePosition(sym, parseFloat(price), signal.reason || 'alert_close');
}

function closePosition(sym, exitPrice, reason) {
  const pos = state.positions[sym];
  if (!pos) return;

  const fee = pos.size * exitPrice * 0.0005;
  const priceDiff = pos.side === 'long'
    ? exitPrice - pos.entryPrice
    : pos.entryPrice - exitPrice;
  const pnl = priceDiff * pos.size - pos.fee - fee;

  state.balance += pnl;

  const trade = {
    ...pos,
    exitPrice,
    exitTime: Date.now(),
    closeReason: reason,
    pnl: parseFloat(pnl.toFixed(2)),
    pnlPercent: parseFloat((pnl / (pos.size * pos.entryPrice) * 100).toFixed(2)),
    totalFees: parseFloat((pos.fee + fee).toFixed(4)),
    duration: Date.now() - pos.entryTime,
    durationMin: Math.round((Date.now() - pos.entryTime) / 60000),
  };

  state.trades.push(trade);
  delete state.positions[sym];
  saveState();

  const emoji = pnl >= 0 ? '✅' : '❌';
  console.log(`${emoji} CLOSED: ${sym} | PnL: $${pnl.toFixed(2)} (${trade.pnlPercent}%) | ${reason}`);

  return { ok: true, trade };
}

// Check SL/TP manually (called periodically)
function checkExits() {
  // In paper mode, we rely on TradingView strategy to close.
  // But we can also check via price polling if needed.
  // For now, positions are closed by incoming close signals.
}

// ── Stats ─────────────────────────────────────────────────────────

function getStats() {
  const wins = state.trades.filter(t => t.pnl > 0);
  const losses = state.trades.filter(t => t.pnl <= 0);
  const totalPnL = state.trades.reduce((s, t) => s + t.pnl, 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  let peak = state.startingBalance;
  let maxDD = 0;
  let running = state.startingBalance;
  for (const t of state.trades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = (peak - running) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    balance: parseFloat(state.balance.toFixed(2)),
    totalPnL: parseFloat(totalPnL.toFixed(2)),
    totalPnLPercent: parseFloat(((state.balance - state.startingBalance) / state.startingBalance * 100).toFixed(2)),
    totalTrades: state.trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: state.trades.length ? (wins.length / state.trades.length * 100).toFixed(1) : '0',
    avgWin: wins.length ? (grossProfit / wins.length).toFixed(2) : '0',
    avgLoss: losses.length ? (grossLoss / losses.length).toFixed(2) : '0',
    profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞',
    maxDrawdown: (maxDD * 100).toFixed(2) + '%',
    totalFees: parseFloat(state.trades.reduce((s, t) => s + t.totalFees, 0).toFixed(2)),
    openPositions: Object.keys(state.positions).length,
    positions: Object.values(state.positions),
    recentTrades: state.trades.slice(-10).reverse(),
  };
}

// ── HTTP Server ───────────────────────────────────────────────────

const DASHBOARD_HTML = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Dashboard
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
    return;
  }

  // Stats API
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getStats()));
    return;
  }

  // Positions API
  if (req.method === 'GET' && url.pathname === '/api/positions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.positions));
    return;
  }

  // Trades API
  if (req.method === 'GET' && url.pathname === '/api/trades') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.trades.slice(-50).reverse()));
    return;
  }

  // Reset API
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    state = {
      balance: 10000,
      startingBalance: 10000,
      positions: {},
      trades: [],
      lastSignals: {},
    };
    saveState();
    console.log('🔄 Paper trading account reset to $10,000');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, balance: 10000 }));
    return;
  }

  // TradingView Webhook
  if (req.method === 'POST' && url.pathname === '/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    res.on('close', () => {});
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log(`\n📡 Webhook received: ${JSON.stringify(data)}`);

        let result;
        if (data.action === 'close') {
          result = handleClose(data);
        } else {
          result = handleSignal(data);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result || { ok: true }));
      } catch (err) {
        console.error(`❌ Webhook error: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║   📊 TradingView Paper Trade Server                 ║`);
  console.log(`║   Port: ${PORT}                                       ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`\n📡 Webhook:   http://localhost:${PORT}/webhook`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/`);
  console.log(`💰 Balance:   $${state.balance.toFixed(2)}`);
  console.log(`📈 Trades:    ${state.trades.length}`);
  console.log(`\nWaiting for TradingView alerts...\n`);
});
