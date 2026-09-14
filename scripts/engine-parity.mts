// Generates deterministic fixtures from the REAL TypeScript engine for the
// C# port parity check (scripts/cbot-check). Run: bun run scripts/engine-parity.mts
import { buildSeriesContext, buildSetupAt, DEFAULT_CONFIG, type CooldownState } from "../src/lib/ict/sequence";
import { smtSeries } from "../src/lib/ict/smtseries";
import { atrSeries, volRegimeSeries } from "../src/lib/ict/volatility";
import { marketRegimeSeries } from "../src/lib/ict/regime";
import { htfBiasSeries, htfSecondsFor } from "../src/lib/ict/htf";
import { sessionKeyAt } from "../src/lib/ict/sessions";
import { structureWalkSeries } from "../src/lib/ict/structure";
import { detectSweeps, detectLiquidityPools } from "../src/lib/ict/liquidity";
import { mulberry32 } from "../src/lib/ict/rng";

interface Candle { time: number; open: number; high: number; low: number; close: number; }

function mkCandles(seed: number, n: number, startEpoch: number, startPrice: number, vol: number): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = startPrice;
  let drift = 0.0004;
  for (let i = 0; i < n; i++) {
    // regime-switching drift every ~40 bars so sweeps/structure/displacement occur
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
  let price = gold[0].close * 0.0125; // ~ gold/80
  for (let i = 0; i < gold.length; i++) {
    const o = price;
    const goldMove = gold[i].close - gold[i].open;
    const c = o + goldMove * 0.02 + (rand() - 0.5) * vol; // correlated but diverging at times
    const wick = vol * (0.3 + rand() * 0.9);
    const h = Math.max(o, c) + rand() * wick;
    const l = Math.min(o, c) - rand() * wick;
    out.push({ time: gold[i].time, open: r4(o), high: r4(h), low: r4(l), close: r4(c) });
    price = c;
  }
  return out;
}

function r2(x: number) { return Math.round(x * 100) / 100; }
function r4(x: number) { return Math.round(x * 10000) / 10000; }

async function buildFixture(name: string, seedGold: number, seedSilver: number, startEpoch: number, startPrice: number) {
  const n = 400;
  const candles = mkCandles(seedGold, n, startEpoch, startPrice, startPrice * 0.0018);
  const silver = mkSilver(candles, seedSilver, startPrice * 0.0125 * 0.0022);
  const intervalSec = 900;

  const smtEvents = smtSeries(candles, silver, 2, 8);
  const ctx = buildSeriesContext("XAUUSD", "15min", candles, smtEvents);
  const atr = atrSeries(candles, 14);
  const vols = volRegimeSeries(candles, atr, 200);
  const walk = structureWalkSeries(candles, 2);
  const regimeObj = marketRegimeSeries(candles, walk.events, atr, 60);
  const regimes = candles.map((_: Candle, i: number) => regimeObj.regimeAt(i));
  const biasObj = htfBiasSeries(candles, intervalSec, htfSecondsFor(intervalSec), 2);
  const bias = candles.map((_: Candle, i: number) => biasObj.biasAt(i));
  const sweeps = detectSweeps(candles, 2, 100000);
  const pools = detectLiquidityPools(candles, 2, 0.0006, 100000);

  const perBar: unknown[] = [];
  for (let i = 140; i < candles.length; i++) {
    const cooldown: CooldownState = { usedSweepKeys: new Set(), blacklistedZones: new Set(), lastSignalIndex: -Infinity };
    const { setup, rejection } = buildSetupAt(ctx, i, DEFAULT_CONFIG, cooldown);
    perBar.push({
      i,
      session: sessionKeyAt(candles[i].time),
      rejection: rejection ?? null,
      setup: setup
        ? {
            side: setup.side, model: setup.model, session: setup.session, tier: setup.tier,
            totalScore: setup.totalScore, entry: setup.entry, initialStop: setup.initialStop,
            rrToFinal: setup.rrToFinal, rrToTp1: setup.rrToTp1, sweepKey: setup.sweepKey,
            smtAligned: setup.smtAligned, htfBias: setup.htfBias, volRegime: setup.volRegime, mktRegime: setup.mktRegime,
            scores: setup.scores,
            targets: setup.targets.map((t) => ({ price: t.price, source: t.source, rr: t.rr })),
          }
        : null,
    });
  }

  const fx = {
    name, intervalSec,
    candles: candles.map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close })),
    silver: silver.map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close })),
    expected: {
      atr, volRegime: vols, regime: regimes, bias,
      session: candles.map((c) => sessionKeyAt(c.time)),
      sweeps: sweeps.length, pools: pools.length, smt: smtEvents.length,
      zones: ctx.zones.length,
      perBar,
    },
  };

  const fs = await import("node:fs");
  const path = `scripts/cbot-check/fixture-${name}.json`;
  fs.writeFileSync(path, JSON.stringify(fx));
  const setups = perBar.filter((p: any) => p.setup).length;
  const rejects: Record<string, number> = {};
  for (const p of perBar as any[]) if (!p.setup && p.rejection) rejects[p.rejection] = (rejects[p.rejection] ?? 0) + 1;
  console.log(`fixture-${name}: ${n} bars, sweeps ${sweeps.length}, pools ${pools.length}, smt ${smtEvents.length}, setups ${setups}`);
  console.log("  rejections:", JSON.stringify(rejects));
}

await buildFixture("winter", 20260914, 777, 1735689600, 2620);
await buildFixture("summer", 3141592, 888, 1751328000, 3310);
await buildFixture("setups", 4, 5004, 1735689600, 2620);
console.log("fixtures written.");
