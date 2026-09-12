// Fair Value Gaps (FVG / imbalance) and Order Blocks detection & mitigation.
import type { Candle, Zone } from "./types";

/**
 * First-index range queries over a price series, answered in O(log n) via a
 * sparse table. The mitigation scans below used to walk every candle for
 * EVERY zone (O(zones × bars) — tens of millions of iterations on deep
 * windows, the reason 15000-bar runs flirt with Worker CPU limits). The
 * query replaces the linear scan: "first index ≥ from whose value satisfies
 * the same strict/non-strict comparison" — identical result by construction
 * (the qualifying prefix of the range-extreme is monotone), pinned by
 * validate.ts test 23 (randomized equivalence vs the linear scan).
 */
class RangeExtreme {
  private n: number;
  private sparse: Float64Array[] = [];
  constructor(
    private vals: number[],
    private maximize: boolean
  ) {
    this.n = vals.length;
    if (this.n === 0) return;
    const levels = Math.floor(Math.log2(this.n)) + 1;
    // Float64Array rows: packed doubles, no per-element boxing — at 15k bars
    // a table is n·log2(n) numbers ×4 tables per build, so the representation
    // decides whether the deep path fits a Worker isolate comfortably.
    this.sparse = [Float64Array.from(vals)];
    for (let k = 1; k < levels; k++) {
      const len = this.n - (1 << k) + 1;
      const prev = this.sparse[k - 1];
      const row = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        row[i] = maximize
          ? Math.max(prev[i], prev[i + (1 << (k - 1))])
          : Math.min(prev[i], prev[i + (1 << (k - 1))]);
      }
      this.sparse.push(row);
    }
  }
  /** range extreme of vals[l..r] in O(1) */
  private extreme(l: number, r: number): number {
    const span = r - l + 1;
    const k = Math.floor(Math.log2(span));
    const a = this.sparse[k][l];
    const b = this.sparse[k][r - (1 << k) + 1];
    return this.maximize ? Math.max(a, b) : Math.min(a, b);
  }
  /**
   * First index ≥ `from` whose value satisfies the comparison that the
   * equivalent linear scan would test. min-mode: `v < t` (strict) / `v <= t`;
   * max-mode: `v > t` (strict) / `v >= t`. Returns -1 when no index qualifies.
   */
  first(from: number, threshold: number, strict: boolean): number {
    if (this.n === 0 || from < 0 || from >= this.n) return -1;
    const good = (v: number) =>
      this.maximize
        ? strict ? v > threshold : v >= threshold
        : strict ? v < threshold : v <= threshold;
    if (!good(this.extreme(from, this.n - 1))) return -1;
    let lo = from;
    let hi = this.n - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (good(this.extreme(from, mid))) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  }
}

/**
 * First death index (≥ `from`) under an FVG-mitigation or OB-invalidation
 * rule, via O(log n) range queries — the exact index the equivalent linear
 * scan would find. Returns -1 when nothing ever kills the zone.
 */
export function firstMitigationIndex(
  mode: "fvg-bull" | "fvg-bear" | ObInvalidation,
  z: { direction: "BULLISH" | "BEARISH"; top: number; bottom: number },
  from: number,
  trees: { lowMin: RangeExtreme; highMax: RangeExtreme; closeMin: RangeExtreme; closeMax: RangeExtreme }
): number {
  const mid = (z.top + z.bottom) / 2;
  const q = (kind: "lowMin" | "highMax" | "closeMin" | "closeMax", threshold: number, strict: boolean) =>
    trees[kind].first(from, threshold, strict);
  if (mode === "fvg-bull") return q("lowMin", z.bottom, false); // c.low <= bottom
  if (mode === "fvg-bear") return q("highMax", z.top, false); // c.high >= top
  if (z.direction === "BULLISH") {
    switch (mode as ObInvalidation) {
      case "wick-mid": return q("lowMin", mid, true); // c.low < mid
      case "close-distal": return q("closeMin", z.bottom, true); // c.close < bottom
      case "wick-distal": return q("lowMin", z.bottom, false); // c.low <= bottom
      default: return q("closeMin", mid, true); // close-mid: c.close < mid
    }
  }
  switch (mode as ObInvalidation) {
    case "wick-mid": return q("highMax", mid, true); // c.high > mid
    case "close-distal": return q("closeMax", z.top, true); // c.close > top
    case "wick-distal": return q("highMax", z.top, false); // c.high >= top
    default: return q("closeMax", mid, true); // close-mid: c.close > mid
  }
}

export interface PriceTrees {
  lowMin: RangeExtreme;
  highMax: RangeExtreme;
  closeMin: RangeExtreme;
  closeMax: RangeExtreme;
}

export function priceTrees(candles: Candle[]): PriceTrees {
  const lows: number[] = new Array(candles.length);
  const highs: number[] = new Array(candles.length);
  const closes: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    lows[i] = candles[i].low;
    highs[i] = candles[i].high;
    closes[i] = candles[i].close;
  }
  return {
    lowMin: new RangeExtreme(lows, false),
    highMax: new RangeExtreme(highs, true),
    closeMin: new RangeExtreme(closes, false),
    closeMax: new RangeExtreme(closes, true),
  };
}

export function firstMitigationIndexForTest(
  mode: "fvg-bull" | "fvg-bear" | ObInvalidation,
  z: { direction: "BULLISH" | "BEARISH"; top: number; bottom: number },
  candles: Candle[],
  from: number
): number {
  return firstMitigationIndex(mode, z, from, priceTrees(candles));
}

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
export function detectFvg(candles: Candle[], maxZones = 8, includeMitigated = false, prebuiltTrees?: PriceTrees): Zone[] {
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

  // mitigation check (conservative: candle range covers the whole gap) —
  // first-death queries over sparse tables, O(zones × log n) total.
  // `prebuiltTrees` lets the series-context build share ONE table set across
  // FVG + OB scans instead of rebuilding n·log n tables per detector.
  const trees = prebuiltTrees ?? priceTrees(candles);
  for (const z of zones) {
    if (firstMitigationIndex(z.direction === "BULLISH" ? "fvg-bull" : "fvg-bear", z, z.startIndex + 3, trees) !== -1) {
      z.mitigated = true;
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
  mode: ObInvalidation = "close-mid",
  prebuiltTrees?: PriceTrees
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

  // invalidation: rule-configurable (default = CLOSE through the midpoint) —
  // same first-death range queries as the FVG scan (identical semantics)
  const trees = prebuiltTrees ?? priceTrees(candles);
  for (const z of zones) {
    if (firstMitigationIndex(mode, z, z.startIndex + 2, trees) !== -1) {
      z.mitigated = true;
    }
  }

  const filtered = includeMitigated ? zones : zones.filter((z) => !z.mitigated);
  return filtered.slice(-maxZones);
}
