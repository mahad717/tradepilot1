// Pure weekend-candle hygiene — deliberately FREE of "server-only" so the
// isomorphic backtest core (src/lib/ict/run-core.ts) can run in the browser
// for uploaded-CSV runs. market/index.ts re-exports these for server callers.
import type { Candle } from "./types";

/**
 * Spot metals feeds publish quotes ~24/7, including dead Saturday hours.
 * ICT session logic must not fire on weekend candles (phantom Asia-KZ
 * sweeps in a closed market), so backtests drop:
 *   - all of Saturday (spot FX/metals closed)
 *   - Sunday before 22:00 UTC (market reopens Sun 22:00 UTC)
 */
export function isWeekendCandle(timeSec: number): boolean {
  const d = new Date(timeSec * 1000);
  const day = d.getUTCDay();
  if (day === 6) return true; // Saturday
  if (day === 0 && d.getUTCHours() < 22) return true; // Sunday before reopen
  return false;
}

export function dropWeekendCandles(candles: Candle[]): { candles: Candle[]; dropped: number } {
  const kept = candles.filter((c) => !isWeekendCandle(c.time));
  return { candles: kept, dropped: candles.length - kept.length };
}
