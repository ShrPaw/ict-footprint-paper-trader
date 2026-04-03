// ═══════════════════════════════════════════════════════════════════
// ModelRouter.js — Asset → Model Dispatcher
// ═══════════════════════════════════════════════════════════════════
//
// Routes each asset to its independent alpha engine.
// Each model has its own feature set, signal logic, and behavioral assumptions.
//
// Architecture:
//   Asset → Router → SOLModel | BTCModel | ETHModel | XRPModel
//
// The router is a thin dispatcher. It does NOT contain signal logic.
// All signal logic lives in the per-asset models.

import SOLModel from './SOLModel.js';
import BTCModel from './BTCModel.js';
import ETHModel from './ETHModel.js';
import XRPModel from './XRPModel.js';

export default class ModelRouter {
  constructor() {
    // Instantiate models once — they're stateless (evaluation context comes from ctx)
    this.models = {
      SOL: new SOLModel(),
      BTC: new BTCModel(),
      ETH: new ETHModel(),
      XRP: new XRPModel(),
    };
  }

  /**
   * Route symbol to its model and evaluate.
   *
   * @param {string} symbol — e.g. 'ETH/USDT:USDT', 'SOL', 'BTC/USDT:USDT'
   * @param {object} ctx — Full context object (same as used by legacy _evaluateSignal)
   * @returns {{ signal, diagnostics } | null}
   */
  evaluate(symbol, ctx) {
    const coin = this._extractCoin(symbol);
    const model = this.models[coin];

    if (!model) {
      console.warn(`[ModelRouter] No model for ${symbol} (coin: ${coin})`);
      return null;
    }

    return model.evaluate(ctx);
  }

  /**
   * Get model name for a symbol (for logging/reporting)
   */
  getModelName(symbol) {
    const coin = this._extractCoin(symbol);
    return this.models[coin]?.name || 'UNKNOWN';
  }

  /**
   * List all registered models
   */
  listModels() {
    return Object.entries(this.models).map(([coin, model]) => ({
      coin,
      name: model.name,
    }));
  }

  // ── Internal ─────────────────────────────────────────────────

  _extractCoin(symbol) {
    if (!symbol) return 'UNKNOWN';
    // Handle formats: 'ETH/USDT:USDT', 'ETH/USDT', 'ETH', 'SOL'
    return symbol.split('/')[0].split(':')[0].toUpperCase();
  }
}
