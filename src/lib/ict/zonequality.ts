// Zone (FVG / OB) quality scoring (spec #10, #11).
// FVG quality: displacement-created, fresh/unmitigated, size vs volatility,
// relation to the sweep + MSS, HTF alignment, premium/discount location.
// OB quality: liquidity interaction, displacement away, structure break,
// meaningful move away, freshness. Weak/random blocks are rejected.
import type { Candle, Zone } from "./types";

export interface ZoneQuality {
  score: number; // 0..1
  notes: string[];
}

/** FVG created by the displacement leg between the two indices? */
export function fvgCreatedBetween(candles: Candle[], zone: Zone, fromIndex: number, toIndex: number): boolean {
  // FVG startIndex points at the first candle of the 3-candle pattern;
  // the gap "completes" at startIndex + 2.
  const completion = zone.startIndex + 2;
  return completion >= fromIndex && completion <= toIndex;
}

export function fvgQuality(args: {
  candles: Candle[];
  zone: Zone;
  atr: number;
  currentIndex: number;
  sweepIndex: number | null;
  mssIndex: number | null;
  displacementIndex: number | null;
  inCorrectRangeHalf: boolean;
  htfAligned: boolean;
}): ZoneQuality {
  const { zone, atr, currentIndex, sweepIndex, mssIndex, displacementIndex, inCorrectRangeHalf, htfAligned } = args;
  const notes: string[] = [];
  let score = 0;

  const size = Math.abs(zone.top - zone.bottom);
  const sizeAtr = atr > 0 ? size / atr : 0;
  // size sanity: 0.15–1.2 ATR is a tradable imbalance; giant gaps get chased
  if (sizeAtr >= 0.15 && sizeAtr <= 1.2) score += 0.2;
  else notes.push(`FVG size ${sizeAtr.toFixed(2)}x ATR outside the 0.15–1.2 sweet spot`);

  // freshness: untouched so far
  let touched = false;
  for (let i = zone.startIndex + 3; i <= currentIndex; i++) {
    const c = args.candles[i];
    if (zone.direction === "BULLISH" && c.low <= zone.top) touched = true;
    if (zone.direction === "BEARISH" && c.high >= zone.bottom) touched = true;
    if (touched) break;
  }
  if (!touched) score += 0.25;
  else {
    score += 0.1;
    notes.push("FVG already partially tagged before entry");
  }

  // created by the displacement that caused the MSS (the causal chain)
  if (displacementIndex !== null && fvgCreatedBetween(args.candles, zone, displacementIndex - 1, (mssIndex ?? displacementIndex) + 1)) {
    score += 0.25;
  } else {
    notes.push("FVG not created by the MSS displacement leg");
  }

  // relationship to the sweep: created after the sweep (sequence)
  if (sweepIndex !== null && zone.startIndex + 2 > sweepIndex) score += 0.1;
  else notes.push("FVG predates the liquidity sweep");

  if (inCorrectRangeHalf) score += 0.1;
  else notes.push("FVG located in the wrong half of the dealing range");

  if (htfAligned) score += 0.1;

  return { score: Math.min(1, score), notes };
}

export function obQuality(args: {
  candles: Candle[];
  zone: Zone;
  atr: number;
  currentIndex: number;
  sweepIndex: number | null;
  mssIndex: number | null;
  inCorrectRangeHalf: boolean;
}): ZoneQuality {
  const { candles, zone, atr, currentIndex, sweepIndex, mssIndex, inCorrectRangeHalf } = args;
  const notes: string[] = [];
  let score = 0;

  const obCandle = candles[zone.startIndex];
  const moveAway = Math.abs(candles[Math.min(zone.startIndex + 2, candles.length - 1)].close - obCandle.close);
  const moveAwayAtr = atr > 0 ? moveAway / atr : 0;

  // meaningful move away from the block (institutional departure)
  if (moveAwayAtr >= 1) score += 0.3;
  else notes.push(`weak departure from OB (${moveAwayAtr.toFixed(2)}x ATR)`);

  // structure break after the block
  if (mssIndex !== null && mssIndex > zone.startIndex) score += 0.2;
  else notes.push("no structure break after the order block");

  // liquidity interaction: the block sits at/beyond a swept level
  if (sweepIndex !== null) {
    const sweep = candles[sweepIndex];
    const interacts =
      zone.direction === "BULLISH"
        ? zone.bottom <= sweep.high + atr * 0.25
        : zone.top >= sweep.low - atr * 0.25;
    if (interacts) score += 0.2;
    else notes.push("OB shows no interaction with the swept liquidity");
  }

  // freshness
  let touched = false;
  for (let i = zone.startIndex + 2; i <= currentIndex; i++) {
    const c = candles[i];
    if (zone.direction === "BULLISH" && c.low <= zone.top) touched = true;
    if (zone.direction === "BEARISH" && c.high >= zone.bottom) touched = true;
    if (touched) break;
  }
  if (!touched) score += 0.2;
  else {
    score += 0.05;
    notes.push("OB already retested before entry");
  }

  if (inCorrectRangeHalf) score += 0.1;
  else notes.push("OB located in the wrong half of the dealing range");

  return { score: Math.min(1, score), notes };
}
