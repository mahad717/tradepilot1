// Market structure: BOS (Break of Structure) and MSS (Market Structure
// Shift, a.k.a. CHoCH) detection from confirmed swing pivots.
import type { Candle, StructureEvent, StructureResult, Swing, Trend } from "./types";
import { findSwings } from "./swings";

/**
 * Walk candles forward using only confirmed pivots (a pivot is known
 * `lookback` bars after it forms). When close crosses the last confirmed
 * swing high/low:
 *   - in the direction of the active trend  -> BOS (continuation)
 *   - against the active trend              -> MSS (reversal / CHoCH)
 * and the trend flips accordingly. No look-ahead: at bar i we only use
 * pivots confirmed by bar i (pivot.index + lookback <= i) and closes <= i.
 */
export function analyzeStructure(candles: Candle[], lookback = 2): StructureResult {
  const events: StructureEvent[] = [];
  const all: Swing[] = findSwings(candles, lookback);

  let trend: Trend = "NEUTRAL";
  let pendingHigh: Swing | null = null;
  let pendingLow: Swing | null = null;

  const confirmedBy = (s: Swing, i: number) => s.index + lookback <= i;

  let cursor = 0;
  for (let i = lookback + 1; i < candles.length; i++) {
    // absorb newly confirmed pivots
    while (cursor < all.length && confirmedBy(all[cursor], i)) {
      const s = all[cursor];
      if (s.type === "HIGH") pendingHigh = s;
      else pendingLow = s;
      cursor++;
    }

    const close = candles[i].close;

    if (pendingHigh && close > pendingHigh.price) {
      const type: StructureEvent["type"] =
        trend === "BEARISH" ? "MSS" : trend === "NEUTRAL" && events.length === 0 ? "BOS" : "BOS";
      events.push({
        index: i,
        time: candles[i].time,
        type: trend === "BEARISH" ? "MSS" : type,
        direction: "BULLISH",
        level: pendingHigh.price,
      });
      trend = "BULLISH";
      pendingHigh = null;
    } else if (pendingLow && close < pendingLow.price) {
      events.push({
        index: i,
        time: candles[i].time,
        type: trend === "BULLISH" ? "MSS" : "BOS",
        direction: "BEARISH",
        level: pendingLow.price,
      });
      trend = "BEARISH";
      pendingLow = null;
    }
  }

  const lastSwingHigh = [...all].reverse().find((s) => s.type === "HIGH") ?? null;
  const lastSwingLow = [...all].reverse().find((s) => s.type === "LOW") ?? null;

  return { trend, events: events.slice(-12), lastSwingHigh, lastSwingLow };
}

export interface StructureWalk {
  /** FULL causal event list (not truncated) — consumers must respect `index`. */
  events: StructureEvent[];
  /** trend as known at bar i (only events with event.index <= i) */
  trendAt: (i: number) => Trend;
}

/** Same walk as analyzeStructure but returns every event + a causal trend lookup. */
export function structureWalkSeries(candles: Candle[], lookback = 2): StructureWalk {
  const all: Swing[] = findSwings(candles, lookback);
  const events: StructureEvent[] = [];
  const trendByIndex = new Array<Trend>(candles.length).fill("NEUTRAL");

  let trend: Trend = "NEUTRAL";
  let pendingHigh: Swing | null = null;
  let pendingLow: Swing | null = null;
  let cursor = 0;

  for (let i = lookback + 1; i < candles.length; i++) {
    while (cursor < all.length && all[cursor].index + lookback <= i) {
      const s = all[cursor];
      if (s.type === "HIGH") pendingHigh = s;
      else pendingLow = s;
      cursor++;
    }
    const close = candles[i].close;
    if (pendingHigh && close > pendingHigh.price) {
      events.push({ index: i, time: candles[i].time, type: trend === "BEARISH" ? "MSS" : "BOS", direction: "BULLISH", level: pendingHigh.price });
      trend = "BULLISH";
      pendingHigh = null;
    } else if (pendingLow && close < pendingLow.price) {
      events.push({ index: i, time: candles[i].time, type: trend === "BULLISH" ? "MSS" : "BOS", direction: "BEARISH", level: pendingLow.price });
      trend = "BEARISH";
      pendingLow = null;
    }
    trendByIndex[i] = trend;
  }

  return { events, trendAt: (i: number) => trendByIndex[Math.max(0, Math.min(i, candles.length - 1))] };
}
