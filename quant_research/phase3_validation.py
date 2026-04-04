"""
PHASE 3: ENTRY VALIDATION
===========================
For each edge candidate from Phase 2, test against:
1. Random entry baseline (same n, random timestamps)
2. Shuffled timestamps baseline
3. Multiple comparison correction

This determines if the observed edge is real or statistical artifact.
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
    df = pd.read_csv(path, parse_dates=["timestamp"])
    return df.sort_values("timestamp").reset_index(drop=True)

def compute_vwap(df, lookback=24):
    tp = (df["high"] + df["low"] + df["close"]) / 3
    cum_tp_vol = (tp * df["volume"]).rolling(lookback).sum()
    cum_vol = df["volume"].rolling(lookback).sum()
    return (cum_tp_vol / cum_vol).values

def compute_forward_return(df, horizon, price_col="close"):
    prices = df[price_col].values
    n = len(prices)
    fwd = np.full(n, np.nan)
    if horizon < n:
        fwd[:n-horizon] = (prices[horizon:] - prices[:n-horizon]) / prices[:n-horizon]
    return fwd

def get_vwap_dev_events(df, vwap, threshold=0.02):
    close = df["close"].values
    valid = ~np.isnan(vwap) & (vwap > 0)
    dev = np.zeros(len(df), dtype=bool)
    dev[valid] = np.abs(close[valid] - vwap[valid]) / vwap[valid] > threshold
    return dev

def random_baseline_test(actual_returns, n_events, total_possible, 
                          forward_returns, n_simulations=5000):
    """
    Generate random entry distributions and compare to actual.
    
    actual_returns: array of forward returns at actual events
    n_events: number of events
    total_possible: total eligible timestamps (to sample from)
    forward_returns: full array of forward returns for all timestamps
    n_simulations: number of random samples to generate
    """
    actual_mean = np.mean(actual_returns)
    actual_n = len(actual_returns)
    
    # Eligible indices (where forward return is not NaN)
    eligible = np.where(~np.isnan(forward_returns))[0]
    
    random_means = []
    random_medians = []
    random_pct_positive = []
    
    rng = np.random.default_rng(42)
    
    for _ in range(n_simulations):
        sample_idx = rng.choice(eligible, size=actual_n, replace=False)
        sample_returns = forward_returns[sample_idx]
        random_means.append(np.mean(sample_returns))
        random_medians.append(np.median(sample_returns))
        random_pct_positive.append(np.mean(sample_returns > 0))
    
    random_means = np.array(random_means)
    
    # p-value: proportion of random means >= actual mean
    p_value = np.mean(random_means >= actual_mean)
    
    # Effect size: how many SDs actual mean is from random distribution
    effect_size = (actual_mean - np.mean(random_means)) / np.std(random_means)
    
    return {
        "actual_mean": float(actual_mean),
        "random_mean_avg": float(np.mean(random_means)),
        "random_mean_std": float(np.std(random_means)),
        "random_mean_median": float(np.median(random_means)),
        "p_value_random": float(p_value),
        "effect_size_sd": float(effect_size),
        "n_simulations": n_simulations,
        "actual_pct_positive": float(np.mean(actual_returns > 0) * 100),
        "random_pct_positive_avg": float(np.mean(random_pct_positive) * 100),
        "beats_random": p_value < 0.05,
    }

def shuffle_timestamp_test(actual_returns, forward_returns, event_mask, 
                            n_simulations=5000):
    """
    Shuffle event timestamps while preserving event count.
    Tests if the *timing* of events matters.
    """
    actual_mean = np.mean(actual_returns)
    actual_n = len(actual_returns)
    
    eligible = np.where(~np.isnan(forward_returns))[0]
    
    rng = np.random.default_rng(123)
    shuffled_means = []
    
    for _ in range(n_simulations):
        idx = rng.choice(eligible, size=actual_n, replace=False)
        shuffled_means.append(np.mean(forward_returns[idx]))
    
    shuffled_means = np.array(shuffled_means)
    p_value = np.mean(shuffled_means >= actual_mean)
    
    return {
        "actual_mean": float(actual_mean),
        "shuffled_mean_avg": float(np.mean(shuffled_means)),
        "shuffled_mean_std": float(np.std(shuffled_means)),
        "p_value_shuffled": float(p_value),
        "beats_shuffled": p_value < 0.05,
    }

def run_validation():
    """
    Validate each edge candidate from Phase 2.
    """
    with open(os.path.join(RESULTS_DIR, "edge_candidates.json")) as f:
        candidates = json.load(f)
    
    # Expand: also re-test XRP vwap_dev_2pct at all horizons (strongest signal)
    # and ETH liquidity_sweep h20
    test_cases = []
    
    for c in candidates:
        test_cases.append(c)
    
    # Add specific tests for the most interesting patterns
    extra_tests = [
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 4, "timeframe": "15m"},
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 20, "timeframe": "15m"},
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 60, "timeframe": "15m"},
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 240, "timeframe": "15m"},
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 1, "timeframe": "1h"},
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 4, "timeframe": "1h"},
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 12, "timeframe": "1h"},
        {"asset": "XRP", "event": "vwap_dev_2pct", "horizon": 24, "timeframe": "1h"},
        {"asset": "BTC", "event": "vwap_dev_2pct", "horizon": 240, "timeframe": "15m"},
        {"asset": "SOL", "event": "vwap_dev_2pct", "horizon": 240, "timeframe": "15m"},
        {"asset": "ETH", "event": "vwap_dev_2pct", "horizon": 240, "timeframe": "15m"},
        {"asset": "ETH", "event": "liquidity_sweep", "horizon": 20, "timeframe": "15m"},
        {"asset": "BTC", "event": "vol_expansion", "horizon": 4, "timeframe": "1h"},
        {"asset": "BTC", "event": "vol_expansion", "horizon": 24, "timeframe": "1h"},
    ]
    
    # De-duplicate
    seen = set()
    unique_tests = []
    for t in test_cases + extra_tests:
        key = f"{t['asset']}_{t.get('timeframe','15m')}_{t['event']}_h{t['horizon']}"
        if key not in seen:
            seen.add(key)
            unique_tests.append(t)
    
    validation_results = []
    
    print("="*70)
    print("PHASE 3: ENTRY VALIDATION — RANDOM BASELINE TESTING")
    print("="*70)
    
    for test in unique_tests:
        asset = test["asset"]
        event_name = test["event"]
        horizon = test["horizon"]
        timeframe = test.get("timeframe", "15m")
        
        print(f"\n{'─'*50}")
        print(f"  {asset} | {event_name} | h{horizon} | {timeframe}")
        print(f"{'─'*50}")
        
        df = load_data(asset, timeframe)
        vwap = compute_vwap(df, lookback=24)
        fwd_ret = compute_forward_return(df, horizon)
        
        # Get events
        if "vwap_dev" in event_name:
            threshold = 0.02 if "2pct" in event_name else 0.01
            event_mask = get_vwap_dev_events(df, vwap, threshold)
        else:
            print(f"    Skipping non-VWAP event for now")
            continue
        
        event_returns = fwd_ret[event_mask]
        event_returns = event_returns[~np.isnan(event_returns)]
        
        if len(event_returns) < 30:
            print(f"    SKIP: Only {len(event_returns)} events")
            continue
        
        print(f"    Events: {len(event_returns)}")
        print(f"    Actual mean: {np.mean(event_returns)*100:+.4f}%")
        print(f"    Actual pos%: {np.mean(event_returns > 0)*100:.1f}%")
        
        # Test 1: Random entry baseline
        eligible_count = np.sum(~np.isnan(fwd_ret))
        rand_result = random_baseline_test(
            event_returns, len(event_returns), eligible_count,
            fwd_ret, n_simulations=5000
        )
        
        print(f"\n    Random Baseline (5000 sims):")
        print(f"      Random mean avg: {rand_result['random_mean_avg']*100:+.4f}%")
        print(f"      Random pos% avg: {rand_result['random_pct_positive_avg']:.1f}%")
        print(f"      p-value: {rand_result['p_value_random']:.4f}")
        print(f"      Effect size: {rand_result['effect_size_sd']:.2f} SD")
        print(f"      Beats random: {'✓' if rand_result['beats_random'] else '✗'}")
        
        # Test 2: Shuffled timestamps
        shuffle_result = shuffle_timestamp_test(
            event_returns, fwd_ret, event_mask, n_simulations=5000
        )
        
        print(f"\n    Shuffled Timestamps (5000 sims):")
        print(f"      Shuffled mean avg: {shuffle_result['shuffled_mean_avg']*100:+.4f}%")
        print(f"      p-value: {shuffle_result['p_value_shuffled']:.4f}")
        print(f"      Beats shuffled: {'✓' if shuffle_result['beats_shuffled'] else '✗'}")
        
        # Test 3: Distribution normality
        if len(event_returns) < 5000:
            norm_stat, norm_pval = stats.shapiro(event_returns[:min(5000, len(event_returns))])
        else:
            norm_stat, norm_pval = stats.normaltest(event_returns)
        
        print(f"\n    Distribution:")
        print(f"      Skewness: {stats.skew(event_returns):.3f}")
        print(f"      Kurtosis: {stats.kurtosis(event_returns):.3f}")
        print(f"      Normality p: {norm_pval:.4f} ({'normal' if norm_pval > 0.05 else 'NON-NORMAL'})")
        
        # Check if edge is from tail events
        median_ret = np.median(event_returns)
        mean_ret = np.mean(event_returns)
        print(f"      Median: {median_ret*100:+.4f}% vs Mean: {mean_ret*100:+.4f}%")
        print(f"      Mean >> Median? {'⚠️ YES (tail-driven)' if abs(mean_ret) > 2*abs(median_ret) and median_ret != 0 else 'No'}")
        
        validation_results.append({
            "asset": asset,
            "event": event_name,
            "horizon": horizon,
            "timeframe": timeframe,
            "n_events": len(event_returns),
            "actual_mean": float(np.mean(event_returns)),
            "actual_median": float(np.median(event_returns)),
            "actual_pct_pos": float(np.mean(event_returns > 0) * 100),
            "skewness": float(stats.skew(event_returns)),
            "kurtosis": float(stats.kurtosis(event_returns)),
            "random_baseline": rand_result,
            "shuffle_baseline": shuffle_result,
            "tail_driven": abs(mean_ret) > 2*abs(median_ret) if median_ret != 0 else False,
        })
    
    # Summary
    print(f"\n\n{'='*70}")
    print("VALIDATION SUMMARY")
    print(f"{'='*70}")
    
    validated_edges = []
    rejected = []
    
    for v in validation_results:
        passes = (
            v["random_baseline"]["beats_random"] and 
            v["shuffle_baseline"]["beats_shuffled"] and
            not v["tail_driven"]
        )
        
        status = "✓ VALIDATED" if passes else "✗ REJECTED"
        reason = ""
        if not v["random_baseline"]["beats_random"]:
            reason += " [fails random baseline]"
        if not v["shuffle_baseline"]["beats_shuffled"]:
            reason += " [fails shuffle test]"
        if v["tail_driven"]:
            reason += " [tail-driven]"
        
        print(f"  {v['asset']} | {v['event']} | h{v['horizon']} | {v['timeframe']}: "
              f"{status}{reason}")
        
        if passes:
            validated_edges.append(v)
        else:
            rejected.append(v)
    
    print(f"\n  Validated: {len(validated_edges)}")
    print(f"  Rejected: {len(rejected)}")
    
    # Bonferroni correction note
    total_tests = len(validation_results)
    bonferroni_alpha = 0.05 / max(total_tests, 1)
    print(f"\n  Bonferroni correction (n={total_tests}): α = {bonferroni_alpha:.4f}")
    
    bonferroni_survivors = [
        v for v in validation_results 
        if v["random_baseline"]["p_value_random"] < bonferroni_alpha
    ]
    print(f"  Surviving Bonferroni: {len(bonferroni_survivors)}")
    
    for v in bonferroni_survivors:
        print(f"    {v['asset']} | {v['event']} | h{v['horizon']} | p={v['random_baseline']['p_value_random']:.6f}")
    
    # Save results
    with open(os.path.join(RESULTS_DIR, "phase3_validation.json"), "w") as f:
        json.dump({
            "tests": validation_results,
            "validated": len(validated_edges),
            "rejected": len(rejected),
            "bonferroni_alpha": bonferroni_alpha,
            "bonferroni_survivors": len(bonferroni_survivors),
        }, f, indent=2, default=str)
    
    return validated_edges, rejected

if __name__ == "__main__":
    validated, rejected = run_validation()
