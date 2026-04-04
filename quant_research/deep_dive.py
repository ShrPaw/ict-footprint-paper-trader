"""
Deeper investigation: Are the "validated" edges actually tradeable?
- Check if median is positive (not just mean)
- Check % positive (win rate)
- Check MAE/MFE to see if the path is tradeable
- Check if removing top 1% / 5% tail events kills the edge
"""

import pandas as pd
import numpy as np
from scipy import stats
import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "raw_data")
RESULTS_DIR = os.path.join(BASE_DIR, "results")

def load_data(asset, timeframe):
    path = os.path.join(DATA_DIR, asset, f"{timeframe}.csv")
    return pd.read_csv(path, parse_dates=["timestamp"]).sort_values("timestamp").reset_index(drop=True)

def compute_vwap(df, lookback=24):
    tp = (df["high"] + df["low"] + df["close"]) / 3
    return ((tp * df["volume"]).rolling(lookback).sum() / df["volume"].rolling(lookback).sum()).values

def deep_dive(asset, horizon):
    """Deep dive on XRP/BTC/SOL VWAP deviation 2% edge."""
    df = load_data(asset, "15m")
    vwap = compute_vwap(df, lookback=24)
    
    close = df["close"].values
    valid = ~np.isnan(vwap) & (vwap > 0)
    event_mask = np.zeros(len(df), dtype=bool)
    event_mask[valid] = np.abs(close[valid] - vwap[valid]) / vwap[valid] > 0.02
    
    # Forward returns
    prices = df["close"].values
    n = len(prices)
    fwd_ret = np.full(n, np.nan)
    if horizon < n:
        fwd_ret[:n-horizon] = (prices[horizon:] - prices[:n-horizon]) / prices[:n-horizon]
    
    event_returns = fwd_ret[event_mask]
    event_returns = event_returns[~np.isnan(event_returns)]
    
    print(f"\n{'='*60}")
    print(f"DEEP DIVE: {asset} VWAP Dev 2% @ h{horizon} (15m)")
    print(f"{'='*60}")
    print(f"  Events: {len(event_returns)}")
    
    # Full distribution stats
    print(f"\n  Distribution:")
    print(f"    Mean:     {np.mean(event_returns)*100:+.4f}%")
    print(f"    Median:   {np.median(event_returns)*100:+.4f}%")
    print(f"    Std:      {np.std(event_returns)*100:.4f}%")
    print(f"    Skew:     {stats.skew(event_returns):.3f}")
    print(f"    Kurtosis: {stats.kurtosis(event_returns):.3f}")
    
    # Win rate
    pos_pct = np.mean(event_returns > 0) * 100
    print(f"\n  Win Rate:")
    print(f"    Positive: {pos_pct:.1f}%")
    print(f"    Negative: {100-pos_pct:.1f}%")
    print(f"    Break-even: {np.mean(event_returns == 0)*100:.1f}%")
    
    # Percentile analysis
    print(f"\n  Percentiles:")
    for p in [1, 5, 10, 25, 50, 75, 90, 95, 99]:
        val = np.percentile(event_returns, p)
        print(f"    P{p:2d}: {val*100:+.4f}%")
    
    # Tail analysis
    print(f"\n  Tail Removal Test:")
    for trim_pct in [0, 1, 2, 5, 10]:
        if trim_pct == 0:
            trimmed = event_returns
        else:
            n_trim = int(len(event_returns) * trim_pct / 100)
            sorted_ret = np.sort(event_returns)
            trimmed = sorted_ret[n_trim:-n_trim] if n_trim > 0 else sorted_ret
        
        mean_t = np.mean(trimmed)
        median_t = np.median(trimmed)
        pos_t = np.mean(trimmed > 0) * 100
        t_stat, t_pval = stats.ttest_1samp(trimmed, 0)
        
        print(f"    Trim {trim_pct:2d}%: mean={mean_t*100:+.4f}% "
              f"median={median_t*100:+.4f}% pos={pos_t:.1f}% "
              f"t={t_stat:.2f} p={t_pval:.4f}")
    
    # Direction-specific analysis
    print(f"\n  Direction Check:")
    
    # Get event timestamps for direction analysis
    event_indices = np.where(event_mask)[0]
    
    # Check if price is above or below VWAP at event
    price_at_event = close[event_mask]
    vwap_at_event = vwap[event_mask]
    above_vwap = price_at_event > vwap_at_event
    below_vwap = price_at_event < vwap_at_event
    
    above_returns = event_returns[above_vwap[:len(event_returns)]]
    below_returns = event_returns[below_vwap[:len(event_returns)]]
    
    if len(above_returns) > 10:
        print(f"    Above VWAP (n={len(above_returns)}): "
              f"mean={np.mean(above_returns)*100:+.4f}% "
              f"pos={np.mean(above_returns > 0)*100:.1f}%")
    if len(below_returns) > 10:
        print(f"    Below VWAP (n={len(below_returns)}): "
              f"mean={np.mean(below_returns)*100:+.4f}% "
              f"pos={np.mean(below_returns > 0)*100:.1f}%")
    
    # MAE / MFE analysis (can we actually capture this edge?)
    print(f"\n  Path Analysis (MAE/MFE):")
    
    highs = df["high"].values
    lows = df["low"].values
    entries = close[event_mask]
    
    maes = []
    mfes = []
    for idx in event_indices:
        if idx + horizon >= n:
            continue
        entry = close[idx]
        fwd_high = np.max(highs[idx+1:idx+1+horizon])
        fwd_low = np.min(lows[idx+1:idx+1+horizon])
        
        mae = (fwd_low - entry) / entry  # worst adverse
        mfe = (fwd_high - entry) / entry  # best favorable
        
        maes.append(mae)
        mfes.append(mfe)
    
    maes = np.array(maes)
    mfes = np.array(mfes)
    
    print(f"    Mean MAE: {np.mean(maes)*100:+.4f}%")
    print(f"    Mean MFE: {np.mean(mfes)*100:+.4f}%")
    print(f"    Median MAE: {np.median(maes)*100:+.4f}%")
    print(f"    Median MFE: {np.median(mfes)*100:+.4f}%")
    print(f"    MFE/MAE ratio: {abs(np.mean(mfes)/np.mean(maes)):.2f}" if np.mean(maes) != 0 else "    MFE/MAE ratio: N/A")
    
    # What % of time does MFE come before MAE?
    # (i.e., can we exit profitably before getting stopped out?)
    
    # Return-based edge verdict
    print(f"\n  VERDICT:")
    
    is_tradeable = True
    issues = []
    
    if np.median(event_returns) <= 0:
        issues.append("Median return is negative/zero")
        is_tradeable = False
    
    if pos_pct < 51:
        issues.append(f"Win rate only {pos_pct:.1f}% — below 51%")
        is_tradeable = False
    
    # Check if edge survives tail removal
    sorted_ret = np.sort(event_returns)
    n_trim = int(len(event_returns) * 0.05)
    trimmed = sorted_ret[n_trim:-n_trim]
    if np.mean(trimmed) <= 0 or stats.ttest_1samp(trimmed, 0)[1] > 0.05:
        issues.append("Edge disappears after removing top/bottom 5%")
        is_tradeable = False
    
    if np.mean(maes) < -0.02:  # >2% average drawdown
        issues.append(f"Average MAE is {np.mean(maes)*100:.2f}% — high slippage risk")
    
    if is_tradeable:
        print(f"    ✓ TRADEABLE EDGE EXISTS")
        print(f"    → Proceed to Phase 4 (Time/Lifecycle Modeling)")
    else:
        print(f"    ✗ NOT TRADEABLE")
        for issue in issues:
            print(f"    → {issue}")
    
    return is_tradeable, issues

print("="*70)
print("DEEP DIVE: TRADEABILITY ASSESSMENT")
print("="*70)

results = {}
for asset in ["BTC", "SOL", "XRP"]:
    is_tradeable, issues = deep_dive(asset, horizon=240)
    results[asset] = {"tradeable": is_tradeable, "issues": issues}

print(f"\n\n{'='*70}")
print("FINAL ASSESSMENT")
print(f"{'='*70}")
for asset, r in results.items():
    status = "✓" if r["tradeable"] else "✗"
    print(f"  {status} {asset}: {'TRADEABLE' if r['tradeable'] else 'NOT TRADEABLE'}")
    for issue in r.get("issues", []):
        print(f"      → {issue}")
