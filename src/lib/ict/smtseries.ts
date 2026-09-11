// Causal SMT divergence series for the backtester (spec #14).
//
// A divergence becomes KNOWABLE only after BOTH swings are confirmed
// (swing index + lookback bars). The event is stamped at the first gold bar
// where both confirmations have landed — setups may only look back from
// that bar, never before it.
import type { Candle } from "@/lib/market/types";
import type { Candle as EngineCandle } from "./types";
import { findSwings } from "./swings";

export interface SmtEvent {
  /** gold-series bar index at which the divergence became knowable */
  index: number;
  type: "BULLISH" | "BEARISH";
  detail: string;
}

interface SwingRef {
  index: number;
  time: number;
  price: number;
  type: "HIGH" | "LOW";
}

function toRefs(candles: EngineCandle[] | Candle[]): SwingRef[] {
  return findSwings(candles as EngineCandle[], 2);
}

/**
 * Walk confirmed swing pairs of the base and companion series and emit
 * divergences. Pairing is by TIME PROXIMITY — each base swing is matched to
 * the nearest companion swing of the same type (must be within
 * `contemporaneousBars`); each series' higher-high/lower-low pattern is then
 * measured against its OWN previous swing. Index-pairing (k-th vs k-th) was
 * tried and discarded: two correlated series routinely have different swing
 * densities, and index pairing drifted >10,000 bars on deep windows — the
 * contemporaneity gate then rejected every pair and SMT silently went dead.
 *
 * A divergence becomes KNOWABLE only after BOTH swings are confirmed
 * (swing index + lookback bars). The event is stamped at the first base bar
 * where both confirmations have landed — setups may only look back from
 * that bar, never before it.
 */
export function smtSeries(gold: Candle[], silver: Candle[], lookback = 2, contemporaneousBars = 8): SmtEvent[] {
  if (gold.length < 40 || silver.length < 40) return [];

  const baseByTime = new Map<number, number>(); // base bar time → base index
  for (let i = 0; i < gold.length; i++) baseByTime.set(gold[i].time, i);

  const g = toRefs(gold);
  const s = toRefs(silver);
  const gHigh = g.filter((x) => x.type === "HIGH");
  const gLow = g.filter((x) => x.type === "LOW");
  const sHigh = s.filter((x) => x.type === "HIGH");
  const sLow = s.filter((x) => x.type === "LOW");

  const events: SmtEvent[] = [];
  const spacing = gold.length > 1 ? gold[1].time - gold[0].time : 900;

  // nearest companion swing (same type) by time — binary search over sorted times
  const nearestSwing = (swings: SwingRef[], t: number): { swing: SwingRef; idx: number } | null => {
    let lo = 0;
    let hi = swings.length - 1;
    let best: SwingRef | null = null;
    let bestIdx = -1;
    let bestDist = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = Math.abs(swings[mid].time - t);
      if (d < bestDist) {
        bestDist = d;
        best = swings[mid];
        bestIdx = mid;
      }
      if (swings[mid].time < t) lo = mid + 1;
      else hi = mid - 1;
    }
    return best && bestDist / spacing <= contemporaneousBars ? { swing: best, idx: bestIdx } : null;
  };

  const check = (baseSwings: SwingRef[], compSwings: SwingRef[], kind: "HIGH" | "LOW") => {
    for (let k = 1; k < baseSwings.length; k++) {
      const gPrev = baseSwings[k - 1];
      const gCur = baseSwings[k];
      const hit = nearestSwing(compSwings, gCur.time);
      if (!hit) continue;
      // the companion's own previous same-type swing gives its HH/LH context
      if (hit.idx < 1) continue;
      const sCur = hit.swing;
      const sPrev = compSwings[hit.idx - 1];

      const goldBar = baseByTime.get(gCur.time) ?? -1;
      if (goldBar < 0) continue;

      // knowledge index: first base bar at/after BOTH swings' confirmation
      const confirmTime = Math.max(gCur.time, sCur.time) + (lookback + 1) * spacing;
      let knowIdx = -1;
      for (let i = goldBar; i < gold.length; i++) {
        if (gold[i].time + spacing >= confirmTime) {
          knowIdx = i;
          break;
        }
      }
      if (knowIdx < 0) continue;

      const goldHH = gCur.price > gPrev.price;
      const compHH = sCur.price > sPrev.price;
      if (kind === "HIGH" && goldHH !== compHH) {
        events.push({
          index: knowIdx,
          type: "BEARISH",
          detail: `base ${goldHH ? "HH" : "LH"} @ ${gCur.price.toFixed(2)} vs companion ${compHH ? "HH" : "LH"} @ ${sCur.price.toFixed(2)}`,
        });
      }
      const goldLL = gCur.price < gPrev.price;
      const compLL = sCur.price < sPrev.price;
      if (kind === "LOW" && goldLL !== compLL) {
        events.push({
          index: knowIdx,
          type: "BULLISH",
          detail: `base ${goldLL ? "LL" : "HL"} @ ${gCur.price.toFixed(2)} vs companion ${compLL ? "LL" : "HL"} @ ${sCur.price.toFixed(2)}`,
        });
      }
    }
  };

  check(gHigh, sHigh, "HIGH");
  check(gLow, sLow, "LOW");

  return events.sort((a, b) => a.index - b.index);
}
