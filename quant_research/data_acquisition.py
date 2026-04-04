"""
Data Acquisition Module
Fetches historical OHLCV from Binance public API (no auth required).
Rate-limited to respect API limits. Uses CSV for storage.
"""

import requests
import pandas as pd
import time
import os
import json
from datetime import datetime, timezone, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "raw_data")
os.makedirs(DATA_DIR, exist_ok=True)

SYMBOLS = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "SOL": "SOLUSDT",
    "XRP": "XRPUSDT",
}

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"

def fetch_klines(symbol, interval="1m", start_ms=None, end_ms=None, limit=1000):
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    if start_ms: params["startTime"] = start_ms
    if end_ms: params["endTime"] = end_ms
    resp = requests.get(BINANCE_KLINES_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()

def klines_to_df(klines):
    df = pd.DataFrame(klines, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades", "taker_buy_base",
        "taker_buy_quote", "ignore"
    ])
    df["timestamp"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    for col in ["open", "high", "low", "close", "volume", "quote_volume"]:
        df[col] = df[col].astype(float)
    df["trades"] = df["trades"].astype(int)
    return df[["timestamp", "open", "high", "low", "close", "volume", "quote_volume", "trades"]]

def fetch_full_history(symbol_binance, interval="1m", months_back=18):
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = now_ms - (months_back * 30 * 24 * 60 * 60 * 1000)
    
    all_klines = []
    current_start = start_ms
    
    while current_start < now_ms:
        try:
            batch = fetch_klines(symbol_binance, interval, start_ms=current_start, limit=1000)
        except Exception as e:
            print(f"  Error: {e}")
            time.sleep(5)
            continue
        if not batch:
            break
        all_klines.extend(batch)
        current_start = batch[-1][0] + 1
        if len(all_klines) % 10000 == 0:
            print(f"  {len(all_klines)} candles...")
        time.sleep(0.08)
    
    if not all_klines:
        return pd.DataFrame()
    df = klines_to_df(all_klines)
    df = df.drop_duplicates(subset="timestamp").sort_values("timestamp").reset_index(drop=True)
    return df

def fetch_all_assets():
    intervals = {"1m": 1, "5m": 6, "15m": 12, "1h": 18}
    manifest = {}
    
    for asset, binance_sym in SYMBOLS.items():
        print(f"\n{'='*50}")
        print(f"Fetching {asset} ({binance_sym})")
        print(f"{'='*50}")
        
        asset_dir = os.path.join(DATA_DIR, asset)
        os.makedirs(asset_dir, exist_ok=True)
        
        for interval, months in intervals.items():
            filepath = os.path.join(asset_dir, f"{interval}.csv")
            if os.path.exists(filepath):
                existing = pd.read_csv(filepath, nrows=1)
                print(f"  {interval} exists, skipping")
                continue
                
            print(f"\n  {interval} ({months}m back)...")
            df = fetch_full_history(binance_sym, interval, months)
            
            if len(df) == 0:
                print(f"  WARNING: No data")
                continue
            
            df.to_csv(filepath, index=False)
            
            manifest[f"{asset}_{interval}"] = {
                "rows": len(df),
                "start": str(df["timestamp"].min()),
                "end": str(df["timestamp"].max()),
                "interval": interval,
                "asset": asset,
            }
            print(f"  {len(df):,} rows: {df['timestamp'].min()} -> {df['timestamp'].max()}")
    
    with open(os.path.join(DATA_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    
    print(f"\n{'='*50}")
    print("DATA ACQUISITION COMPLETE")
    print(f"{'='*50}")
    for key, info in manifest.items():
        print(f"  {key}: {info['rows']:,} rows | {info['start'][:10]} -> {info['end'][:10]}")
    return manifest

if __name__ == "__main__":
    fetch_all_assets()
