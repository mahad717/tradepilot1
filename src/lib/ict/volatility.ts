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
 */
export function volRegimeSeries(
  candles: Candle[],
  atr: number[],
  window = 200
): VolatilityRegime[] {
  const out = new Array<VolatilityRegime>(candles.length).fill("NORMAL");
  const pctHistory: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const pct = candles[i].close > 0 ? atr[i] / candles[i].close : 0;
    if (i >= 30) {
      const ref = pctHistory.slice(-window);
      ref.sort((a, b) => a - b);
      const q = (p: number) => ref[Math.min(ref.length - 1, Math.floor(p * ref.length))];
      const p20 = q(0.2);
      const p80 = q(0.8);
      const p95 = q(0.95);
      out[i] = pct < p20 ? "LOW" : pct < p80 ? "NORMAL" : pct < p95 ? "HIGH" : "EXTREME";
    }
    pctHistory.push(pct);
  }
  return out;
}
