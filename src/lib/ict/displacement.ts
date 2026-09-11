// Displacement quality measurement (spec #8).
//
// Displacement = a directional burst that institutional order flow produces.
// Quality is measured relative to RECENT VOLATILITY (no fixed pip thresholds):
//   - body/range ratio (conviction)
//   - range vs trailing ATR multiple (size)
//   - directional consistency of the surrounding candles
//   - did it create an FVG / break structure (institutional signature)
import type { Candle } from "./types";
import { trueRange } from "./volatility";

export interface DisplacementInput {
  candles: Candle[];
  /** index of the displacement candle (or the last candle of a small burst) */
  index: number;
  direction: "BULLISH" | "BEARISH";
  atr: number; // rolling ATR at `index`
  createdFvg: boolean;
  brokeStructure: boolean;
}

export interface DisplacementAssessment {
  quality: number; // 0..1
  bodyRatio: number;
  rangeAtrMult: number;
  consecutive: number;
  notes: string[];
}

export function assessDisplacement(input: DisplacementInput): DisplacementAssessment {
  const { candles, index, direction, atr, createdFvg, brokeStructure } = input;
  const c = candles[index];
  const notes: string[] = [];

  const range = Math.max(c.high - c.low, 1e-9);
  const body = Math.abs(c.close - c.open);
  const bodyRatio = body / range;
  const rangeAtrMult = atr > 0 ? range / atr : 0;

  // directional consistency: how many of the previous 3 candles closed in the
  // same direction (burst vs one-off wick)
  let consecutive = 1;
  for (let k = index - 1; k >= Math.max(0, index - 3); k--) {
    const bull = candles[k].close > candles[k].open;
    if (direction === "BULLISH" ? bull : !bull) consecutive++;
    else break;
  }

  // --- score 0..1 ---
  let score = 0;
  // body conviction (0.55+ strong) — up to 0.3
  score += Math.min(0.3, Math.max(0, (bodyRatio - 0.4) / 0.5) * 0.3);
  // size vs volatility (>= 1.2x ATR meaningful, >= 2x excellent) — up to 0.3
  score += rangeAtrMult >= 2 ? 0.3 : rangeAtrMult >= 1.2 ? 0.2 + (rangeAtrMult - 1.2) * 0.125 : Math.max(0, (rangeAtrMult - 0.6) * 0.167);
  // consistency — up to 0.15
  score += Math.min(0.15, (consecutive - 1) * 0.05);
  // institutional signatures — up to 0.25
  if (createdFvg) score += 0.15;
  if (brokeStructure) score += 0.1;

  if (bodyRatio < 0.45) notes.push(`weak body conviction (${(bodyRatio * 100).toFixed(0)}% body/range)`);
  if (rangeAtrMult < 1) notes.push(`displacement range only ${rangeAtrMult.toFixed(2)}x ATR`);
  if (consecutive < 2) notes.push("single-candle burst, no directional follow-through");
  if (!createdFvg) notes.push("no FVG created by the displacement leg");

  return {
    quality: Math.min(1, score),
    bodyRatio: Math.round(bodyRatio * 100) / 100,
    rangeAtrMult: Math.round(rangeAtrMult * 100) / 100,
    consecutive,
    notes,
  };
}

/**
 * Locate the displacement candle for a leg between `fromIndex` (exclusive)
 * and `toIndex` (inclusive) moving in `direction`. Returns the index of the
 * candle with the largest directional body in the window, or null.
 */
export function findDisplacementCandle(
  candles: Candle[],
  fromIndex: number,
  toIndex: number,
  direction: "BULLISH" | "BEARISH"
): number | null {
  let best: number | null = null;
  let bestBody = 0;
  for (let i = Math.max(0, fromIndex); i <= Math.min(toIndex, candles.length - 1); i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const bullish = c.close > c.open;
    const aligned = direction === "BULLISH" ? bullish : !bullish;
    if (aligned && body > bestBody) {
      bestBody = body;
      best = i;
    }
  }
  return best;
}

/** True when the three candles ending at `fvgIndex` form an FVG (helper for callers that pre-scan). */
export function createsFvg(candles: Candle[], fvgIndex: number, direction: "BULLISH" | "BEARISH"): boolean {
  if (fvgIndex < 2) return false;
  const a = candles[fvgIndex - 2];
  const c = candles[fvgIndex];
  return direction === "BULLISH" ? c.low > a.high : c.high < a.low;
}

/** Total directional range travelled from `fromIndex+1..toIndex` (for leg size). */
export function legRange(candles: Candle[], fromIndex: number, toIndex: number): number {
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = Math.max(0, fromIndex); i <= Math.min(toIndex, candles.length - 1); i++) {
    hi = Math.max(hi, candles[i].high);
    lo = Math.min(lo, candles[i].low);
  }
  return Number.isFinite(hi) ? hi - lo : 0;
}

export { trueRange };
