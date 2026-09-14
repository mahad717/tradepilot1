// Seed search: find a deterministic series that produces full setups so the
// parity fixtures exercise the entry/target/score path, not only rejections.
import { buildSeriesContext, buildSetupAt, DEFAULT_CONFIG, type CooldownState } from "../src/lib/ict/sequence";
import { smtSeries } from "../src/lib/ict/smtseries";
import { mulberry32 } from "../src/lib/ict/rng";

interface Candle { time: number; open: number; high: number; low: number; close: number; }
const r2 = (x: number) => Math.round(x * 100) / 100;

function mkCandles(seed: number, n: number, startEpoch: number, startPrice: number, vol: number): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = startPrice;
  let drift = 0.0004;
  for (let i = 0; i < n; i++) {
    if (i % 40 === 0) drift = (rand() - 0.45) * 0.0022;
    const o = price;
    const move = (rand() - 0.5) * vol + drift * price;
    const c = o + move;
    const wick = vol * (0.3 + rand() * 0.9);
    const h = Math.max(o, c) + rand() * wick;
    const l = Math.min(o, c) - rand() * wick;
    out.push({ time: startEpoch + i * 900, open: r2(o), high: r2(h), low: r2(l), close: r2(c) });
    price = c;
  }
  return out;
}
function mkSilver(gold: Candle[], seed: number, vol: number): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = gold[0].close * 0.0125;
  for (let i = 0; i < gold.length; i++) {
    const o = price;
    const c = o + (gold[i].close - gold[i].open) * 0.02 + (rand() - 0.5) * vol;
    const wick = vol * (0.3 + rand() * 0.9);
    out.push({ time: gold[i].time, open: o, high: Math.max(o, c) + rand() * wick, low: Math.min(o, c) - rand() * wick, close: c });
    price = c;
  }
  return out;
}

let best = { seed: 0, setups: 0 };
for (let seed = 1; seed <= 300; seed++) {
  const candles = mkCandles(seed, 400, 1735689600, 2620, 2620 * 0.0018);
  const silver = mkSilver(candles, seed + 5000, 2620 * 0.0125 * 0.0022);
  const smtEvents = smtSeries(candles, silver, 2, 8);
  const ctx = buildSeriesContext("XAUUSD", "15min", candles, smtEvents);
  let count = 0;
  for (let i = 140; i < 400; i++) {
    const cooldown: CooldownState = { usedSweepKeys: new Set(), blacklistedZones: new Set(), lastSignalIndex: -Infinity };
    const { setup } = buildSetupAt(ctx, i, DEFAULT_CONFIG, cooldown);
    if (setup && setup.tier !== "NO_TRADE") count++;
  }
  if (count > best.setups) best = { seed, setups: count };
  if (count >= 3) { console.log(`seed ${seed}: ${count} setups (good enough)`); break; }
}
console.log("best:", JSON.stringify(best));
