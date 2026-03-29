import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.DASHBOARD_PORT || 3500;

// In-memory state — each bot POSTs its status here
const botStates = {};

function handleAPI(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/bots — all bot states
  if (req.method === 'GET' && url.pathname === '/api/bots') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(botStates));
    return true;
  }

  // GET /api/bots/:name — single bot state
  if (req.method === 'GET' && url.pathname.startsWith('/api/bots/')) {
    const name = url.pathname.split('/').pop();
    const state = botStates[name];
    res.writeHead(state ? 200 : 404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(state || { error: 'not found' }));
    return true;
  }

  // POST /api/bots/:name/status — bot reports its status
  if (req.method === 'POST' && url.pathname.startsWith('/api/bots/') && url.pathname.endsWith('/status')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const name = url.pathname.split('/')[3];
        const data = JSON.parse(body);
        botStates[name] = {
          ...data,
          lastSeen: Date.now(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
    return true;
  }

  // POST /api/bots/:name/trades — bot reports a trade
  if (req.method === 'POST' && url.pathname.endsWith('/trades')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const name = url.pathname.split('/')[3];
        if (!botStates[name]) botStates[name] = {};
        if (!botStates[name].trades) botStates[name].trades = [];
        const trade = JSON.parse(body);
        trade.timestamp = Date.now();
        botStates[name].trades.push(trade);
        // Keep last 100 trades
        if (botStates[name].trades.length > 100) {
          botStates[name].trades = botStates[name].trades.slice(-100);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
    return true;
  }

  // OPTIONS — CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  return false;
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer((req, res) => {
  if (!handleAPI(req, res)) {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`📊 Dashboard running at http://localhost:${PORT}`);
});

// Clean up stale bots (no heartbeat for 30s)
setInterval(() => {
  const now = Date.now();
  for (const [name, state] of Object.entries(botStates)) {
    if (now - (state.lastSeen || 0) > 30000) {
      state.status = 'offline';
    }
  }
}, 10000);
