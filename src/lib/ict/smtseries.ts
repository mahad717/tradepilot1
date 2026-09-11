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
 * Walk all confirmed swing pairs of both metals and emit divergences.
 * Silver bars are mapped onto gold bar indices by timestamp (first gold bar
 * at or after the silver confirmation time).
 */
export function smtSeries(gold: Candle[], silver: Candle[], lookback = 2, contemporaneousBars = 8): SmtEvent[] {
  if (gold.length < 40 || silver.length < 40) return [];

  const silverByTime = new Map<number, number>(); // time → gold index
  for (let i = 0; i < gold.length; i++) silverByTime.set(gold[i].time, i);

  const g = toRefs(gold);
  const s = toRefs(silver);
  const gHigh = g.filter((x) => x.type === "HIGH");
  const gLow = g.filter((x) => x.type === "LOW");
  const sHigh = s.filter((x) => x.type === "HIGH");
  const sLow = s.filter((x) => x.type === "LOW");

  const events: SmtEvent[] = [];

  const check = (
    goldSwings: SwingRef[],
    silverSwings: SwingRef[],
    kind: "HIGH" | "LOW"
  ) => {
    for (let k = 1; k < Math.min(goldSwings.length, silverSwings.length); k++) {
      const gPrev = goldSwings[k - 1];
      const gCur = goldSwings[k];
      const sPrev = silverSwings[k - 1];
      const sCur = silverSwings[k];

      // the two markets' swings must be roughly contemporaneous
      const gIdx = silverByTime.get(gCur.time) ?? -1;
      const sIdx = (() => {
        // find silver swing index inside its own series via time
        const t = sCur.time;
        return Math.floor(t / 1) ; // placeholder, real check below via times
      })();
      void sIdx;

      // contemporaneity via time distance converted to gold bars
      const goldBar = gIdx;
      if (goldBar < 0) continue;
      // approximate bar spacing from gold series
      const spacing = gold.length > 1 ? gold[1].time - gold[0].time : 900;
      const distBars = Math.abs(sCur.time - gCur.time) / spacing;
      if (distBars > contemporaneousBars) continue;

      const goldHH = gCur.price > gPrev.price;
      const silverHH = sCur.price > sPrev.price;

      const confirmTime = Math.max(gCur.time, sCur.time) + (lookback + 1) * spacing;
      // knowledge index: first gold bar at/after confirmTime
      let knowIdx = -1;
      for (let i = goldBar; i < gold.length; i++) {
        if (gold[i].time + spacing >= confirmTime) {
          knowIdx = i;
          break;
        }
      }
      if (knowIdx < 0) continue;

      if (kind === "HIGH" && goldHH !== silverHH) {
        events.push({
          index: knowIdx,
          type: "BEARISH",
          detail: `gold ${goldHH ? "HH" : "LH"} @ ${gCur.price.toFixed(2)} vs silver ${silverHH ? "HH" : "LH"} @ ${sCur.price.toFixed(2)}`,
        });
      }
      const goldLL = gCur.price < gPrev.price;
      const silverLL = sCur.price < sPrev.price;
      if (kind === "LOW" && goldLL !== silverLL) {
        events.push({
          index: knowIdx,
          type: "BULLISH",
          detail: `gold ${goldLL ? "LL" : "HL"} @ ${gCur.price.toFixed(2)} vs silver ${silverLL ? "LL" : "HL"} @ ${sCur.price.toFixed(2)}`,
        });
      }
    }
  };

  check(gHigh, sHigh, "HIGH");
  check(gLow, sLow, "LOW");

  return events.sort((a, b) => a.index - b.index);
}
