// Market-regime classification (spec #16).
//
// TREND_UP / TREND_DOWN — structure walk agrees with directional efficiency
// RANGE               — structure flipping frequently, low net displacement
// EXPANSION           — volatility (ATR%) in the top decile and directional
// CONSOLIDATION       — volatility in the bottom decile, no net displacement
// UNCLEAR             — everything else that fails the tests above → NO TRADE
//
// All measures are causal (trailing windows only).
import type { Candle, MarketRegime, StructureEvent, VolatilityRegime } from "./types";

export interface RegimeSeries {
  regimeAt: (i: number) => MarketRegime;
  regimeCounts: () => Record<MarketRegime, number>;
}

export function marketRegimeSeries(
  candles: Candle[],
  structureEvents: StructureEvent[],
  atr: number[],
  lookback = 60
): RegimeSeries {
  const n = candles.length;
  const regimes = new Array<MarketRegime>(n).fill("UNCLEAR");

  // index of the latest structure event confirmed at each bar is implicit:
  // events are causal (confirmed pivots only), so scanning is safe.
  let evIdx = 0;
  let trendDir = 0; // -1 bearish, +1 bullish, 0 neutral
  let flips = 0;
  let lastFlipIndex = -1000;

  // Rolling Kaufman path: path(i) = Σ |close[k]−close[k−1]| for k in [start+1, i],
  // start = max(0, i−lookback+1). Updated incrementally (add right edge,
  // drop left edge) — identical value, no per-bar slice/loop.
  let path = 0;
  // Rolling sorted window of trailing ATR% (atr[j]/close[j], j in
  // [max(0, i−200), i−1]) for the expansion/contraction median — identical
  // median, no per-bar slice+map+sort.
  const refWindow = 200;
  const atrPct: number[] = new Array(n);
  for (let i = 0; i < n; i++) atrPct[i] = candles[i].close > 0 ? atr[i] / candles[i].close : 0;
  const sorted: number[] = [];
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
    if (lo < sorted.length && sorted[lo] === v) sorted.splice(lo, 1);
    else {
      const idx = sorted.indexOf(v);
      if (idx !== -1) sorted.splice(idx, 1);
    }
  };

  for (let i = 0; i < n; i++) {
    while (evIdx < structureEvents.length && structureEvents[evIdx].index <= i) {
      const dir = structureEvents[evIdx].direction === "BULLISH" ? 1 : -1;
      if (dir !== trendDir && trendDir !== 0) flips++;
      trendDir = dir;
      evIdx++;
    }

    const start = Math.max(0, i - lookback + 1);
    // incremental path maintenance
    if (i >= 1) path += Math.abs(candles[i].close - candles[i - 1].close);
    if (start >= 1) path -= Math.abs(candles[start].close - candles[start - 1].close);
    const netMove = Math.abs(candles[i].close - candles[start].open);
    // efficiency ratio: net displacement / total path (Kaufman ER)
    const er = path > 0 ? netMove / path : 0;

    const atrPctI = atrPct[i];
    // expansion/contraction reference: ATR% over [max(0, i−200), i−1]
    if (i >= 1) insert(atrPct[i - 1]);
    const evictIdx = i - 1 - refWindow;
    if (evictIdx >= 0) remove(atrPct[evictIdx]);
    const medianAtrPct = sorted.length ? sorted[Math.floor(sorted.length / 2)] : atrPctI;
    const expansion = medianAtrPct > 0 && atrPctI > medianAtrPct * 1.6;
    const contraction = medianAtrPct > 0 && atrPctI < medianAtrPct * 0.6;

    const recentFlip = i - lastFlipIndex < lookback / 2;

    if (trendDir === 0) {
      regimes[i] = "UNCLEAR";
    } else if (recentFlip && er < 0.25) {
      // structure keeps flipping without directional follow-through
      regimes[i] = "RANGE";
    } else if (expansion && er >= 0.35) {
      regimes[i] = "EXPANSION";
    } else if (trendDir === 1 && er >= 0.3) {
      regimes[i] = "TREND_UP";
    } else if (trendDir === -1 && er >= 0.3) {
      regimes[i] = "TREND_DOWN";
    } else if (contraction && er < 0.2) {
      regimes[i] = "CONSOLIDATION";
    } else if (er < 0.15) {
      regimes[i] = "RANGE";
    } else {
      regimes[i] = "UNCLEAR";
    }
    void flips; // flips tracked for potential diagnostics
  }

  const counts = {} as Record<MarketRegime, number>;
  for (const r of regimes) counts[r] = (counts[r] ?? 0) + 1;

  return {
    regimeAt: (i: number) => regimes[Math.min(i, n - 1)],
    regimeCounts: () => counts,
  };
}
