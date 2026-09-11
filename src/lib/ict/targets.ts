// Structural target ladder (spec #4) — TPs come from LIQUIDITY, never from
// arbitrary R multiples. Candidate levels, all causal at bar `index`:
//   - equal highs/lows pools (EQH/EQL) on the trade side
//   - previous-day high/low, previous-week high/low
//   - session extremes (Asian range for London trades, etc.)
//   - external range liquidity (trailing dealing-range high/low)
//   - significant confirmed swing points
// Levels are clustered, sorted by distance and mapped to TP1/TP2/TP3.
import type { Candle, LiquidityPool, Side, Swing } from "./types";
import { findSwings } from "./swings";

export interface StructuralTarget {
  price: number;
  source: string;
  /** structural priority weight (higher = more institutional) */
  weight: number;
}

export interface PrevExtremes {
  prevDayHigh: number;
  prevDayLow: number;
  prevWeekHigh: number;
  prevWeekLow: number;
  /** completed Asia session (00:00–06:00 UTC) high/low of the CURRENT day */
  asiaHigh: number | null;
  asiaLow: number | null;
}

const DAY = 86400;
const WEEK = 7 * DAY;

function extremesOf(candles: Candle[], fromSec: number, toSec: number): { high: number; low: number } | null {
  let hi = -Infinity;
  let lo = Infinity;
  let found = false;
  for (const c of candles) {
    if (c.time >= fromSec && c.time < toSec) {
      found = true;
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
  }
  return found ? { high: hi, low: lo } : null;
}

/**
 * Previous day/week extremes and the current Asia-range extremes.
 * Causal: only completed periods BEFORE the bar's day are used; the Asia
 * range is only available after 06:00 UTC of that day.
 */
export function prevExtremes(candles: Candle[], index: number, intervalSeconds: number): PrevExtremes | null {
  const t = candles[index].time + intervalSeconds; // bar close time
  const d = new Date(t * 1000);
  const dayStartUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  const dayDow = d.getUTCDay();

  // previous TRADING day: walk back up to 4 calendar days (weekends)
  let prevDay: { high: number; low: number } | null = null;
  for (let back = 1; back <= 4 && !prevDay; back++) {
    prevDay = extremesOf(candles, dayStartUtc - back * DAY, dayStartUtc);
  }

  // previous trading week
  const weekStart = dayStartUtc - (dayDow === 0 ? 7 : dayDow - 1) * DAY; // Monday 00:00
  let prevWeek: { high: number; low: number } | null = null;
  for (let back = 1; back <= 2 && !prevWeek; back++) {
    prevWeek = extremesOf(candles, weekStart - back * WEEK, weekStart);
  }

  // today's completed Asia range
  const asiaEnd = dayStartUtc + 6 * 3600;
  let asia: { high: number; low: number } | null = null;
  if (t >= asiaEnd) {
    asia = extremesOf(candles, dayStartUtc, asiaEnd);
  }

  if (!prevDay || !prevWeek) return null;
  return {
    prevDayHigh: prevDay.high,
    prevDayLow: prevDay.low,
    prevWeekHigh: prevWeek.high,
    prevWeekLow: prevWeek.low,
    asiaHigh: asia?.high ?? null,
    asiaLow: asia?.low ?? null,
  };
}

export interface TargetLadderInput {
  candles: Candle[];
  index: number;
  side: Side;
  entry: number;
  riskPerUnit: number;
  pools: LiquidityPool[]; // precomputed (EQH/EQL), causal consumption by time
  rangeHigh: number; // trailing dealing range (external liquidity)
  rangeLow: number;
  prev: PrevExtremes | null;
  clusterAtr: number; // clustering tolerance in price units
  /** precomputed full-series swings (lookback 3) — consumed causally */
  swings?: Swing[];
  maxTargets?: number;
}

/**
 * Build the structural target ladder for the trade side.
 * Only levels BEYOND entry in the favorable direction are candidates.
 * Levels within 0.25 * clusterAtr of each other are clustered (strongest
 * weight wins) so three nearby swing highs don't fake a 3-target ladder.
 */
export function buildTargetLadder(input: TargetLadderInput): StructuralTarget[] {
  const { candles, index, side, entry, pools, rangeHigh, rangeLow, prev, clusterAtr, maxTargets = 3 } = input;
  const long = side === "LONG";
  const minLevel = entry; // must be strictly beyond entry
  const raw: StructuralTarget[] = [];

  const push = (price: number, source: string, weight: number) => {
    if (!Number.isFinite(price)) return;
    if (long ? price > minLevel : price < minLevel) raw.push({ price, source, weight });
  };

  for (const p of pools) {
    if (p.time <= candles[index].time) {
      push(p.price, p.type === "EQH" ? "equal-highs pool" : "equal-lows pool", 0.9);
    }
  }
  if (prev) {
    push(long ? prev.prevDayHigh : prev.prevDayLow, "previous day high/low", 1.0);
    push(long ? prev.prevWeekHigh : prev.prevWeekLow, "previous week high/low", 1.1);
    if (long && prev.asiaHigh !== null) push(prev.asiaHigh, "Asian session high", 0.7);
    if (!long && prev.asiaLow !== null) push(prev.asiaLow, "Asian session low", 0.7);
  }
  push(long ? rangeHigh : rangeLow, "external range liquidity", 1.0);

  // significant confirmed swings, favoring structural extremes.
  // Causal: a lookback-3 swing is only KNOWN 3 bars after it prints, so we
  // consume swings with s.index + 3 <= index.
  const swings = (input.swings ?? findSwings(candles, 3)).filter((s) => s.index + 3 <= index);
  for (const s of swings.slice(-12)) {
    if (long && s.type === "HIGH") push(s.price, "confirmed swing high", 0.6);
    if (!long && s.type === "LOW") push(s.price, "confirmed swing low", 0.6);
  }

  // cluster
  raw.sort((a, b) => (long ? a.price - b.price : b.price - a.price));
  const clustered: StructuralTarget[] = [];
  const tol = Math.max(clusterAtr * 0.25, entry * 0.00008);
  for (const t of raw) {
    const last = clustered[clustered.length - 1];
    if (last && Math.abs(t.price - last.price) <= tol) {
      if (t.weight > last.weight) {
        last.weight = t.weight;
        last.source = t.source;
      }
      continue;
    }
    clustered.push({ ...t });
  }

  return clustered.slice(0, maxTargets);
}
