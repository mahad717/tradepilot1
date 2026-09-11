// Liquidity: equal highs/lows pools and liquidity sweep (stop-hunt) detection.
import type { Candle, LiquidityPool, LiquiditySweep } from "./types";
import { findSwings } from "./swings";

/**
 * Liquidity sweep: a candle whose wick trades beyond a prior confirmed
 * swing level but closes back on the original side — the classic stop-hunt
 * signature (buyside/sellside liquidity taken before reversal).
 */
export function detectSweeps(
  candles: Candle[],
  lookback = 2,
  maxSweeps = 6
): LiquiditySweep[] {
  const swings = findSwings(candles, lookback);
  const sweeps: LiquiditySweep[] = [];

  for (let i = lookback + 1; i < candles.length; i++) {
    const c = candles[i];
    // confirmed swings strictly before the current candle
    const prior = swings.filter((s) => s.index + lookback <= i && s.index < i - 0);
    if (prior.length === 0) continue;

    // most recent relevant swing of each side within a reasonable window
    const highs = prior.filter((s) => s.type === "HIGH");
    const lows = prior.filter((s) => s.type === "LOW");

    const lastHigh = highs[highs.length - 1];
    if (lastHigh && c.high > lastHigh.price && c.close < lastHigh.price) {
      sweeps.push({
        index: i,
        time: c.time,
        side: "BUY_SIDE",
        level: lastHigh.price,
        extreme: c.high,
        close: c.close,
        label: `Buyside liquidity swept at ${lastHigh.price.toFixed(2)}`,
      });
    }

    const lastLow = lows[lows.length - 1];
    if (lastLow && c.low < lastLow.price && c.close > lastLow.price) {
      sweeps.push({
        index: i,
        time: c.time,
        side: "SELL_SIDE",
        level: lastLow.price,
        extreme: c.low,
        close: c.close,
        label: `Sellside liquidity swept at ${lastLow.price.toFixed(2)}`,
      });
    }
  }

  return sweeps.slice(-maxSweeps);
}

/** Equal highs / equal lows — resting liquidity pools. */
export function detectLiquidityPools(
  candles: Candle[],
  lookback = 2,
  tolerancePct = 0.0006,
  maxPools = 6
): LiquidityPool[] {
  const swings = findSwings(candles, lookback);
  const pools: LiquidityPool[] = [];

  const tolerance = (price: number) => price * tolerancePct;

  const highs = swings.filter((s) => s.type === "HIGH");
  for (let i = 1; i < highs.length; i++) {
    const a = highs[i - 1];
    const b = highs[i];
    if (b.index - a.index < lookback * 2) continue; // need separation
    if (Math.abs(a.price - b.price) <= tolerance(a.price)) {
      pools.push({ time: b.time, price: b.price, type: "EQH" });
    }
  }

  const lows = swings.filter((s) => s.type === "LOW");
  for (let i = 1; i < lows.length; i++) {
    const a = lows[i - 1];
    const b = lows[i];
    if (b.index - a.index < lookback * 2) continue;
    if (Math.abs(a.price - b.price) <= tolerance(a.price)) {
      pools.push({ time: b.time, price: b.price, type: "EQL" });
    }
  }

  return pools.slice(-maxPools);
}
