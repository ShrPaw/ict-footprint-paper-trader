import http from 'http';
import { EventEmitter } from 'events';

// TradingView webhook receiver — accepts alerts from Pine Script strategies
// Usage in TradingView: alert(condition, alert.freq_once_per_bar_close,
//   {{strategy.order.action}}, {{ticker}}, {{close}}, {{interval}})
export default class TradingViewWebhook extends EventEmitter {
  constructor(port = 3456) {
    super();
    this.port = port;
    this.server = null;
    this.secret = process.env.WEBHOOK_SECRET || 'paper-trader-local';
  }

  start() {
    this.server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/webhook') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);

            // Optional secret check
            if (data.secret && data.secret !== this.secret) {
              res.writeHead(403);
              res.end('Forbidden');
              return;
            }

            const signal = this._parseSignal(data);
            if (signal) {
              this.emit('signal', signal);
              console.log(`[Webhook] Signal received: ${signal.action} ${signal.symbol} @ ${signal.price}`);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.server.listen(this.port, () => {
      console.log(`[Webhook] TradingView webhook listening on port ${this.port}`);
      console.log(`[Webhook] Set your TradingView alert webhook URL to: http://your-ip:${this.port}/webhook`);
    });
  }

  stop() {
    if (this.server) this.server.close();
  }

  _parseSignal(data) {
    // Supports multiple formats:
    // Format 1: { action: "buy", symbol: "SOLUSDT", price: 123.45 }
    // Format 2: { "strategy": { "order": { "action": "buy" } }, "ticker": "SOLUSDT" }
    // Format 3: Plain text "buy SOL 123.45"

    if (typeof data === 'string') {
      const parts = data.trim().split(/\s+/);
      return {
        action: parts[0]?.toLowerCase(),
        symbol: this._normalizeSymbol(parts[1]),
        price: parseFloat(parts[2]) || null,
      };
    }

    return {
      action: data.action || data.strategy?.order?.action || data.side,
      symbol: this._normalizeSymbol(data.symbol || data.ticker),
      price: parseFloat(data.price || data.close) || null,
      stopLoss: parseFloat(data.stopLoss || data.sl) || null,
      takeProfit: parseFloat(data.takeProfit || data.tp) || null,
      timeframe: data.timeframe || data.interval || null,
    };
  }

  _normalizeSymbol(symbol) {
    if (!symbol) return null;
    // Convert TradingView format (SOLUSDT) to ccxt format (SOL/USDT:USDT)
    symbol = symbol.replace('PERP', '').replace('Swap', '');
    if (symbol.includes('/')) return symbol;
    if (symbol.endsWith('USDT')) return symbol.replace('USDT', '/USDT:USDT');
    return symbol;
  }
}
