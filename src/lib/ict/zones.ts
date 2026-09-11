// Fair Value Gaps (FVG / imbalance) and Order Blocks detection & mitigation.
import type { Candle, Zone } from "./types";

/**
 * OB invalidation rule — WHEN a tapped order block stops being tradable.
 * The engine ships with the ICT close-through-midpoint rule; the other
 * modes exist so the definition itself can be COMPARED on real data
 * (diagnostics found ~95% of OBs die to the default rule — that is a
 * modeling choice, not a law, and it is now measurable).
 */
export type ObInvalidation =
  | "close-mid" // a CLOSE beyond the zone midpoint (current default)
  | "wick-mid" // ANY trade beyond the midpoint (strictest)
  | "close-distal" // a CLOSE beyond the whole zone (classic strict ICT)
  | "wick-distal"; // ANY trade through the whole zone (loosest)

export const OB_INVALIDATION_LABELS: Record<ObInvalidation, string> = {
  "close-mid": "close beyond midpoint (default)",
  "wick-mid": "any trade beyond midpoint",
  "close-distal": "close beyond the full zone",
  "wick-distal": "any trade through the full zone",
};

/** Does this candle kill a BULLISH zone of the given kind under the rule? */
export function obInvalidated(
  z: Zone,
  c: { high: number; low: number; close: number },
  mode: ObInvalidation
): boolean {
  const mid = (z.top + z.bottom) / 2;
  if (z.direction === "BULLISH") {
    switch (mode) {
      case "wick-mid": return c.low < mid;
      case "close-distal": return c.close < z.bottom;
      case "wick-distal": return c.low <= z.bottom;
      default: return c.close < mid; // close-mid
    }
  }
  switch (mode) {
    case "wick-mid": return c.high > mid;
    case "close-distal": return c.close > z.top;
    case "wick-distal": return c.high >= z.top;
    default: return c.close > mid; // close-mid
  }
}

/**
 * Fair Value Gap — three-candle imbalance:
 *   Bullish: low[i] > high[i-2]  → gap between high[i-2] and low[i]
 *   Bearish: high[i] < low[i-2]  → gap between low[i-2] and high[i]
 * Mitigation: a later candle trading fully through the gap marks it mitigated.
 * NOTE: mitigation is computed over the WHOLE series — callers doing
 * walk-forward work must use `includeMitigated: true` and respect the
 * flag per-bar, otherwise they introduce look-ahead bias.
 */
export function detectFvg(candles: Candle[], maxZones = 8, includeMitigated = false): Zone[] {
  const zones: Zone[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];

    if (c.low > a.high) {
      zones.push({
        id: `fvg-b-${c.time}`,
        top: c.low,
        bottom: a.high,
        startTime: a.time,
        startIndex: i - 2,
        kind: "FVG",
        direction: "BULLISH",
        mitigated: false,
      });
    } else if (c.high < a.low) {
      zones.push({
        id: `fvg-s-${c.time}`,
        top: a.low,
        bottom: c.high,
        startTime: a.time,
        startIndex: i - 2,
        kind: "FVG",
        direction: "BEARISH",
        mitigated: false,
      });
    }
  }

  // mitigation check (conservative: candle range covers the whole gap)
  for (const z of zones) {
    for (let i = z.startIndex + 3; i < candles.length; i++) {
      const c = candles[i];
      if (z.direction === "BULLISH" && c.low <= z.bottom) {
        z.mitigated = true;
        break;
      }
      if (z.direction === "BEARISH" && c.high >= z.top) {
        z.mitigated = true;
        break;
      }
    }
  }

  const filtered = includeMitigated ? zones : zones.filter((z) => !z.mitigated);
  return filtered.slice(-maxZones);
}

/**
 * Order Blocks — the last opposing candle before a displacement move.
 *   Bullish OB: a down candle followed by an up candle whose body exceeds
 *   `displacementFactor × ATR` (institutional displacement).
 *   Bearish OB: mirrored.
 * Zone = the opposing candle's full range (wick to wick).
 *
 * Volatility reference is the PER-BAR ATR at the displacement candle (the
 * zone becomes knowable when that candle closes) — a single series-wide
 * scalar both misjudges regimes and subtly leaks future information.
 *
 * Invalidation: configurable via `mode` — default is a candle CLOSING
 * beyond the zone midpoint (ICT). A wick tap is the retest we want to
 * trade — under the default rule it must NOT kill the block.
 * Same look-ahead caveat as detectFvg — use includeMitigated for walk-forward.
 */
export function detectOrderBlocks(
  candles: Candle[],
  atrValues: number[] | number,
  displacementFactor = 1.2,
  maxZones = 6,
  includeMitigated = false,
  mode: ObInvalidation = "close-mid"
): Zone[] {
  const zones: Zone[] = [];
  const atrAt = (i: number) => (Array.isArray(atrValues) ? atrValues[i] : atrValues) ?? 0;

  for (let i = 1; i < candles.length - 1; i++) {
    const ob = candles[i];
    const next = candles[i + 1];
    const atrDisp = atrAt(i + 1) || atrAt(i);
    if (!(atrDisp > 0)) continue;
    const minBody = displacementFactor * atrDisp;
    const nextBody = Math.abs(next.close - next.open);
    if (nextBody < minBody) continue;

    const obBearish = ob.close < ob.open;
    const nextBullish = next.close > next.open;

    if (obBearish && nextBullish) {
      zones.push({
        id: `ob-b-${ob.time}`,
        top: ob.high,
        bottom: ob.low,
        startTime: ob.time,
        startIndex: i,
        kind: "OB",
        direction: "BULLISH",
        mitigated: false,
      });
    } else if (!obBearish && !nextBullish) {
      zones.push({
        id: `ob-s-${ob.time}`,
        top: ob.high,
        bottom: ob.low,
        startTime: ob.time,
        startIndex: i,
        kind: "OB",
        direction: "BEARISH",
        mitigated: false,
      });
    }
  }

  // invalidation: rule-configurable (default = CLOSE through the midpoint).
  for (const z of zones) {
    for (let i = z.startIndex + 2; i < candles.length; i++) {
      if (obInvalidated(z, candles[i], mode)) {
        z.mitigated = true;
        break;
      }
    }
  }

  const filtered = includeMitigated ? zones : zones.filter((z) => !z.mitigated);
  return filtered.slice(-maxZones);
}
