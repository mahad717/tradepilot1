import "server-only";
import type { Candle, IntervalKey } from "./types";
import { intervalSeconds } from "./types";

/**
 * Deterministic simulated market data generator.
 *
 * XAG/USD (silver spot) requires a paid TwelveData plan (Grow+). Until the
 * plan is upgraded, silver candles are produced by this deterministic
 * simulator so the full terminal — charts, ICT analysis, signals, SMT and
 * backtesting — remains fully functional. Every response is clearly labeled
 * `SIMULATED` in the UI. Set TWELVEDATA_ENABLE_XAG=1 with a paid key to
 * switch to live silver data without any code change.
 *
 * Determinism: the walk is anchored to a fixed genesis bucket and iterated
 * bucket-by-bucket with a seeded PRNG, so every request within the same
 * bucket returns an identical series; a new bucket appends one new candle.
 */

const GENESIS = Date.parse("2026-04-01T00:00:00Z") / 1000;
const BASE_PRICE = 51.2;
const ANNUAL_DRIFT = 0.08;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Higher activity during London / New York hours, quieter in Asia. */
function sessionVolMultiplier(utcHour: number): number {
  if (utcHour >= 7 && utcHour < 10) return 1.35; // London KZ
  if (utcHour >= 12 && utcHour < 15) return 1.45; // NY AM KZ
  if (utcHour >= 15 && utcHour < 17) return 1.1; // London close
  if (utcHour >= 17 && utcHour < 20) return 0.95; // NY PM
  if (utcHour >= 0 && utcHour < 6) return 0.65; // Asia
  return 0.8;
}

function isForexOpen(timeSec: number): boolean {
  const d = new Date(timeSec * 1000);
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  if (day === 6) return false; // Saturday
  if (day === 0) return hour >= 21; // Sunday opens 21:00 UTC
  if (day === 5) return hour < 21; // Friday closes 21:00 UTC
  return true;
}

const memo = new Map<string, { lastBucket: number; candles: Candle[] }>();

/**
 * Generate simulated candles for `symbol` at `interval`, ending at the
 * current (in-progress or last completed) bucket. Deterministic.
 */
export function generateSimulatedCandles(
  symbol: string,
  interval: IntervalKey,
  outputsize: number
): Candle[] {
  const step = intervalSeconds(interval);
  const nowBucket = Math.floor(Date.now() / 1000 / step);
  const genesisBucket = Math.floor(GENESIS / step);

  const memoKey = `${symbol}:${interval}`;
  const hit = memo.get(memoKey);
  if (hit && hit.lastBucket === nowBucket) {
    return hit.candles.slice(-outputsize);
  }

  const seedBase = hashString(`${symbol}:${interval}`);
  const rand = mulberry32(seedBase);

  const startBucket = genesisBucket;
  const endBucket = nowBucket; // include in-progress bucket

  const candles: Candle[] = [];
  let prevClose = BASE_PRICE;
  let deviation = 0; // OU log-deviation from the secular anchor
  const phase = (seedBase % 100) / 100 * Math.PI * 2;

  for (let b = startBucket; b <= endBucket; b++) {
    const timeSec = b * step;
    const d = new Date(timeSec * 1000);
    const utcHour = d.getUTCHours();

    // Skip closed forex buckets (weekend) — mirrors live feed behaviour.
    if (!isForexOpen(timeSec)) {
      // Carry price across the break without emitting a candle.
      continue;
    }

    const yearsSinceGenesis = (timeSec - GENESIS) / (365.25 * 86400);
    const sessionMult = sessionVolMultiplier(utcHour);

    // Secular anchor: slow upward drift with a bounded multi-week wiggle
    // (amplitude in the EXPONENT, so the price path stays realistic).
    const anchor =
      BASE_PRICE *
      Math.exp(
        ANNUAL_DRIFT * yearsSinceGenesis +
          0.04 * Math.sin(yearsSinceGenesis * 9.2 + phase)
      );

    // Ornstein-Uhlenbeck log-deviation keeps price within a realistic band
    // of the anchor instead of letting a random walk drift to absurd levels.
    deviation = 0.995 * deviation + gauss(rand) * 0.0025 * sessionMult;

    const volPerBucket = 0.0018 * Math.sqrt(step / 900); // ~1.8% daily vol
    const shock = gauss(rand) * volPerBucket * sessionMult;

    const open = prevClose;
    const close = anchor * Math.exp(deviation) * (1 + shock);
    const body = Math.abs(close - open);
    const wickUp = body * rand() * 0.9 + close * volPerBucket * rand() * 0.8;
    const wickDown = body * rand() * 0.9 + close * volPerBucket * rand() * 0.8;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;

    candles.push({
      time: timeSec,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
    });
    prevClose = close;
  }

  memo.set(memoKey, { lastBucket: nowBucket, candles });
  return candles.slice(-outputsize);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Simulated daily snapshot used by the quote endpoint for silver. */
export function generateSimulatedQuote(symbol: string): {
  price: number;
  change: number;
  percentChange: number;
  dayHigh: number;
  dayLow: number;
} {
  const dayCandles = generateSimulatedCandles(symbol, "1day", 3);
  const today = dayCandles[dayCandles.length - 1];
  const prev = dayCandles[dayCandles.length - 2] ?? today;
  const change = today.close - prev.close;
  return {
    price: today.close,
    change: Math.round(change * 100) / 100,
    percentChange: Math.round((change / prev.close) * 10000) / 100,
    dayHigh: today.high,
    dayLow: today.low,
  };
}
