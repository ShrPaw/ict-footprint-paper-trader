"""
PHASE 2.5: EDGE STRESS TESTING
================================
Adversarial research: attempt to BREAK the below-VWAP mean reversion edge.

6 tests:
  1. Regime Segmentation (volatility × trend × time)
  2. Event Clustering Analysis
  3. Entry Delay Sensitivity
  4. Subsampling Stability (Monte Carlo)
  5. Directional Adversarial Test (short vs long)
  6. Path Stability Analysis (MAE/MFE dynamics)

Decision: If ANY test fails → REJECT edge.
"""

import pandas as pd
import numpy as np
from scipy import stats
import os
import json
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "raw_data")
RESULTS_DIR = os.path.join(BASE_DIR, "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

ASSETS = ["BTC", "SOL", "XRP"]  # Only assets with detected edge
HORIZON = 24  # 24 x 15m = 6h — use a moderate horizon for stress tests
# We'll also test at the optimal horizon per asset

def load_data(asset):
    path = os.path.join(DATA_DIR, asset, "15m.csv")
    df = pd.read_csv(path, parse_dates=["timestamp"])
    return df.sort_values("timestamp").reset_index(drop=True)

def compute_vwap(df, lookback=24):
    tp = (df["high"] + df["low"] + df["close"]) / 3
    return ((tp * df["volume"]).rolling(lookback).sum() / df["volume"].rolling(lookback).sum()).values

def compute_atr(df, period=14):
    high = df["high"].values
    low = df["low"].values
    close = df["close"].values
    tr = np.concatenate([[np.nan], np.maximum(
        np.diff(high),
        np.maximum(np.abs(high[1:] - close[:-1]), np.abs(low[1:] - close[:-1]))
    )])
    return pd.Series(tr).rolling(period).mean().values

def get_below_vwap_events(df, vwap, threshold=0.02):
    """Events where price is >threshold% BELOW VWAP (the edge we found)."""
    close = df["close"].values
    valid = ~np.isnan(vwap) & (vwap > 0)
    mask = np.zeros(len(df), dtype=bool)
    mask[valid] = (vwap[valid] - close[valid]) / vwap[valid] > threshold
    return mask

def get_above_vwap_events(df, vwap, threshold=0.02):
    """Events where price is >threshold% ABOVE VWAP (adversarial test)."""
    close = df["close"].values
    valid = ~np.isnan(vwap) & (vwap > 0)
    mask = np.zeros(len(df), dtype=bool)
    mask[valid] = (close[valid] - vwap[valid]) / vwap[valid] > threshold
    return mask

def compute_fwd_returns(df, horizon):
    prices = df["close"].values
    n = len(prices)
    fwd = np.full(n, np.nan)
    if horizon < n:
        fwd[:n-horizon] = (prices[horizon:] - prices[:n-horizon]) / prices[:n-horizon]
    return fwd

def event_stats(returns):
    """Core statistics for a set of event returns."""
    returns = returns[~np.isnan(returns)]
    if len(returns) < 10:
        return None
    t_stat, t_pval = stats.ttest_1samp(returns, 0)
    return {
        "n": len(returns),
        "mean": float(np.mean(returns)),
        "median": float(np.median(returns)),
        "std": float(np.std(returns)),
        "pct_positive": float(np.mean(returns > 0) * 100),
        "t_stat": float(t_stat),
        "t_pval": float(t_pval),
        "significant": t_pval < 0.05,
        "sharpe": float(np.mean(returns) / np.std(returns)) if np.std(returns) > 0 else 0,
    }


# ═══════════════════════════════════════════════════════════════
# TEST 1: REGIME SEGMENTATION
# ═══════════════════════════════════════════════════════════════

def test1_regime_segmentation(asset, df, event_mask, horizon):
    """
    Split by:
    - Volatility tercile (low/med/high ATR)
    - Trend regime (bull/bear/sideways via 50-period return)
    - Time (quarterly splits)
    """
    print(f"\n  TEST 1: Regime Segmentation — {asset}")
    
    close = df["close"].values
    atr = compute_atr(df, 14)
    fwd_ret = compute_fwd_returns(df, horizon)
    event_idx = np.where(event_mask)[0]
    
    results = {"volatility": {}, "trend": {}, "time": {}}
    
    # --- Volatility Regime ---
    atr_at_event = atr[event_idx]
    valid_atr = ~np.isnan(atr_at_event)
    if np.sum(valid_atr) > 30:
        terciles = np.percentile(atr_at_event[valid_atr], [33, 67])
        
        for label, mask_fn in [
            ("low", lambda a: a <= terciles[0]),
            ("mid", lambda a: (a > terciles[0]) & (a <= terciles[1])),
            ("high", lambda a: a > terciles[1]),
        ]:
            vol_mask = np.zeros(len(event_idx), dtype=bool)
            vol_mask[valid_atr] = mask_fn(atr_at_event[valid_atr])
            sub_returns = fwd_ret[event_idx[vol_mask]]
            s = event_stats(sub_returns)
            if s:
                results["volatility"][label] = s
                sig = "✓" if s["significant"] else "✗"
                print(f"    Vol {label:>4}: n={s['n']:>4} mean={s['mean']*100:+.3f}% "
                      f"pos={s['pct_positive']:.1f}% t={s['t_stat']:+.2f} {sig}")
    
    # --- Trend Regime ---
    # Use 48-bar (12h) return as trend proxy
    lookback = 48
    trend_ret = np.full(len(close), np.nan)
    if lookback < len(close):
        trend_ret[lookback:] = (close[lookback:] - close[:-lookback]) / close[:-lookback]
    
    trend_at_event = trend_ret[event_idx]
    valid_trend = ~np.isnan(trend_at_event)
    if np.sum(valid_trend) > 30:
        for label, mask_fn in [
            ("bear", lambda t: t < -0.01),
            ("sideways", lambda t: (t >= -0.01) & (t <= 0.01)),
            ("bull", lambda t: t > 0.01),
        ]:
            trend_mask = np.zeros(len(event_idx), dtype=bool)
            trend_mask[valid_trend] = mask_fn(trend_at_event[valid_trend])
            sub_returns = fwd_ret[event_idx[trend_mask]]
            s = event_stats(sub_returns)
            if s:
                results["trend"][label] = s
                sig = "✓" if s["significant"] else "✗"
                print(f"    Trend {label:>7}: n={s['n']:>4} mean={s['mean']*100:+.3f}% "
                      f"pos={s['pct_positive']:.1f}% t={s['t_stat']:+.2f} {sig}")
    
    # --- Time Splits (quarterly) ---
    timestamps = df["timestamp"].values[event_idx]
    quarters = pd.to_datetime(timestamps).to_period("Q")
    unique_quarters = sorted(set(quarters))
    
    for q in unique_quarters:
        q_mask = quarters == q
        sub_returns = fwd_ret[event_idx[q_mask]]
        s = event_stats(sub_returns)
        if s:
            results["time"][str(q)] = s
            sig = "✓" if s["significant"] else "✗"
            print(f"    Q {str(q):>6}: n={s['n']:>4} mean={s['mean']*100:+.3f}% "
                  f"pos={s['pct_positive']:.1f}% t={s['t_stat']:+.2f} {sig}")
    
    # Pass/fail: edge must be significant in majority of sub-regimes
    all_sub = []
    for regime_type in ["volatility", "trend", "time"]:
        for label, s in results[regime_type].items():
            all_sub.append(s)
    
    n_sig = sum(1 for s in all_sub if s["significant"])
    n_total = len(all_sub)
    pct_sig = n_sig / n_total * 100 if n_total > 0 else 0
    
    passed = pct_sig >= 50  # must be significant in at least half of sub-regimes
    print(f"    → {n_sig}/{n_total} sub-regimes significant ({pct_sig:.0f}%) — "
          f"{'PASS ✓' if passed else 'FAIL ✗'}")
    
    return {"passed": passed, "pct_significant": pct_sig, "details": results}


# ═══════════════════════════════════════════════════════════════
# TEST 2: EVENT CLUSTERING ANALYSIS
# ═══════════════════════════════════════════════════════════════

def test2_clustering(asset, df, event_mask, horizon, min_gap_bars=8):
    """
    Events within min_gap_bars of each other are part of the same market move.
    Collapse clusters to single representative events.
    Recompute edge on de-clustered data.
    """
    print(f"\n  TEST 2: Event Clustering — {asset}")
    
    event_idx = np.where(event_mask)[0]
    fwd_ret = compute_fwd_returns(df, horizon)
    
    # Identify clusters
    clusters = []
    current_cluster = [event_idx[0]]
    
    for i in range(1, len(event_idx)):
        if event_idx[i] - event_idx[i-1] <= min_gap_bars:
            current_cluster.append(event_idx[i])
        else:
            clusters.append(current_cluster)
            current_cluster = [event_idx[i]]
    clusters.append(current_cluster)
    
    # Statistics
    cluster_sizes = [len(c) for c in clusters]
    print(f"    Total events: {len(event_idx)}")
    print(f"    Clusters: {len(clusters)}")
    print(f"    Cluster sizes: mean={np.mean(cluster_sizes):.1f} "
          f"median={np.median(cluster_sizes):.0f} max={np.max(cluster_sizes)}")
    print(f"    Singles: {sum(1 for s in cluster_sizes if s == 1)} "
          f"({sum(1 for s in cluster_sizes if s == 1)/len(clusters)*100:.0f}%)")
    
    # De-cluster: take the middle event from each cluster
    declustered_idx = []
    for cluster in clusters:
        mid = cluster[len(cluster) // 2]
        declustered_idx.append(mid)
    declustered_idx = np.array(declustered_idx)
    
    # Also try: take the event with the most extreme deviation
    # (closest to deepest discount)
    vwap = compute_vwap(df, lookback=24)
    close = df["close"].values
    
    extreme_idx = []
    for cluster in clusters:
        deviations = [(vwap[i] - close[i]) / vwap[i] if not np.isnan(vwap[i]) and vwap[i] > 0 else 0 
                      for i in cluster]
        best = cluster[np.argmax(deviations)]
        extreme_idx.append(best)
    extreme_idx = np.array(extreme_idx)
    
    # Compute stats
    # Original
    orig_returns = fwd_ret[event_mask]
    orig_s = event_stats(orig_returns)
    print(f"\n    Original:    n={orig_s['n']:>4} mean={orig_s['mean']*100:+.4f}% "
          f"pos={orig_s['pct_positive']:.1f}% t={orig_s['t_stat']:+.2f}")
    
    # De-clustered (middle)
    mid_returns = fwd_ret[declustered_idx]
    mid_s = event_stats(mid_returns)
    print(f"    Mid-event:   n={mid_s['n']:>4} mean={mid_s['mean']*100:+.4f}% "
          f"pos={mid_s['pct_positive']:.1f}% t={mid_s['t_stat']:+.2f}")
    
    # De-clustered (extreme)
    ext_returns = fwd_ret[extreme_idx]
    ext_s = event_stats(ext_returns)
    print(f"    Extreme-dev: n={ext_s['n']:>4} mean={ext_s['mean']*100:+.4f}% "
          f"pos={ext_s['pct_positive']:.1f}% t={ext_s['t_stat']:+.2f}")
    
    # Pass if edge remains significant after declustering
    passed = mid_s["significant"] and ext_s["significant"]
    print(f"    → {'PASS ✓' if passed else 'FAIL ✗'}")
    
    return {"passed": passed, "original": orig_s, "mid_event": mid_s, "extreme_dev": ext_s}


# ═══════════════════════════════════════════════════════════════
# TEST 3: ENTRY DELAY SENSITIVITY
# ═══════════════════════════════════════════════════════════════

def test3_delay_sensitivity(asset, df, event_mask, horizon):
    """
    Test entry at event, +1 candle, +3 candles, +5 candles.
    Edge should NOT collapse with small delays.
    """
    print(f"\n  TEST 3: Entry Delay Sensitivity — {asset}")
    
    close = df["close"].values
    n = len(close)
    delays = [0, 1, 3, 5, 8]
    
    results = {}
    for delay in delays:
        # Delayed entry: return from (event + delay) to (event + delay + horizon)
        delayed_returns = []
        event_idx = np.where(event_mask)[0]
        
        for idx in event_idx:
            entry_idx = idx + delay
            exit_idx = entry_idx + horizon
            if exit_idx < n:
                ret = (close[exit_idx] - close[entry_idx]) / close[entry_idx]
                delayed_returns.append(ret)
        
        delayed_returns = np.array(delayed_returns)
        s = event_stats(delayed_returns)
        if s:
            results[delay] = s
            sig = "✓" if s["significant"] else "✗"
            print(f"    Delay +{delay}: n={s['n']:>4} mean={s['mean']*100:+.4f}% "
                  f"pos={s['pct_positive']:.1f}% t={s['t_stat']:+.2f} {sig}")
    
    # Pass if edge survives at delay +3 at minimum
    passed = (results.get(3, {}).get("significant", False) and 
              results.get(0, {}).get("significant", False))
    
    # Also check that the trend is monotonically decreasing with delay
    # (later entry should have smaller edge, but not zero)
    means = [results[d]["mean"] for d in delays if d in results]
    monotonic_decline = all(means[i] >= means[i+1] for i in range(len(means)-1)) if len(means) > 1 else True
    
    print(f"    → Edge at +3 delay: {'✓' if results.get(3,{}).get('significant') else '✗'}")
    print(f"    → {'PASS ✓' if passed else 'FAIL ✗'}")
    
    return {"passed": passed, "details": results, "monotonic_decline": monotonic_decline}


# ═══════════════════════════════════════════════════════════════
# TEST 4: SUBSAMPLING STABILITY
# ═══════════════════════════════════════════════════════════════

def test4_subsampling(asset, df, event_mask, horizon, n_sims=2000):
    """
    Randomly remove 30% and 50% of events, recompute metrics.
    Check stability of mean return distribution.
    """
    print(f"\n  TEST 4: Subsampling Stability — {asset}")
    
    fwd_ret = compute_fwd_returns(df, horizon)
    event_idx = np.where(event_mask)[0]
    event_returns = fwd_ret[event_idx]
    valid_mask = ~np.isnan(event_returns)
    valid_returns = event_returns[valid_mask]
    valid_idx = event_idx[valid_mask]
    
    full_mean = np.mean(valid_returns)
    full_n = len(valid_returns)
    
    print(f"    Full sample: n={full_n} mean={full_mean*100:+.4f}%")
    
    rng = np.random.default_rng(42)
    results = {}
    
    for remove_pct in [0.3, 0.5]:
        keep_n = int(full_n * (1 - remove_pct))
        sample_means = []
        sample_medians = []
        sample_pos = []
        sample_sig = []
        
        for _ in range(n_sims):
            idx = rng.choice(full_n, size=keep_n, replace=False)
            sample = valid_returns[idx]
            sample_means.append(np.mean(sample))
            sample_medians.append(np.median(sample))
            sample_pos.append(np.mean(sample > 0) * 100)
            t_stat, t_pval = stats.ttest_1samp(sample, 0)
            sample_sig.append(t_pval < 0.05)
        
        sample_means = np.array(sample_means)
        
        results[remove_pct] = {
            "mean_of_means": float(np.mean(sample_means)),
            "std_of_means": float(np.std(sample_means)),
            "median_of_means": float(np.median(sample_means)),
            "pct_significant": float(np.mean(sample_sig) * 100),
            "coef_of_variation": float(np.std(sample_means) / abs(np.mean(sample_means))) if np.mean(sample_means) != 0 else None,
            "mean_of_pos": float(np.mean(sample_pos)),
        }
        
        r = results[remove_pct]
        print(f"    Remove {remove_pct*100:.0f}% (keep {keep_n}): "
              f"mean={r['mean_of_means']*100:+.4f}% ±{r['std_of_means']*100:.4f}% "
              f"sig={r['pct_significant']:.0f}% CV={r['coef_of_variation']:.2f}")
    
    # Pass if CV < 1.0 and >80% of subsamples are significant
    cv_ok = all(r["coef_of_variation"] is not None and r["coef_of_variation"] < 1.0 
                for r in results.values())
    sig_ok = all(r["pct_significant"] > 80 for r in results.values())
    passed = cv_ok and sig_ok
    
    print(f"    → CV stable: {'✓' if cv_ok else '✗'}  Significant%: {'✓' if sig_ok else '✗'}  "
          f"{'PASS ✓' if passed else 'FAIL ✗'}")
    
    return {"passed": passed, "details": results}


# ═══════════════════════════════════════════════════════════════
# TEST 5: DIRECTIONAL ADVERSARIAL TEST
# ═══════════════════════════════════════════════════════════════

def test5_directional_adversarial(asset, df, below_mask, above_mask, horizon):
    """
    Compare below-VWAP (long) vs above-VWAP (short/reverse).
    If both perform similarly → no directional edge.
    """
    print(f"\n  TEST 5: Directional Adversarial — {asset}")
    
    fwd_ret = compute_fwd_returns(df, horizon)
    
    below_returns = fwd_ret[below_mask]
    above_returns = fwd_ret[above_mask]
    
    below_s = event_stats(below_returns)
    above_s = event_stats(above_returns)
    
    if below_s:
        print(f"    Below VWAP (long): n={below_s['n']:>4} mean={below_s['mean']*100:+.4f}% "
              f"pos={below_s['pct_positive']:.1f}% t={below_s['t_stat']:+.2f}")
    if above_s:
        print(f"    Above VWAP (long): n={above_s['n']:>4} mean={above_s['mean']*100:+.4f}% "
              f"pos={above_s['pct_positive']:.1f}% t={above_s['t_stat']:+.2f}")
    
    # Test if below is significantly better than above
    if below_s and above_s:
        # Two-sample t-test
        t_stat, t_pval = stats.ttest_ind(
            below_returns[~np.isnan(below_returns)],
            above_returns[~np.isnan(above_returns)],
            equal_var=False
        )
        print(f"    Below vs Above t-test: t={t_stat:.2f} p={t_pval:.4f}")
        
        # Pass: below must be significant AND above must NOT be significant
        # (or above must be negative)
        below_sig = below_s["significant"] and below_s["mean"] > 0
        above_not_sig = (not above_s["significant"]) or above_s["mean"] < 0
        diff_sig = t_pval < 0.05
        
        passed = below_sig and (diff_sig or above_not_sig)
        print(f"    Below significant & positive: {'✓' if below_sig else '✗'}")
        print(f"    Above NOT positive edge: {'✓' if above_not_sig else '✗'}")
        print(f"    Difference significant: {'✓' if diff_sig else '✗'}")
    else:
        passed = False
        print(f"    Insufficient data")
    
    print(f"    → {'PASS ✓' if passed else 'FAIL ✗'}")
    
    return {"passed": passed, "below": below_s, "above": above_s}


# ═══════════════════════════════════════════════════════════════
# TEST 6: PATH STABILITY ANALYSIS (CRITICAL)
# ═══════════════════════════════════════════════════════════════

def test6_path_stability(asset, df, event_mask, horizon):
    """
    Deep analysis of MAE/MFE dynamics:
    - Distribution of drawdown depth
    - Recovery probability after deep drawdown
    - Time in drawdown vs time in profit
    - Worst case clustering
    """
    print(f"\n  TEST 6: Path Stability — {asset}")
    
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values
    n = len(close)
    
    event_idx = np.where(event_mask)[0]
    
    # For each event, compute full path of returns over the horizon
    path_data = []
    for idx in event_idx:
        if idx + horizon >= n:
            continue
        entry = close[idx]
        
        # Full path: return at each bar from 1 to horizon
        path = (close[idx+1:idx+1+horizon] - entry) / entry
        path_high = (high[idx+1:idx+1+horizon] - entry) / entry
        path_low = (low[idx+1:idx+1+horizon] - entry) / entry
        
        mae = np.min(path_low)
        mfe = np.max(path_high)
        mae_bar = np.argmin(path_low) + 1
        mfe_bar = np.argmax(path_high) + 1
        final_ret = path[-1]
        
        # Max drawdown during the path
        cumulative_high = np.maximum.accumulate(path_high)
        drawdown = path_low - cumulative_high
        max_dd = np.min(drawdown)
        
        path_data.append({
            "mae": mae,
            "mfe": mfe,
            "mae_bar": mae_bar,
            "mfe_bar": mfe_bar,
            "final_ret": final_ret,
            "max_dd": max_dd,
            "mfe_before_mae": mfe_bar < mae_bar,
        })
    
    if not path_data:
        print(f"    Insufficient data")
        return {"passed": False}
    
    maes = np.array([p["mae"] for p in path_data])
    mfes = np.array([p["mfe"] for p in path_data])
    finals = np.array([p["final_ret"] for p in path_data])
    mfe_before = np.array([p["mfe_before_mae"] for p in path_data])
    max_dds = np.array([p["max_dd"] for p in path_data])
    
    # Core path metrics
    print(f"    Events analyzed: {len(path_data)}")
    print(f"\n    MAE Distribution:")
    print(f"      Mean: {np.mean(maes)*100:+.2f}%")
    print(f"      Median: {np.median(maes)*100:+.2f}%")
    print(f"      P10: {np.percentile(maes, 10)*100:+.2f}%")
    print(f"      P1: {np.percentile(maes, 1)*100:+.2f}%")
    print(f"      Worst: {np.min(maes)*100:+.2f}%")
    
    print(f"\n    MFE Distribution:")
    print(f"      Mean: {np.mean(mfes)*100:+.2f}%")
    print(f"      Median: {np.median(mfes)*100:+.2f}%")
    
    print(f"\n    MFE/MAE Ratio: {abs(np.mean(mfes)/np.mean(maes)):.2f}")
    
    print(f"\n    Path Order:")
    print(f"      MFE before MAE: {np.mean(mfe_before)*100:.1f}%")
    print(f"      MAE before MFE: {(1-np.mean(mfe_before))*100:.1f}%")
    
    print(f"\n    Time-weighted exposure:")
    print(f"      Mean MAE bar: {np.mean([p['mae_bar'] for p in path_data]):.1f} / {horizon}")
    print(f"      Mean MFE bar: {np.mean([p['mfe_bar'] for p in path_data]):.1f} / {horizon}")
    
    # Drawdown analysis
    print(f"\n    Intraday Max Drawdown:")
    print(f"      Mean max DD: {np.mean(max_dds)*100:+.2f}%")
    print(f"      Median max DD: {np.median(max_dds)*100:+.2f}%")
    print(f"      P5 max DD: {np.percentile(max_dds, 5)*100:+.2f}%")
    
    # Recovery analysis: after hitting MAE, what % eventually recover to profit?
    recovery_count = 0
    deep_dd_recovery = 0  # recovery after >5% drawdown
    deep_dd_total = 0
    
    for i, p in enumerate(path_data):
        if p["mae"] < 0 and p["final_ret"] > 0:
            recovery_count += 1
        if p["mae"] < -0.05:
            deep_dd_total += 1
            if p["final_ret"] > 0:
                deep_dd_recovery += 1
    
    print(f"\n    Recovery Analysis:")
    print(f"      Events with MAE < 0 that end positive: {recovery_count}/{len(path_data)} "
          f"({recovery_count/len(path_data)*100:.1f}%)")
    if deep_dd_total > 0:
        print(f"      Events with MAE < -5% that recover: {deep_dd_recovery}/{deep_dd_total} "
              f"({deep_dd_recovery/deep_dd_total*100:.1f}%)")
    
    # WORST CASE: events with both large MAE and negative final return
    catastrophic = np.sum((maes < -0.05) & (finals < -0.02))
    print(f"      Catastrophic (MAE<-5% AND final<-2%): {catastrophic}/{len(path_data)} "
          f"({catastrophic/len(path_data)*100:.1f}%)")
    
    # Practical tradeability assessment
    # With a 3% stop loss, what % of events would get stopped out?
    for stop_pct in [0.02, 0.03, 0.05, 0.08]:
        stopped = np.mean(maes < -stop_pct) * 100
        print(f"      Stop-out rate at {stop_pct*100:.0f}%: {stopped:.1f}%")
    
    # Decision: edge is "practically untradeable" if:
    # - MFE before MAE < 40%
    # - >30% stop-out rate at 3%
    # - Catastrophic events > 5%
    mfe_before_pct = np.mean(mfe_before) * 100
    stop_3pct = np.mean(maes < -0.03) * 100
    catastrophic_pct = catastrophic / len(path_data) * 100
    
    issues = []
    if mfe_before_pct < 40:
        issues.append(f"MFE before MAE only {mfe_before_pct:.1f}%")
    if stop_3pct > 30:
        issues.append(f"3% stop-out rate {stop_3pct:.1f}%")
    if catastrophic_pct > 5:
        issues.append(f"Catastrophic events {catastrophic_pct:.1f}%")
    
    # For the stress test, we PASS path stability if:
    # - The mean return is still positive (edge exists)
    # - At least some recovery happens
    # We DON'T fail just because of path issues — we flag them
    passed = len(finals[finals > 0]) / len(finals) > 0.5  # majority end positive
    
    if issues:
        print(f"\n    ⚠️  Practical concerns:")
        for issue in issues:
            print(f"       • {issue}")
    
    print(f"    → Path test: {'PASS ✓' if passed else 'FAIL ✗'} "
          f"(edge is {'theoretically valid' if passed else 'NOT valid'})")
    
    return {
        "passed": passed,
        "mfe_before_mae_pct": mfe_before_pct,
        "stop_3pct_rate": stop_3pct,
        "catastrophic_pct": catastrophic_pct,
        "mean_mae": float(np.mean(maes)),
        "mean_mfe": float(np.mean(mfes)),
        "recovery_pct": recovery_count / len(path_data) * 100,
        "issues": issues,
    }


# ═══════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════

def run_all_stress_tests():
    print("=" * 70)
    print("PHASE 2.5: EDGE STRESS TESTING — ADVERSARIAL RESEARCH")
    print("=" * 70)
    
    all_results = {}
    all_pass = True
    
    for asset in ASSETS:
        print(f"\n{'#' * 70}")
        print(f"# ASSET: {asset}")
        print(f"{'#' * 70}")
        
        df = load_data(asset)
        vwap = compute_vwap(df, lookback=24)
        
        below_mask = get_below_vwap_events(df, vwap, threshold=0.02)
        above_mask = get_above_vwap_events(df, vwap, threshold=0.02)
        
        n_below = below_mask.sum()
        n_above = above_mask.sum()
        print(f"  Below-VWAP events: {n_below}")
        print(f"  Above-VWAP events: {n_above}")
        
        if n_below < 50:
            print(f"  SKIP: Too few events ({n_below})")
            continue
        
        asset_results = {}
        
        # Run all 6 tests
        asset_results["test1_regime"] = test1_regime_segmentation(asset, df, below_mask, HORIZON)
        asset_results["test2_clustering"] = test2_clustering(asset, df, below_mask, HORIZON)
        asset_results["test3_delay"] = test3_delay_sensitivity(asset, df, below_mask, HORIZON)
        asset_results["test4_subsampling"] = test4_subsampling(asset, df, below_mask, HORIZON)
        asset_results["test5_directional"] = test5_directional_adversarial(asset, df, below_mask, above_mask, HORIZON)
        asset_results["test6_path"] = test6_path_stability(asset, df, below_mask, HORIZON)
        
        # Asset-level pass/fail
        tests_passed = all(
            asset_results[k].get("passed", False) 
            for k in asset_results
        )
        asset_results["all_passed"] = tests_passed
        
        if not tests_passed:
            all_pass = False
        
        all_results[asset] = asset_results
    
    # ─── FINAL SUMMARY ───
    print(f"\n\n{'=' * 70}")
    print("STRESS TEST SUMMARY")
    print(f"{'=' * 70}")
    
    test_names = [
        ("test1_regime", "Regime Segmentation"),
        ("test2_clustering", "Event Clustering"),
        ("test3_delay", "Entry Delay Sensitivity"),
        ("test4_subsampling", "Subsampling Stability"),
        ("test5_directional", "Directional Adversarial"),
        ("test6_path", "Path Stability"),
    ]
    
    for asset in all_results:
        print(f"\n  {asset}:")
        for key, name in test_names:
            passed = all_results[asset].get(key, {}).get("passed", False)
            print(f"    {name:.<35} {'PASS ✓' if passed else 'FAIL ✗'}")
        
        all_asset_passed = all_results[asset].get("all_passed", False)
        print(f"    {'OVERALL':.<35} {'PASS ✓' if all_asset_passed else 'FAIL ✗'}")
    
    print(f"\n{'=' * 70}")
    print("FINAL DECISION")
    print(f"{'=' * 70}")
    
    assets_passing = [a for a in all_results if all_results[a].get("all_passed")]
    assets_failing = [a for a in all_results if not all_results[a].get("all_passed")]
    
    if all_pass and len(assets_passing) >= 2:
        print(f"\n  ╔══════════════════════════════════════════════════════════╗")
        print(f"  ║  CASE A: ROBUST EDGE                                   ║")
        print(f"  ║  Edge survives all stress tests on: {', '.join(assets_passing):<16} ║")
        print(f"  ║  Proceed to Phase 3/4 refinement                       ║")
        print(f"  ╚══════════════════════════════════════════════════════════╝")
        decision = "CASE_A"
    else:
        print(f"\n  ╔══════════════════════════════════════════════════════════╗")
        print(f"  ║  CASE B: FRAGILE / FALSE EDGE                          ║")
        if assets_failing:
            print(f"  ║  Failing assets: {', '.join(assets_failing):<37} ║")
        print(f"  ║  Edge does NOT survive stress testing                  ║")
        print(f"  ║  REJECT — return to Phase 2 (event redesign)           ║")
        print(f"  ╚══════════════════════════════════════════════════════════╝")
        decision = "CASE_B"
    
    # Save results
    output = {
        "decision": decision,
        "assets_passing": assets_passing,
        "assets_failing": assets_failing,
        "results": {asset: {k: v for k, v in res.items() if k != "all_passed"} 
                    for asset, res in all_results.items()}
    }
    
    with open(os.path.join(RESULTS_DIR, "stress_test_results.json"), "w") as f:
        json.dump(output, f, indent=2, default=str)
    
    return output


if __name__ == "__main__":
    run_all_stress_tests()
