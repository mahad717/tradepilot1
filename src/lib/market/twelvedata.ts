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
  outputsize: number
): Promise<Candle[]> {
  if (!API_KEY) throw new Error("TWELVEDATA_API_KEY is not configured");
  if (!takeToken()) throw new UpstreamRateLimitedError();

  const url = `${BASE}/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${API_KEY}`;
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
