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
 *
 * Returns the FULL clustered ladder sorted by distance (nearest first).
 * Callers MUST NOT slice to the nearest N before applying an RR gate —
 * the old behaviour kept the 3 nearest levels and then required the
 * farthest of THOSE to clear minRR, silently discarding far liquidity
 * (PDH/PWH) and rejecting setups that had a perfectly valid 2R+ target
 * (spec §18-RR diagnosis). Selection of TP1/TP2/TP3 for execution is the
 * caller's job via `selectTradeTargets`.
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

  return clustered;
}

export interface TradeTargets {
  /** execution ladder: [nearest, second, FARTHEST] (spec §18-RR fix) */
  tp1: StructuralTarget | null;
  tp2: StructuralTarget | null;
  tp3: StructuralTarget | null;
  /** RR of the farthest available structural level — the honest max */
  maxRR: number;
  /** RR of the nearest level (TP1) */
  rrToTp1: number;
  full: StructuralTarget[]; // entire clustered ladder, nearest first
}

/**
 * Map the clustered ladder to the execution targets. TP3 is the FARTHEST
 * level (not the 3rd) so the runner leg reaches real liquidity, and the
 * minRR gate can honestly test "a structural target ≥ minRR exists".
 */
export function selectTradeTargets(
  ladder: StructuralTarget[],
  entry: number,
  riskPerUnit: number
): TradeTargets {
  const rr = (t: StructuralTarget | null) =>
    t ? Math.abs(t.price - entry) / Math.max(1e-9, riskPerUnit) : 0;
  const tp1 = ladder[0] ?? null;
  const tp2 = ladder[1] ?? null;
  const tp3 = ladder.length > 2 ? ladder[ladder.length - 1] : tp2 ?? tp1;
  return {
    tp1,
    tp2,
    tp3,
    maxRR: ladder.length ? rr(ladder[ladder.length - 1]) : 0,
    rrToTp1: tp1 ? rr(tp1) : 0,
    full: ladder,
  };
}
