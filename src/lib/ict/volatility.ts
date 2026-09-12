// Rolling volatility measures and volatility-regime classification (spec #15).
// All series are causal: value at index i uses candles up to i only.
import type { Candle, VolatilityRegime } from "./types";

/** True Range at index i (needs i >= 1). */
export function trueRange(candles: Candle[], i: number): number {
  if (i <= 0) return candles[0].high - candles[0].low;
  const c = candles[i];
  const prev = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
}

/** Rolling ATR series (simple mean of TR over `period`). Value at i uses bars i-period+1..i. */
export function atrSeries(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += trueRange(candles, i);
    if (i >= period) sum -= trueRange(candles, i - period);
    out[i] = sum / Math.min(i + 1, period);
  }
  return out;
}

/**
 * Volatility regime from ATR as a percentage of price, compared against a
 * trailing empirical distribution (percentile bands over `window` bars).
 *   < 20th percentile → LOW, 20–80 → NORMAL, 80–95 → HIGH, > 95 → EXTREME
 * Causal: the reference distribution only uses ATR values up to i-1.
 *
 * The reference window is kept as a ROLLING SORTED array (binary-search
 * insert/evict) instead of slice+sort per bar — identical percentiles,
 * O(window) memmove per bar instead of O(window log window) sort.
 */
export function volRegimeSeries(
  candles: Candle[],
  atr: number[],
  window = 200
): VolatilityRegime[] {
  const out = new Array<VolatilityRegime>(candles.length).fill("NORMAL");
  const pct: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) pct[i] = candles[i].close > 0 ? atr[i] / candles[i].close : 0;

  const sorted: number[] = []; // ascending; holds pct[i-window .. i-1]
  const insert = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    sorted.splice(lo, 0, v);
  };
  const remove = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    // v is always present (it was inserted window steps ago)
    if (lo < sorted.length && sorted[lo] === v) sorted.splice(lo, 1);
    else {
      const idx = sorted.indexOf(v);
      if (idx !== -1) sorted.splice(idx, 1);
    }
  };
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  for (let i = 0; i < candles.length; i++) {
    // transition window to [max(0, i-window), i-1]
    if (i >= 1) insert(pct[i - 1]);
    const evictIdx = i - 1 - window;
    if (evictIdx >= 0) remove(pct[evictIdx]);
    if (i >= 30 && sorted.length > 0) {
      const p20 = q(0.2);
      const p80 = q(0.8);
      const p95 = q(0.95);
      out[i] = pct[i] < p20 ? "LOW" : pct[i] < p80 ? "NORMAL" : pct[i] < p95 ? "HIGH" : "EXTREME";
    }
  }
  return out;
}
