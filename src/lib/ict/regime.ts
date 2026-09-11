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

  for (let i = 0; i < n; i++) {
    while (evIdx < structureEvents.length && structureEvents[evIdx].index <= i) {
      const dir = structureEvents[evIdx].direction === "BULLISH" ? 1 : -1;
      if (dir !== trendDir && trendDir !== 0) flips++;
      trendDir = dir;
      evIdx++;
    }

    const start = Math.max(0, i - lookback + 1);
    const seg = candles.slice(start, i + 1);
    const netMove = Math.abs(seg[seg.length - 1].close - seg[0].open);
    let path = 0;
    for (let k = start + 1; k <= i; k++) path += Math.abs(candles[k].close - candles[k - 1].close);
    // efficiency ratio: net displacement / total path (Kaufman ER)
    const er = path > 0 ? netMove / path : 0;

    const atrPct = candles[i].close > 0 ? atr[i] / candles[i].close : 0;
    // expanding if current ATR% well above its trailing median
    const refStart = Math.max(0, i - 200);
    const refSlice = atr.slice(refStart, i).map((a, idx) => (candles[refStart + idx].close > 0 ? a / candles[refStart + idx].close : 0));
    const refSorted = [...refSlice].sort((a, b) => a - b);
    const medianAtrPct = refSorted.length ? refSorted[Math.floor(refSorted.length / 2)] : atrPct;
    const expansion = medianAtrPct > 0 && atrPct > medianAtrPct * 1.6;
    const contraction = medianAtrPct > 0 && atrPct < medianAtrPct * 0.6;

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
