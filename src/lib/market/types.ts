// Shared market data types for the TradePilot terminal.

export interface Candle {
  /** Unix seconds (UTC) — bucket open time. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  percentChange: number;
  dayHigh: number;
  dayLow: number;
  isMarketOpen: boolean;
  timestamp: number;
}

export type DataSource = "LIVE" | "SIMULATED";

export type SymbolKey = "XAUUSD" | "XAGUSD";

export type IntervalKey = "5min" | "15min" | "1h" | "4h" | "1day";

export const INTERVALS: { key: IntervalKey; label: string; seconds: number }[] = [
  { key: "5min", label: "5m", seconds: 300 },
  { key: "15min", label: "15m", seconds: 900 },
  { key: "1h", label: "1H", seconds: 3600 },
  { key: "4h", label: "4H", seconds: 14400 },
  { key: "1day", label: "1D", seconds: 86400 },
];

export function intervalSeconds(interval: IntervalKey): number {
  return INTERVALS.find((i) => i.key === interval)?.seconds ?? 900;
}

export function intervalLabel(interval: IntervalKey): string {
  return INTERVALS.find((i) => i.key === interval)?.label ?? interval;
}
