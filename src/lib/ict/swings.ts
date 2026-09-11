// Swing (fractal pivot) detection and Average True Range.
import type { Candle, Swing } from "./types";

/**
 * Confirmed fractal pivots: a swing high requires `lookback` candles on each
 * side with a strictly lower high (ties tolerated on one side). Pivots are
 * only confirmed `lookback` bars later — consumers must respect that delay
 * when using swings to avoid look-ahead bias.
 */
export function findSwings(candles: Candle[], lookback = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      swings.push({ index: i, time: candles[i].time, price: candles[i].high, type: "HIGH" });
    }
    if (isLow) {
      swings.push({ index: i, time: candles[i].time, price: candles[i].low, type: "LOW" });
    }
  }
  return swings.sort((a, b) => a.index - b.index);
}

export function swingsHighs(swings: Swing[]): Swing[] {
  return swings.filter((s) => s.type === "HIGH");
}

export function swingsLows(swings: Swing[]): Swing[] {
  return swings.filter((s) => s.type === "LOW");
}

/** Average True Range over `period` candles (simple moving average of TR). */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const n = Math.min(period, candles.length - 1);
  let sum = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    );
    sum += tr;
  }
  return sum / n;
}
