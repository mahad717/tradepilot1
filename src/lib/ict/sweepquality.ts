// Liquidity sweep quality classification (spec #9).
//
// Distinguishes:
//   SWEEP_REJECTION   — wick beyond the level, close back inside, and
//                       follow-through evidence within the next candles
//   SWEEP_NO_CONFIRM  — wick beyond + close back inside, no follow-through yet
//   TRUE_BREAKOUT     — body closes beyond the level (level genuinely broken)
//   BREAKOUT_FADE     — closed beyond, then immediately rejected (late info)
//
// Only sweeps WITH rejection evidence qualify for reversal setups; structural
// confirmation (MSS) is additionally required by the sequence builder.
import type { Candle, LiquiditySweep } from "./types";

export type SweepClass = "SWEEP_REJECTION" | "SWEEP_NO_CONFIRM" | "TRUE_BREAKOUT" | "BREAKOUT_FADE";

export interface SweepAssessment {
  cls: SweepClass;
  quality: number; // 0..1 — higher = cleaner stop-hunt + rejection
  wickBeyondAtr: number; // how far the wick traded beyond the level (ATR units)
  closeBackRatio: number; // how much of the beyond-wick was rejected by the close (0..1)
  followThrough: number; // opposite-direction closes within 3 candles after (0..3)
  notes: string[];
}

export function classifySweep(
  candles: Candle[],
  sweep: LiquiditySweep,
  atr: number
): SweepAssessment {
  const c = candles[sweep.index];
  const notes: string[] = [];
  const bearishSweep = sweep.side === "BUY_SIDE"; // swept a high → bearish sweep
  const beyond = bearishSweep ? c.high - sweep.level : sweep.level - c.low;
  const wickBeyondAtr = atr > 0 ? beyond / atr : 0;

  // close-back quality: how much of the "beyond" excursion was rejected
  const backInside = bearishSweep ? sweep.level - c.close : c.close - sweep.level;
  const closeBackRatio = beyond > 0 ? Math.max(0, Math.min(1, backInside / beyond)) : 0;

  // body beyond the level = genuine breakout, not a stop hunt
  const bodyBeyond =
    bearishSweep
      ? Math.min(c.close, c.open) > sweep.level
      : Math.max(c.close, c.open) < sweep.level;

  // follow-through: opposite-direction closes in the next 3 candles
  let followThrough = 0;
  for (let k = sweep.index + 1; k <= Math.min(sweep.index + 3, candles.length - 1); k++) {
    const bull = candles[k].close > candles[k].open;
    if (bearishSweep ? !bull : bull) followThrough++;
  }

  let cls: SweepClass;
  if (bodyBeyond && followThrough === 0) {
    cls = "TRUE_BREAKOUT";
    notes.push("body closed beyond the level with no rejection — treat as breakout, not sweep");
  } else if (bodyBeyond) {
    cls = "BREAKOUT_FADE";
    notes.push("closed beyond the level then faded — late/inverted information");
  } else if (closeBackRatio >= 0.5) {
    cls = "SWEEP_REJECTION";
  } else {
    cls = "SWEEP_NO_CONFIRM";
    notes.push("wick beyond level but weak close-back inside");
  }

  // --- quality 0..1 ---
  let quality = 0;
  // depth of the hunt: 0.3–1.5 ATR beyond the level is the sweet spot
  if (wickBeyondAtr >= 0.3) quality += Math.min(0.35, wickBeyondAtr * 0.25);
  // rejection completeness — up to 0.35
  quality += closeBackRatio * 0.35;
  // follow-through — up to 0.3
  quality += Math.min(0.3, followThrough * 0.1);
  if (cls === "TRUE_BREAKOUT") quality = Math.min(quality, 0.15);

  if (wickBeyondAtr < 0.15) notes.push(`shallow sweep (${wickBeyondAtr.toFixed(2)} ATR beyond level)`);
  if (followThrough === 0 && cls !== "TRUE_BREAKOUT") notes.push("no directional follow-through after the sweep");

  return {
    cls,
    quality: Math.min(1, quality),
    wickBeyondAtr: Math.round(wickBeyondAtr * 100) / 100,
    closeBackRatio: Math.round(closeBackRatio * 100) / 100,
    followThrough,
    notes,
  };
}

/** Recency factor: full weight at 0 bars, decaying to 0 at `maxAge` bars. */
export function recencyFactor(ageBars: number, maxAge: number): number {
  if (ageBars < 0 || maxAge <= 0) return 0;
  return Math.max(0, 1 - ageBars / maxAge);
}
