import "server-only";
import { fetchCandlesLive, fetchCandlesRangeLive, fetchQuoteLive } from "./twelvedata";
import { generateSimulatedCandles } from "./simulated";
import type { Candle, DataSource, IntervalKey, Quote, SymbolKey } from "./types";

/**
 * Symbol registry — the single source of truth for what TradePilot tracks
 * and where each instrument's data comes from.
 *
 *  - XAUUSD: live via TwelveData on all plans.
 *  - XAGUSD: TwelveData requires a paid (Grow+) plan. Simulated by default;
 *    set TWELVEDATA_ENABLE_XAG=1 together with a paid API key to go live.
 */

export interface SymbolConfig {
  key: SymbolKey;
  tdSymbol: string;
  name: string;
  metal: "gold" | "silver";
  display: string;
  description: string;
  liveAvailable: boolean;
}

export const SYMBOLS: Record<SymbolKey, SymbolConfig> = {
  XAUUSD: {
    key: "XAUUSD",
    tdSymbol: "XAU/USD",
    name: "Gold Spot / US Dollar",
    metal: "gold",
    display: "XAUUSD",
    description: "Gold spot against the US dollar — the most liquid precious metals market.",
    liveAvailable: true,
  },
  XAGUSD: {
    key: "XAGUSD",
    tdSymbol: "XAG/USD",
    name: "Silver Spot / US Dollar",
    metal: "silver",
    display: "XAGUSD",
    description: "Silver spot against the US dollar — higher volatility, tighter liquidity than gold.",
    liveAvailable: process.env.TWELVEDATA_ENABLE_XAG === "1",
  },
};

export const SYMBOL_KEYS = Object.keys(SYMBOLS) as SymbolKey[];

export function isSymbolKey(v: string): v is SymbolKey {
  return v in SYMBOLS;
}

export function isIntervalKey(v: string): v is IntervalKey {
  return ["5min", "15min", "1h", "4h", "1day"].includes(v);
}

export function dataSourceFor(symbol: SymbolKey): DataSource {
  return SYMBOLS[symbol].liveAvailable ? "LIVE" : "SIMULATED";
}

export interface CandleResult {
  candles: Candle[];
  source: DataSource;
  /** true when served from an aged cache because upstream was unavailable */
  stale: boolean;
  symbol: SymbolKey;
  interval: IntervalKey;
}

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

/** Fetch candles with cache. `stale` is set when the response came from an aged cache entry. */
export async function getCandles(
  symbol: SymbolKey,
  interval: IntervalKey,
  outputsize = 300
): Promise<CandleResult> {
  const cfg = SYMBOLS[symbol];
  const size = Math.min(Math.max(outputsize, 50), 5000);

  if (cfg.liveAvailable) {
    const { candles, stale } = await fetchCandlesLive(cfg.tdSymbol, interval, size);
    return { candles, source: "LIVE", stale, symbol, interval };
  }
  const candles = generateSimulatedCandles(cfg.tdSymbol, interval, size);
  return { candles, source: "SIMULATED", stale: false, symbol, interval };
}

/**
 * Deep-history fetch for sample-size starved backtests: TwelveData caps a
 * single request at 5000 candles, so longer windows are assembled from
 * oldest-edge-paginated chunks (each chunk consumes one API credit).
 * Simulated feeds just generate the requested span.
 */
export async function getCandlesDeep(
  symbol: SymbolKey,
  interval: IntervalKey,
  totalBars: number
): Promise<CandleResult & { requests: number }> {
  const cfg = SYMBOLS[symbol];
  const size = Math.min(Math.max(totalBars, 50), 25000);

  if (cfg.liveAvailable) {
    const { candles, stale, requests } = await fetchCandlesRangeLive(cfg.tdSymbol, interval, size);
    return { candles, source: "LIVE", stale, symbol, interval, requests };
  }
  const candles = generateSimulatedCandles(cfg.tdSymbol, interval, size);
  return { candles, source: "SIMULATED", stale: false, symbol, interval, requests: 0 };
}

/**
 * SMT companion — the second, correlated series the SMT divergence check
 * compares the traded instrument against. Silver (XAG/USD) is the canonical
 * gold companion but needs a paid TwelveData plan, so XAUUSD falls back to
 * AUD/USD — the strongest LIVE companion on this plan (15-min return
 * correlation vs gold ≈ 0.55 over 2000 aligned bars, measured 2026-09).
 * Silver backtests use live gold (canonical pair, roles inverted).
 */
export const SMT_COMPANIONS: Record<SymbolKey, { tdSymbol: string; label: string; note: string }> = {
  XAUUSD: {
    tdSymbol: "AUD/USD",
    label: "AUD/USD (gold-proxy FX)",
    note: "Silver (XAG/USD) requires a paid TwelveData plan — AUD/USD is used as the live companion proxy (15m return correlation vs gold ≈ 0.55).",
  },
  XAGUSD: {
    tdSymbol: "XAU/USD",
    label: "XAU/USD (gold)",
    note: "Canonical metals SMT pair with roles inverted — gold is live on this plan.",
  },
};

export interface CompanionResult {
  candles: Candle[];
  source: DataSource;
  label: string;
  note: string;
  /** set when the fetch failed — the run must distinguish "throttled" from "impossible" */
  error?: string;
}

/**
 * Fetch the SMT companion series for a traded symbol. Deep windows fetch
 * the companion from the oldest edge too, so SMT coverage matches the
 * traded window instead of silently covering only the tail.
 */
export async function getCompanionCandles(
  symbol: SymbolKey,
  interval: IntervalKey,
  totalBars: number
): Promise<CompanionResult | null> {
  const comp = SMT_COMPANIONS[symbol];
  try {
    if (totalBars > 5000) {
      const { candles } = await fetchCandlesRangeLive(comp.tdSymbol, interval, Math.min(totalBars, 25000));
      return { candles, source: "LIVE", label: comp.label, note: comp.note };
    }
    const { candles } = await fetchCandlesLive(comp.tdSymbol, interval, Math.min(Math.max(totalBars, 50), 5000));
    return { candles, source: "LIVE", label: comp.label, note: comp.note };
  } catch (err) {
    return {
      candles: [],
      source: "LIVE",
      label: comp.label,
      note: comp.note,
      error: err instanceof Error ? err.message : "unknown companion fetch failure",
    };
  }
}

export async function getQuotes(): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  await Promise.all(
    SYMBOL_KEYS.map(async (key) => {
      const cfg = SYMBOLS[key];
      try {
        if (cfg.liveAvailable) {
          const q = await fetchQuoteLive(cfg.tdSymbol);
          out[key] = q;
        } else {
          const { generateSimulatedQuote } = await import("./simulated");
          const s = generateSimulatedQuote(cfg.tdSymbol);
          out[key] = {
            symbol: cfg.tdSymbol,
            ...s,
            isMarketOpen: true,
            timestamp: Date.now(),
          };
        }
      } catch {
        // Leave the symbol out rather than failing the whole endpoint.
      }
    })
  );
  return out;
}
