// Higher-timeframe resampling and CAUSAL HTF bias extraction.
//
// The backtest resamples the fetched LTF series into HTF candles instead of
// making extra API calls, and derives the HTF trend from CLOSED HTF candles
// only: an HTF candle that opens at bucket B closes at B + htfSeconds, so it
// may only influence LTF bars whose close time is >= B + htfSeconds.
// This is what keeps the HTF bias free of look-ahead bias.
import type { Candle, Trend } from "./types";
import { findSwings } from "./swings";

export interface HtfCandle extends Candle {
  /** close time of the HTF bucket (open time + htf seconds) */
  closeTime: number;
}

/**
 * Aggregate LTF candles into HTF buckets aligned to UTC boundaries.
 * `htfSeconds` must be a multiple of the LTF interval.
 * The final (possibly incomplete) bucket is dropped — consumers must only
 * rely on complete buckets, which `closeTime` encodes.
 */
export function resample(candles: Candle[], htfSeconds: number): HtfCandle[] {
  const out: HtfCandle[] = [];
  if (candles.length === 0) return out;
  const intervalGuess = Math.max(1, candles[candles.length - 1].time - candles[candles.length - 2 >= 0 ? candles.length - 2 : 0].time);
  const buckets = new Map<number, Candle[]>();
  for (const c of candles) {
    const b = Math.floor(c.time / htfSeconds) * htfSeconds;
    const arr = buckets.get(b);
    if (arr) arr.push(c);
    else buckets.set(b, [c]);
  }
  const entries = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const lastDataTime = candles[candles.length - 1].time;
  for (const [open, arr] of entries) {
    const closeTime = open + htfSeconds;
    // Drop a bucket that is still FORMING: the data ends before its close.
    // (Friday-truncated buckets are complete in market time and are kept.)
    if (closeTime > lastDataTime + intervalGuess) continue;
    const c: HtfCandle = {
      time: open,
      closeTime,
      open: arr[0].open,
      high: Math.max(...arr.map((x) => x.high)),
      low: Math.min(...arr.map((x) => x.low)),
      close: arr[arr.length - 1].close,
    };
    out.push(c);
  }
  return out;
}

/**
 * Causal HTF bias series: for each LTF bar index, the trend of the HTF
 * structure walk restricted to HTF candles that had CLOSED by that bar's
 * close time. BOS/MSS classification identical to structure.ts.
 */
export function htfBiasSeries(
  ltf: Candle[],
  intervalSeconds: number,
  htfSeconds: number,
  lookback = 2
): { biasAt: (i: number) => Trend; events: { index: number; time: number; direction: "BULLISH" | "BEARISH"; type: "BOS" | "MSS" }[] } {
  const htf = resample(ltf, htfSeconds);
  const swings = findSwings(htf, lookback);

  // walk HTF structure
  const events: { index: number; time: number; direction: "BULLISH" | "BEARISH"; type: "BOS" | "MSS" }[] = [];
  let trend: Trend = "NEUTRAL";
  let pendingHigh: number | null = null;
  let pendingLow: number | null = null;
  let cursor = 0;
  const trendAtClose: { closeTime: number; trend: Trend }[] = [];

  for (let i = 0; i < htf.length; i++) {
    while (cursor < swings.length && swings[cursor].index + lookback <= i) {
      const s = swings[cursor];
      if (s.type === "HIGH") pendingHigh = s.price;
      else pendingLow = s.price;
      cursor++;
    }
    const close = htf[i].close;
    if (pendingHigh !== null && close > pendingHigh) {
      events.push({ index: i, time: htf[i].time, direction: "BULLISH", type: trend === "BEARISH" ? "MSS" : "BOS" });
      trend = "BULLISH";
      pendingHigh = null;
    } else if (pendingLow !== null && close < pendingLow) {
      events.push({ index: i, time: htf[i].time, direction: "BEARISH", type: trend === "BULLISH" ? "MSS" : "BOS" });
      trend = "BEARISH";
      pendingLow = null;
    }
    trendAtClose.push({ closeTime: htf[i].closeTime, trend });
  }

  const biasAt = (i: number): Trend => {
    const barCloseTime = ltf[i].time + intervalSeconds;
    // binary search: last HTF candle closed by barCloseTime
    let lo = 0;
    let hi = trendAtClose.length - 1;
    let res: Trend = "NEUTRAL";
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (trendAtClose[mid].closeTime <= barCloseTime) {
        res = trendAtClose[mid].trend;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res;
  };

  return { biasAt, events };
}

/** Default HTF mapping mirroring engine.ts (LTF → analysis HTF). */
export function htfSecondsFor(intervalSeconds: number): number {
  if (intervalSeconds <= 300) return 3600; // 5m → 1H
  if (intervalSeconds <= 900) return 14400; // 15m → 4H
  if (intervalSeconds <= 3600) return 14400; // 1H → 4H
  return 86400; // 4h → 1D
}
