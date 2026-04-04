"""
PHASE 2: Event-Level Edge Discovery (CORE)
============================================
For EACH asset independently:
  1. Define high-recall events (broad, non-optimized)
  2. Build event dataset with forward returns, MAE, MFE
  3. Distribution analysis (bias, shape, path behavior)

Assets analyzed INDEPENDENTLY. No combining.
No filtering beyond event definition. No trade simulation.
"""

import pandas as pd
import numpy as np
from scipy import stats
import os
import json
import warnings
warnings.filterwarnings('ignore')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "raw_data")
RESULTS_DIR = os.path.join(BASE_DIR, "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

ASSETS = ["BTC", "ETH", "SOL", "XRP"]
# Primary analysis on 1h (18 months, broad regime coverage) 
# and 15m (12 months, more granular)
PRIMARY_TF = "1h"
SECONDARY_TF = "15m"

FORWARD_HORIZONS_H = [1, 4, 12, 24]  # hours for 1h data
FORWARD_HORIZONS_15M = [4, 20, 60, 240]  # 15m bars for 15m data

def load_data(asset, timeframe):
    path = os.path.join(DATA_DIR, asset, f"{timeframe}.csv")
    df = pd.read_csv(path, parse_dates=["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)
    return df

def compute_atr(df, period=14):
    """Average True Range."""
    high = df["high"].values
    low = df["low"].values
    close = df["close"].values
    tr = np.maximum(high[1:] - low[1:], 
                    np.maximum(np.abs(high[1:] - close[:-1]), 
                              np.abs(low[1:] - close[:-1])))
    atr = pd.Series(tr).rolling(period).mean().values
    # Pad first element
    atr = np.concatenate([[np.nan], atr])
    return atr

def compute_vwap(df, lookback=24):
    """Rolling VWAP approximation using typical price * volume."""
    tp = (df["high"] + df["low"] + df["close"]) / 3
    cum_tp_vol = (tp * df["volume"]).rolling(lookback).sum()
    cum_vol = df["volume"].rolling(lookback).sum()
    return (cum_tp_vol / cum_vol).values

def compute_forward_returns(df, horizons, price_col="close"):
    """
    For each row, compute forward returns over multiple horizons.
    Returns dict of {horizon: array_of_forward_returns}
    """
    prices = df[price_col].values
    n = len(prices)
    results = {}
    
    for h in horizons:
        fwd = np.full(n, np.nan)
        # Forward return: (price[t+h] - price[t]) / price[t]
        if h < n:
            fwd[:n-h] = (prices[h:] - prices[:n-h]) / prices[:n-h]
        results[h] = fwd
    
    return results

def compute_mae_mfe(df, horizons, direction="long"):
    """
    Compute MAE (max adverse excursion) and MFE (max favorable excursion)
    over forward horizons.
    """
    n = len(df)
    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values
    
    mae_results = {}
    mfe_results = {}
    time_to_mae = {}
    time_to_mfe = {}
    
    for h in horizons:
        mae = np.full(n, np.nan)
        mfe = np.full(n, np.nan)
        t_mae = np.full(n, np.nan)
        t_mfe = np.full(n, np.nan)
        
        for i in range(n - h):
            entry = closes[i]
            fwd_highs = highs[i+1:i+1+h]
            fwd_lows = lows[i+1:i+1+h]
            
            if len(fwd_highs) == 0:
                continue
            
            if direction == "long":
                adverse = (fwd_lows - entry) / entry  # negative is bad
                favorable = (fwd_highs - entry) / entry  # positive is good
            else:
                adverse = (fwd_highs - entry) / entry
                favorable = (fwd_lows - entry) / entry
            
            mae[i] = np.min(adverse)  # worst excursion
            mfe[i] = np.max(favorable)  # best excursion
            t_mae[i] = np.argmin(adverse) + 1
            t_mfe[i] = np.argmax(favorable) + 1
        
        mae_results[h] = mae
        mfe_results[h] = mfe
        time_to_mae[h] = t_mae
        time_to_mfe[h] = t_mfe
    
    return mae_results, mfe_results, time_to_mae, time_to_mfe

# ================================================================
# EVENT DEFINITIONS (High-Recall, Non-Optimized)
# ================================================================

def event_session_opens(df):
    """
    Session open events: Asia (00:00 UTC), London (08:00 UTC), NY (13:30 UTC)
    Purely structural — no optimization possible.
    """
    hours = df["timestamp"].dt.hour
    minutes = df["timestamp"].dt.minute
    
    asia = (hours == 0) & (minutes == 0)
    london = (hours == 8) & (minutes == 0)
    # NY: 13:30 UTC (crypto markets use 13:30 for stock open reference)
    # For hourly data, use 14:00 as closest
    ny = (hours == 14) & (minutes == 0)
    
    return asia | london | ny

def event_session_opens_15m(df):
    """Session opens at 15m resolution."""
    hours = df["timestamp"].dt.hour
    minutes = df["timestamp"].dt.minute
    
    asia = (hours == 0) & (minutes == 0)
    london = (hours == 8) & (minutes == 0)
    ny = (hours == 13) & (minutes == 30)
    
    return asia | london | ny

def event_displacement_candles(df, atr, multiplier=2.0):
    """
    Displacement/expansion: candle range > multiplier * ATR.
    Non-optimized threshold — just "unusually large candles."
    """
    candle_range = (df["high"] - df["low"]).values
    valid = ~np.isnan(atr) & (atr > 0)
    events = np.zeros(len(df), dtype=bool)
    events[valid] = candle_range[valid] > (multiplier * atr[valid])
    return pd.Series(events, index=df.index)

def event_vwap_deviation(df, vwap, threshold=0.02):
    """
    Price deviates significantly from rolling VWAP.
    |close - vwap| / vwap > threshold
    """
    close = df["close"].values
    valid = ~np.isnan(vwap) & (vwap > 0)
    dev = np.zeros(len(df), dtype=bool)
    dev[valid] = np.abs(close[valid] - vwap[valid]) / vwap[valid] > threshold
    return pd.Series(dev, index=df.index)

def event_volatility_expansion(df, atr, period=48, multiplier=1.5):
    """
    Volatility expansion: current ATR > multiplier * rolling mean ATR.
    Detects regime shifts toward higher vol.
    """
    valid = ~np.isnan(atr)
    events = np.zeros(len(df), dtype=bool)
    
    atr_series = pd.Series(atr)
    atr_ma = atr_series.rolling(period, min_periods=period//2).mean().values
    
    valid2 = valid & ~np.isnan(atr_ma) & (atr_ma > 0)
    events[valid2] = atr[valid2] > (multiplier * atr_ma[valid2])
    return pd.Series(events, index=df.index)

def event_liquidity_sweep(df, lookback=24):
    """
    Liquidity sweep: price takes local high/low then closes back inside.
    Simple version: candle high > prev N high, but close < prev N high (bearish sweep)
    or candle low < prev N low, but close > prev N low (bullish sweep).
    """
    n = len(df)
    events = np.zeros(n, dtype=bool)
    
    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values
    opens = df["open"].values
    
    for i in range(lookback, n):
        prev_high = np.max(highs[i-lookback:i])
        prev_low = np.min(lows[i-lookback:i])
        
        # Bearish sweep: takes high, closes below
        if highs[i] > prev_high and closes[i] < prev_high:
            events[i] = True
        # Bullish sweep: takes low, closes above
        elif lows[i] < prev_low and closes[i] > prev_low:
            events[i] = True
    
    return pd.Series(events, index=df.index)

def event_consecutive_direction(df, min_bars=3):
    """
    N consecutive candles in same direction.
    Simple momentum/momentum-exhaustion event.
    """
    n = len(df)
    events = np.zeros(n, dtype=bool)
    
    closes = df["close"].values
    opens = df["open"].values
    direction = (closes > opens).astype(int)  # 1=up, 0=down
    
    for i in range(min_bars, n):
        # Check if last N bars same direction
        if np.all(direction[i-min_bars+1:i+1] == direction[i]):
            events[i] = True
    
    return pd.Series(events, index=df.index)


# ================================================================
# DISTRIBUTION ANALYSIS
# ================================================================

def analyze_distribution(returns, label=""):
    """Full statistical analysis of a return distribution."""
    returns = returns[~np.isnan(returns)]
    
    if len(returns) < 30:
        return {
            "label": label,
            "n": len(returns),
            "error": "Insufficient sample size (<30)"
        }
    
    result = {
        "label": label,
        "n": len(returns),
        "mean": float(np.mean(returns)),
        "median": float(np.median(returns)),
        "std": float(np.std(returns, ddof=1)),
        "min": float(np.min(returns)),
        "max": float(np.max(returns)),
        "pct_positive": float(np.mean(returns > 0) * 100),
        "pct_negative": float(np.mean(returns < 0) * 100),
        "skewness": float(stats.skew(returns)),
        "kurtosis": float(stats.kurtosis(returns)),
        "sharpe_approx": float(np.mean(returns) / np.std(returns, ddof=1)) if np.std(returns) > 0 else 0,
    }
    
    # Statistical tests
    # 1. Is mean significantly different from zero?
    t_stat, t_pval = stats.ttest_1samp(returns, 0)
    result["t_stat"] = float(t_stat)
    result["t_pval"] = float(t_pval)
    result["mean_significant_5pct"] = t_pval < 0.05
    
    # 2. Wilcoxon signed-rank (non-parametric)
    try:
        w_stat, w_pval = stats.wilcoxon(returns)
        result["wilcoxon_pval"] = float(w_pval)
    except:
        result["wilcoxon_pval"] = None
    
    # 3. Is distribution normal? (Shapiro-Wilk for n<5000, else D'Agostino)
    if len(returns) < 5000:
        norm_stat, norm_pval = stats.shapiro(returns)
    else:
        norm_stat, norm_pval = stats.normaltest(returns)
    result["normality_stat"] = float(norm_stat)
    result["normality_pval"] = float(norm_pval)
    result["is_normal_5pct"] = norm_pval > 0.05
    
    # 4. Percentile analysis
    for p in [1, 5, 10, 25, 75, 90, 95, 99]:
        result[f"p{p}"] = float(np.percentile(returns, p))
    
    return result

def analyze_path_behavior(mae_dict, mfe_dict, t_mae_dict, t_mfe_dict, horizons):
    """Analyze path behavior: immediate continuation vs mean reversion."""
    results = {}
    
    for h in horizons:
        mae = mae_dict[h][~np.isnan(mae_dict[h])]
        mfe = mfe_dict[h][~np.isnan(mfe_dict[h])]
        t_mae = t_mae_dict[h][~np.isnan(t_mae_dict[h])]
        t_mfe = t_mfe_dict[h][~np.isnan(t_mfe_dict[h])]
        
        if len(mae) < 30:
            continue
        
        results[h] = {
            "mean_mae": float(np.mean(mae)),
            "mean_mfe": float(np.mean(mfe)),
            "median_mae": float(np.median(mae)),
            "median_mfe": float(np.median(mfe)),
            "mfe_mae_ratio": float(np.mean(mfe) / abs(np.mean(mae))) if np.mean(mae) != 0 else None,
            "mean_time_to_mae": float(np.mean(t_mae)),
            "mean_time_to_mfe": float(np.mean(t_mfe)),
            "pct_mfe_before_mae": float(np.mean(t_mfe < t_mae) * 100) if len(t_mae) > 0 and len(t_mfe) > 0 else None,
        }
    
    return results

def time_split_stability(returns, timestamps, n_splits=4):
    """
    Split returns into time periods and check if edge is stable.
    Returns mean return per split and variance of means.
    """
    returns_clean = returns[~np.isnan(returns)]
    ts_clean = timestamps[~np.isnan(returns)]
    
    if len(returns_clean) < n_splits * 30:
        return {"error": "Insufficient data for split analysis"}
    
    split_size = len(returns_clean) // n_splits
    split_means = []
    
    for i in range(n_splits):
        start = i * split_size
        end = start + split_size if i < n_splits - 1 else len(returns_clean)
        split_mean = np.mean(returns_clean[start:end])
        split_means.append(float(split_mean))
    
    return {
        "split_means": split_means,
        "variance_of_means": float(np.var(split_means)),
        "coefficient_of_variation": float(np.std(split_means) / abs(np.mean(split_means))) if np.mean(split_means) != 0 else None,
        "all_positive": all(m > 0 for m in split_means),
        "all_negative": all(m < 0 for m in split_means),
        "sign_changes": sum(1 for i in range(1, len(split_means)) if (split_means[i] > 0) != (split_means[i-1] > 0)),
    }


# ================================================================
# MAIN ANALYSIS PIPELINE
# ================================================================

def run_asset_analysis(asset, timeframe="1h"):
    """
    Full Phase 2 analysis for a single asset at a given timeframe.
    """
    print(f"\n{'='*60}")
    print(f"PHASE 2: {asset} @ {timeframe}")
    print(f"{'='*60}")
    
    df = load_data(asset, timeframe)
    print(f"  Loaded {len(df):,} candles: {df['timestamp'].min()} → {df['timestamp'].max()}")
    
    # Compute indicators
    atr = compute_atr(df, period=14)
    vwap = compute_vwap(df, lookback=24)
    
    # Select horizons and event functions based on timeframe
    if timeframe == "1h":
        horizons = FORWARD_HORIZONS_H
        session_fn = event_session_opens
    else:
        horizons = FORWARD_HORIZONS_15M
        session_fn = event_session_opens_15m
    
    # Define events (ALL high-recall, non-optimized)
    events = {
        "session_open": session_fn(df),
        "displacement_2x_atr": event_displacement_candles(df, atr, multiplier=2.0),
        "displacement_1.5x_atr": event_displacement_candles(df, atr, multiplier=1.5),
        "vwap_dev_2pct": event_vwap_deviation(df, vwap, threshold=0.02),
        "vwap_dev_1pct": event_vwap_deviation(df, vwap, threshold=0.01),
        "vol_expansion": event_volatility_expansion(df, atr),
        "liquidity_sweep": event_liquidity_sweep(df, lookback=24),
        "consecutive_3": event_consecutive_direction(df, min_bars=3),
        "consecutive_5": event_consecutive_direction(df, min_bars=5),
    }
    
    # Compute forward returns
    fwd_returns = compute_forward_returns(df, horizons)
    
    # Compute MAE/MFE for long direction (we analyze both directions via returns)
    mae_long, mfe_long, t_mae_long, t_mfe_long = compute_mae_mfe(df, horizons, direction="long")
    mae_short, mfe_short, t_mae_short, t_mfe_short = compute_mae_mfe(df, horizons, direction="short")
    
    # Analyze each event type
    asset_results = {
        "asset": asset,
        "timeframe": timeframe,
        "total_candles": len(df),
        "date_range": f"{df['timestamp'].min()} → {df['timestamp'].max()}",
        "events": {},
    }
    
    for event_name, event_mask in events.items():
        event_count = event_mask.sum()
        
        print(f"\n  Event: {event_name} — {event_count} occurrences")
        
        if event_count < 30:
            print(f"    SKIP: <30 events")
            asset_results["events"][event_name] = {"count": int(event_count), "skipped": True}
            continue
        
        event_results = {
            "count": int(event_count),
            "horizons": {},
            "path_behavior": {},
        }
        
        # For each forward horizon, analyze the distribution
        for h in horizons:
            event_returns = fwd_returns[h][event_mask.values]
            
            label = f"{asset}_{event_name}_h{h}"
            dist = analyze_distribution(event_returns, label)
            
            # Time split stability
            event_ts = df["timestamp"].values[event_mask.values]
            stability = time_split_stability(event_returns, event_ts)
            
            dist["stability"] = stability
            event_results["horizons"][h] = dist
            
            # Print summary
            if "error" not in dist:
                sig = "***" if dist.get("mean_significant_5pct") else ""
                print(f"    h{h}: mean={dist['mean']*100:+.4f}% "
                      f"pos={dist['pct_positive']:.1f}% "
                      f"skew={dist['skewness']:.3f} "
                      f"t={dist['t_stat']:.2f} {sig}")
        
        # Path behavior (using long direction for now)
        event_results["path_behavior"] = analyze_path_behavior(
            mae_long, mfe_long, t_mae_long, t_mfe_long, horizons
        )
        
        asset_results["events"][event_name] = event_results
    
    # Save results
    result_path = os.path.join(RESULTS_DIR, f"{asset}_{timeframe}_phase2.json")
    with open(result_path, "w") as f:
        json.dump(asset_results, f, indent=2, default=str)
    
    print(f"\n  Results saved to {result_path}")
    
    return asset_results

def run_full_analysis():
    """Run Phase 2 for all assets at primary timeframe."""
    all_results = {}
    
    for asset in ASSETS:
        print(f"\n{'#'*60}")
        print(f"# ASSET: {asset}")
        print(f"{'#'*60}")
        
        # Primary analysis at 1h
        results_1h = run_asset_analysis(asset, "1h")
        all_results[f"{asset}_1h"] = results_1h
        
        # Secondary analysis at 15m
        results_15m = run_asset_analysis(asset, "15m")
        all_results[f"{asset}_15m"] = results_15m
    
    # Generate summary report
    generate_summary_report(all_results)
    
    return all_results

def generate_summary_report(all_results):
    """Generate Phase 2 summary report."""
    report = []
    report.append("=" * 70)
    report.append("PHASE 2: EVENT-LEVEL EDGE DISCOVERY — SUMMARY REPORT")
    report.append("=" * 70)
    
    edge_candidates = []
    no_edge = []
    
    for key, results in all_results.items():
        asset = results["asset"]
        tf = results["timeframe"]
        report.append(f"\n{'─'*50}")
        report.append(f"  {asset} @ {tf}")
        report.append(f"{'─'*50}")
        
        for event_name, event_data in results["events"].items():
            if event_data.get("skipped"):
                continue
            
            report.append(f"\n  Event: {event_name} (n={event_data['count']})")
            
            for h, dist in event_data.get("horizons", {}).items():
                if "error" in dist:
                    continue
                
                sig_marker = "✓" if dist.get("mean_significant_5pct") else "✗"
                stable = "stable" if dist.get("stability", {}).get("coefficient_of_variation") is not None and abs(dist["stability"]["coefficient_of_variation"]) < 1.0 else "unstable"
                
                line = (f"    h{h}: mean={dist['mean']*100:+.4f}% | "
                       f"pos={dist['pct_positive']:.1f}% | "
                       f"skew={dist['skewness']:.3f} | "
                       f"t={dist['t_stat']:.2f} {sig_marker} | "
                       f"{stable}")
                report.append(line)
                
                if dist.get("mean_significant_5pct") and stable == "stable":
                    edge_candidates.append({
                        "asset": asset,
                        "event": event_name,
                        "horizon": h,
                        "mean_return_pct": dist["mean"] * 100,
                        "t_stat": dist["t_stat"],
                        "pct_positive": dist["pct_positive"],
                        "skewness": dist["skewness"],
                        "n": dist["n"],
                    })
                else:
                    no_edge.append(f"{asset}/{event_name}/h{h}")
    
    report.append(f"\n\n{'='*70}")
    report.append("EDGE CANDIDATES (significant + stable)")
    report.append(f"{'='*70}")
    
    if edge_candidates:
        for ec in sorted(edge_candidates, key=lambda x: abs(x["t_stat"]), reverse=True):
            report.append(f"  {ec['asset']} | {ec['event']} | h{ec['horizon']} | "
                         f"mean={ec['mean_return_pct']:+.4f}% | t={ec['t_stat']:.2f} | "
                         f"pos={ec['pct_positive']:.1f}% | skew={ec['skewness']:.3f} | n={ec['n']}")
    else:
        report.append("  NO EDGE CANDIDATES FOUND")
    
    report.append(f"\n{'='*70}")
    report.append("CONCLUSION")
    report.append(f"{'='*70}")
    
    if len(edge_candidates) == 0:
        report.append("  ⛔ NO STATISTICALLY VALID EDGE DETECTED")
        report.append("  → STOP: Return to Phase 2 with different event definitions")
        report.append("  → DO NOT proceed to Phase 3")
    elif len(edge_candidates) < 3:
        report.append("  ⚠️  MARGINAL: Few edge candidates detected")
        report.append("  → Proceed with extreme caution to Phase 3")
        report.append("  → Validate with independent baseline (random entry)")
    else:
        report.append("  ✓ EDGE CANDIDATES EXIST")
        report.append("  → Proceed to Phase 3 (Entry Validation)")
    
    report_text = "\n".join(report)
    print(report_text)
    
    with open(os.path.join(RESULTS_DIR, "phase2_summary.txt"), "w") as f:
        f.write(report_text)
    
    # Save edge candidates
    with open(os.path.join(RESULTS_DIR, "edge_candidates.json"), "w") as f:
        json.dump(edge_candidates, f, indent=2)

if __name__ == "__main__":
    results = run_full_analysis()
