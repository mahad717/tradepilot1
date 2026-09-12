import "server-only";
import type { Candle, IntervalKey, Quote } from "./types";

/**
 * TwelveData REST client with in-memory TTL caching and an upstream
 * rate-guard. The free plan allows ~8 requests/minute, so every market
 * endpoint funnels through this module: cached responses are served
 * instantly and stale responses are served (flagged) when the token
 * bucket is exhausted instead of erroring the UI.
 */

const API_KEY = process.env.TWELVEDATA_API_KEY ?? "";
const BASE = "https://api.twelvedata.com";

const TTL_BY_INTERVAL: Record<string, number> = {
  "5min": 60_000,
  "15min": 120_000,
  "1h": 300_000,
  "4h": 900_000,
  "1day": 1_800_000,
};

const QUOTE_TTL = 60_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const candleCache = new Map<string, CacheEntry<Candle[]>>();
const quoteCache = new Map<string, CacheEntry<Quote>>();

// Simple upstream token bucket: 7 requests / minute (1 below the free cap).
const UPSTREAM_CAPACITY = 7;
let tokens = UPSTREAM_CAPACITY;
let windowStart = Date.now();

function takeToken(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    tokens = UPSTREAM_CAPACITY;
  }
  if (tokens > 0) {
    tokens -= 1;
    return true;
  }
  return false;
}

export class UpstreamRateLimitedError extends Error {
  constructor() {
    super("Upstream market data rate limit reached, serving cached data");
    this.name = "UpstreamRateLimitedError";
  }
}

function parseCandleTime(dt: string): number {
  // TwelveData forex/metals datetimes are UTC: "2026-09-11 14:30:00".
  return Math.floor(Date.parse(dt.replace(" ", "T") + "Z") / 1000);
}

interface TdSeriesResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: { datetime: string; open: string; high: string; low: string; close: string }[];
}

async function upstreamTimeSeries(
  tdSymbol: string,
  interval: IntervalKey,
  outputsize: number,
  endDate?: string
): Promise<Candle[]> {
  if (!API_KEY) throw new Error("TWELVEDATA_API_KEY is not configured");
  if (!takeToken()) throw new UpstreamRateLimitedError();

  let url = `${BASE}/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${API_KEY}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
  const json = (await res.json()) as TdSeriesResponse;
  if (json.status === "error" || !json.values) {
    throw new Error(json.message ?? "TwelveData returned no values");
  }
  const candles: Candle[] = json.values
    .map((v) => ({
      time: parseCandleTime(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }))
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);
  return candles;
}

function tdDatetime(timeSec: number): string {
  return new Date(timeSec * 1000).toISOString().slice(0, 19).replace("T", " ");
}

const INTERVAL_SEC: Record<string, number> = {
  "5min": 300,
  "15min": 900,
  "1h": 3600,
  "4h": 14400,
  "1day": 86400,
};

/** Long-TTL cache for merged deep-history windows (rate-limit friendly). */
const deepCache = new Map<string, CacheEntry<{ candles: Candle[]; requests: number }>>();

/**
 * Deep-history fetch: walks backwards in ≤5000-candle chunks using end_date
 * pagination until `totalBars` unique candles are assembled (or upstream runs
 * dry / the request budget is spent). Each chunk is one API credit, so the
 * merged window is cached with a long TTL.
 */
export async function fetchCandlesRangeLive(
  tdSymbol: string,
  interval: IntervalKey,
  totalBars: number
): Promise<{ candles: Candle[]; stale: boolean; requests: number }> {
  const key = `${tdSymbol}:${interval}:deep:${totalBars}`;
  const ttl = 15 * 60_000;
  const cached = deepCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ttl) {
    return { candles: cached.data.candles, stale: false, requests: cached.data.requests };
  }

  const stepSec = INTERVAL_SEC[interval] ?? 900;
  const chunkSize = 5000;
  const maxRequests = Math.min(Math.ceil(totalBars / chunkSize) + 1, 8);
  const byTime = new Map<number, Candle>();
  let oldest: number | null = null;
  let requests = 0;
  let stale = false;

  try {
    while (byTime.size < totalBars && requests < maxRequests) {
      const chunk = await upstreamTimeSeries(tdSymbol, interval, chunkSize, oldest !== null ? tdDatetime(oldest - stepSec) : undefined);
      requests++;
      if (chunk.length === 0) break;
      const before = byTime.size;
      for (const c of chunk) byTime.set(c.time, c);
      const chunkOldest = chunk[0].time;
      if (oldest !== null && chunkOldest >= oldest && byTime.size === before) break; // no progress → upstream dry
      oldest = chunkOldest;
    }
  } catch (err) {
    if (byTime.size === 0 && cached) {
      return { candles: cached.data.candles, stale: true, requests: cached.data.requests };
    }
    if (byTime.size === 0) throw err;
    stale = true; // partial window on mid-fetch failure — flagged, still usable
  }

  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  // bound the cache: each entry is a 15-25k-candle array (~3-5MB), and the key
  // cardinality is arbitrary (any bars value > 5000), so an isolate serving
  // many distinct windows would accumulate without limit. LRU by insertion.
  if (!deepCache.has(key)) {
    const MAX_DEEP_ENTRIES = 6;
    if (deepCache.size >= MAX_DEEP_ENTRIES) {
      const oldestKey = deepCache.keys().next().value;
      if (oldestKey !== undefined) deepCache.delete(oldestKey);
    }
  }
  deepCache.set(key, { data: { candles, requests }, fetchedAt: now });
  return { candles, stale, requests };
}

interface TdQuoteResponse {
  status?: string;
  message?: string;
  symbol?: string;
  close?: string;
  change?: string;
  percent_change?: string;
  high?: string;
  low?: string;
  is_market_open?: boolean;
  timestamp?: number;
}

async function upstreamQuote(tdSymbol: string): Promise<Quote> {
  if (!API_KEY) throw new Error("TWELVEDATA_API_KEY is not configured");
  if (!takeToken()) throw new UpstreamRateLimitedError();

  const url = `${BASE}/quote?symbol=${encodeURIComponent(tdSymbol)}&apikey=${API_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
  const json = (await res.json()) as TdQuoteResponse;
  if (json.status === "error" || !json.close) {
    throw new Error(json.message ?? "TwelveData returned no quote");
  }
  return {
    symbol: tdSymbol,
    price: Number(json.close),
    change: Number(json.change ?? 0),
    percentChange: Number(json.percent_change ?? 0),
    dayHigh: Number(json.high ?? json.close),
    dayLow: Number(json.low ?? json.close),
    isMarketOpen: Boolean(json.is_market_open),
    timestamp: Date.now(),
  };
}

/** Fetch candles with cache. `stale` is set when the response came from an aged cache entry. */
export async function fetchCandlesLive(
  tdSymbol: string,
  interval: IntervalKey,
  outputsize: number
): Promise<{ candles: Candle[]; stale: boolean }> {
  const key = `${tdSymbol}:${interval}:${outputsize}`;
  const cached = candleCache.get(key);
  const ttl = TTL_BY_INTERVAL[interval] ?? 120_000;
  const now = Date.now();

  if (cached && now - cached.fetchedAt < ttl) {
    return { candles: cached.data, stale: false };
  }

  try {
    const candles = await upstreamTimeSeries(tdSymbol, interval, outputsize);
    candleCache.set(key, { data: candles, fetchedAt: now });
    return { candles, stale: false };
  } catch (err) {
    // On upstream failure/rate-limit serve stale data if we have any.
    if (cached) return { candles: cached.data, stale: true };
    throw err;
  }
}

export async function fetchQuoteLive(tdSymbol: string): Promise<Quote> {
  const cached = quoteCache.get(tdSymbol);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < QUOTE_TTL) {
    return cached.data;
  }

  try {
    const quote = await upstreamQuote(tdSymbol);
    quoteCache.set(tdSymbol, { data: quote, fetchedAt: now });
    return quote;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}
