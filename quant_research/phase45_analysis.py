"""
PHASE 4: TIME / LIFECYCLE MODELING
PHASE 5: LOSS FORENSICS
+ REFINED DIRECTIONAL ANALYSIS (below-VWAP vs above-VWAP)
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

def run_phase45():
    """Phase 4+5 analysis for VWAP deviation 2% below-VWAP edge."""
    
    # Test horizons: 1h through 24h in 15m increments
    horizons_15m = list(range(4, 97, 4))  # 1h to 24h in 1h steps (in 15m bars)
    
    results = {}
    
    for asset in ["BTC", "SOL", "XRP"]:
        print(f"\n{'='*70}")
        print(f"PHASE 4+5: {asset} — VWAP Dev 2% (BELOW VWAP ONLY)")
        print(f"{'='*70}")
        
        df = load_data(asset, "15m")
        vwap = compute_vwap(df, lookback=24)
        close = df["close"].values
        highs = df["high"].values
        lows = df["low"].values
        n = len(df)
        
        # Events: price BELOW VWAP by >2%
        valid = ~np.isnan(vwap) & (vwap > 0)
        event_mask = np.zeros(n, dtype=bool)
        event_mask[valid] = (vwap[valid] - close[valid]) / vwap[valid] > 0.02
        
        event_indices = np.where(event_mask)[0]
        print(f"  Events (below VWAP >2%): {len(event_indices)}")
        
        # === PHASE 4: Edge Decay / Optimal Horizon ===
        print(f"\n  --- Phase 4: Edge Decay ---")
        
        horizon_stats = []
        for h in horizons_15m:
            fwd_ret = np.full(n, np.nan)
            if h < n:
                fwd_ret[:n-h] = (close[h:] - close[:n-h]) / close[:n-h]
            
            event_returns = fwd_ret[event_mask]
            event_returns = event_returns[~np.isnan(event_returns)]
            
            if len(event_returns) < 30:
                continue
            
            t_stat, t_pval = stats.ttest_1samp(event_returns, 0)
            
            horizon_stats.append({
                "horizon_15m": h,
                "horizon_hours": h * 0.25,
                "n": len(event_returns),
                "mean": float(np.mean(event_returns)),
                "median": float(np.median(event_returns)),
                "std": float(np.std(event_returns)),
                "pct_positive": float(np.mean(event_returns > 0) * 100),
                "t_stat": float(t_stat),
                "t_pval": float(t_pval),
                "significant": t_pval < 0.05,
                "sharpe_approx": float(np.mean(event_returns) / np.std(event_returns)) if np.std(event_returns) > 0 else 0,
            })
        
        # Print decay curve
        print(f"    {'Horizon':>8} {'Mean%':>8} {'Median%':>8} {'Pos%':>6} {'t-stat':>7} {'Sig':>4} {'Sharpe':>7}")
        for hs in horizon_stats:
            marker = "✓" if hs["significant"] else " "
            print(f"    {hs['horizon_hours']:>6.1f}h {hs['mean']*100:>+7.3f}% {hs['median']*100:>+7.3f}% "
                  f"{hs['pct_positive']:>5.1f}% {hs['t_stat']:>+6.2f} {marker:>3} {hs['sharpe_approx']:>+6.3f}")
        
        # Find optimal horizon (highest t-stat * sharpe)
        if horizon_stats:
            best = max(horizon_stats, key=lambda x: abs(x["t_stat"]) * abs(x["sharpe_approx"]))
            print(f"\n    Optimal horizon: {best['horizon_hours']:.1f}h "
                  f"(t={best['t_stat']:.2f}, sharpe={best['sharpe_approx']:.3f})")
        
        # === PATH BEHAVIOR ===
        print(f"\n  --- Path Behavior ---")
        
        # Time to MFE / MAE
        test_h = best["horizon_15m"] if horizon_stats else 24
        
        times_to_mfe = []
        times_to_mae = []
        first_touch = []  # did MFE come before MAE?
        
        for idx in event_indices:
            if idx + test_h >= n:
                continue
            entry = close[idx]
            fwd_highs = highs[idx+1:idx+1+test_h]
            fwd_lows = lows[idx+1:idx+1+test_h]
            
            mfe_idx = np.argmax(fwd_highs)
            mae_idx = np.argmin(fwd_lows)
            
            times_to_mfe.append(mfe_idx + 1)
            times_to_mae.append(mae_idx + 1)
            first_touch.append(1 if mfe_idx < mae_idx else 0)
        
        if times_to_mfe:
            print(f"    Mean time to MFE: {np.mean(times_to_mfe):.1f} bars ({np.mean(times_to_mfe)*15:.0f} min)")
            print(f"    Mean time to MAE: {np.mean(times_to_mae):.1f} bars ({np.mean(times_to_mae)*15:.0f} min)")
            print(f"    MFE before MAE: {np.mean(first_touch)*100:.1f}%")
        
        # === PHASE 5: LOSS FORENSICS ===
        print(f"\n  --- Phase 5: Loss Forensics ---")
        
        # Worst 10% of outcomes
        fwd_ret_full = np.full(n, np.nan)
        if test_h < n:
            fwd_ret_full[:n-test_h] = (close[test_h:] - close[:n-test_h]) / close[:n-test_h]
        
        event_returns_full = fwd_ret_full[event_mask]
        valid_returns = event_returns_full[~np.isnan(event_returns_full)]
        
        p10_threshold = np.percentile(valid_returns, 10)
        worst_10pct = valid_returns[valid_returns <= p10_threshold]
        
        print(f"    Worst 10% threshold: {p10_threshold*100:.2f}%")
        print(f"    Worst 10% mean: {np.mean(worst_10pct)*100:.2f}%")
        print(f"    Worst 10% max: {np.max(worst_10pct)*100:.2f}%")
        
        # Worst single outcomes
        sorted_returns = np.sort(valid_returns)
        print(f"    Worst 5 outcomes: {', '.join(f'{r*100:.2f}%' for r in sorted_returns[:5])}")
        
        # Check if worst outcomes cluster in time
        worst_indices = np.argsort(valid_returns)[:int(len(valid_returns)*0.1)]
        
        # Anti-edge conditions: what market state preceded worst outcomes?
        # Check volatility at event time for worst vs best outcomes
        atr_period = 14
        tr = np.concatenate([[np.nan], np.maximum(
            np.diff(highs), 
            np.maximum(np.abs(highs[1:] - close[:-1]), np.abs(lows[1:] - close[:-1]))
        )])
        atr = pd.Series(tr).rolling(atr_period).mean().values
        
        event_atrs = atr[event_indices]
        event_atrs = event_atrs[~np.isnan(event_atrs)]
        
        if len(event_atrs) > 0:
            # Split into good and bad outcomes
            valid_event_mask = event_mask.copy()
            valid_event_indices = np.where(valid_event_mask)[0]
            
            # Need to match up event indices with returns
            matched_indices = []
            matched_returns = []
            matched_atrs = []
            
            for i, idx in enumerate(valid_event_indices):
                if idx + test_h < n and not np.isnan(fwd_ret_full[idx]):
                    matched_indices.append(idx)
                    matched_returns.append(fwd_ret_full[idx])
                    matched_atrs.append(atr[idx] if not np.isnan(atr[idx]) else np.nan)
            
            matched_returns = np.array(matched_returns)
            matched_atrs = np.array(matched_atrs)
            
            valid_atr_mask = ~np.isnan(matched_atrs)
            if np.sum(valid_atr_mask) > 50:
                # Correlation between ATR at event and outcome
                corr = np.corrcoef(matched_atrs[valid_atr_mask], matched_returns[valid_atr_mask])[0, 1]
                print(f"\n    ATR-Return correlation: {corr:.3f}")
                
                # Split by ATR tercile
                terciles = np.percentile(matched_atrs[valid_atr_mask], [33, 67])
                low_vol = matched_returns[valid_atr_mask & (matched_atrs <= terciles[0])]
                mid_vol = matched_returns[valid_atr_mask & (matched_atrs > terciles[0]) & (matched_atrs <= terciles[1])]
                high_vol = matched_returns[valid_atr_mask & (matched_atrs > terciles[1])]
                
                print(f"    Low vol regime: mean={np.mean(low_vol)*100:+.3f}% pos={np.mean(low_vol>0)*100:.1f}%")
                print(f"    Mid vol regime:  mean={np.mean(mid_vol)*100:+.3f}% pos={np.mean(mid_vol>0)*100:.1f}%")
                print(f"    High vol regime: mean={np.mean(high_vol)*100:+.3f}% pos={np.mean(high_vol>0)*100:.1f}%")
        
        # Store results
        results[asset] = {
            "n_events": len(event_indices),
            "horizon_decay": horizon_stats,
            "best_horizon": best if horizon_stats else None,
            "path_behavior": {
                "mean_time_to_mfe": float(np.mean(times_to_mfe)) if times_to_mfe else None,
                "mean_time_to_mae": float(np.mean(times_to_mae)) if times_to_mae else None,
                "mfe_before_mae_pct": float(np.mean(first_touch)*100) if first_touch else None,
            },
            "loss_forensics": {
                "worst_10pct_threshold": float(p10_threshold),
                "worst_10pct_mean": float(np.mean(worst_10pct)),
                "worst_5_outcomes": [float(r) for r in sorted_returns[:5]],
            }
        }
    
    # === DECISION GATE ===
    print(f"\n\n{'='*70}")
    print("PHASE 6: DECISION GATE")
    print(f"{'='*70}")
    
    for asset, r in results.items():
        best = r.get("best_horizon")
        if not best:
            print(f"\n  {asset}: NO DATA")
            continue
        
        path = r["path_behavior"]
        loss = r["loss_forensics"]
        
        print(f"\n  {asset}:")
        print(f"    Events: {r['n_events']}")
        print(f"    Best horizon: {best['horizon_hours']:.1f}h")
        print(f"    Mean return: {best['mean']*100:+.4f}%")
        print(f"    Win rate: {best['pct_positive']:.1f}%")
        print(f"    t-stat: {best['t_stat']:.2f}")
        print(f"    Sharpe: {best['sharpe_approx']:.3f}")
        print(f"    MFE before MAE: {path['mfe_before_mae_pct']:.1f}%")
        print(f"    Worst 10% mean: {loss['worst_10pct_mean']*100:.2f}%")
        
        # Decision
        issues = []
        if best["pct_positive"] < 52:
            issues.append(f"Win rate {best['pct_positive']:.1f}% barely above random")
        if best["mean"] < 0.003:
            issues.append(f"Mean return {best['mean']*100:.3f}% too small after fees")
        if path["mfe_before_mae_pct"] < 55:
            issues.append(f"MFE before MAE only {path['mfe_before_mae_pct']:.1f}% — difficult to capture")
        
        if not issues:
            print(f"    → ✓ EDGE EXISTS AND IS POTENTIALLY TRADEABLE")
        else:
            print(f"    → ⚠️ EDGE EXISTS BUT TRADEABILITY CONCERNS:")
            for issue in issues:
                print(f"      • {issue}")
    
    # Save
    with open(os.path.join(RESULTS_DIR, "phase45_analysis.json"), "w") as f:
        json.dump(results, f, indent=2, default=str)

if __name__ == "__main__":
    run_phase45()
