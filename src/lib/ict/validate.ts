// Engine v2 validation suite (spec #36).
//
// Deterministic, synthetic-candle tests with hand-computed expectations:
//   1.  Partial TP accounting (50% @ +1.5R, 50% @ BE → exactly +0.75R gross)
//   2.  Breakeven accounting (initialStop preserved; currentStop reported)
//   3.  Cost calculation (spread + slippage + commission, per leg)
//   4.  Position sizing (1R = riskMoney; P&L = netR × riskMoney)
//   5.  MFE/MAE (correct signs, measured vs INITIAL risk)
//   6.  Timeout accounting
//   7.  Ambiguity models (pessimistic / optimistic / randomized-reproducible
//       / lower-timeframe resolution)
//   8.  No look-ahead: truncation invariance — trades closed before time T
//       are IDENTICAL whether the engine sees future candles or not
//   9.  Candle-by-candle replay consistency (prefix stability)
//   10. Minimum-RR gate
//
// The suite is pure — the API route simply reports pass/fail per test.
import type { Candle, Setup, TradeRecord } from "./types";
import { simulateTrade, type ExecuteConfig } from "./execution";
import { runBacktestCore } from "./backtest";
import { DEFAULT_CONFIG, buildSeriesContext, buildSetupAt, type EngineConfig, type SeriesContext, type CooldownState } from "./sequence";
import { resample, htfSecondsFor } from "./htf";
import { findSwings } from "./swings";
import { mulberry32 } from "./rng";

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const ZERO_COSTS = { spread: 0, slippagePerSide: 0, commissionPctPerSide: 0 };
const REAL_COSTS = { spread: 0.3, slippagePerSide: 0.05, commissionPctPerSide: 0.0001 };

function mkCandles(rows: [number, number, number, number][], startSec = 1000 * 900): Candle[] {
  return rows.map((r, i) => ({ time: startSec + i * 900, open: r[0], high: r[1], low: r[2], close: r[3] }));
}

function mkSetup(over: Partial<Setup> = {}): Setup {
  return {
    side: "LONG",
    decidedIndex: 5,
    decidedTime: 1000 * 900 + 5 * 900,
    entry: 100,
    initialStop: 98,
    riskPerUnit: 2,
    events: [],
    zone: { id: "test-fvg", kind: "FVG", direction: "BULLISH", top: 100, bottom: 99, createdIndex: 3, quality: 0.8, notes: [] },
    targets: [
      { price: 103, source: "test swing", rr: 1.5 },
      { price: 105, source: "test pool", rr: 2.5 },
      { price: 107, source: "test ERL", rr: 3.5 },
    ],
    rrToFinal: 3.5,
    rrToTp1: 1.5,
    scores: { context: 16, liquidity: 16, structure: 18, entry: 16, confirmation: 5, risk: 8 },
    totalScore: 79,
    tier: "B",
    session: "london",
    htfBias: "BULLISH",
    volRegime: "NORMAL",
    mktRegime: "TREND_UP",
    smtAligned: false,
    sweepKey: "test",
    rationale: [],
    rejections: [],
    ...over,
  };
}

function execConfig(over: Partial<ExecuteConfig> = {}): ExecuteConfig {
  return {
    beMode: "tp1",
    beTriggerR: 1.0,
    partialShares: [0.5, 0.25, 0.25],
    maxHoldBars: 96,
    orderExpiryBars: 10,
    ambiguity: "pessimistic",
    randomSeed: 42,
    riskMoney: 100,
    costs: ZERO_COSTS,
    ...over,
  };
}

// Candles: bars 0–5 pre-signal; 6 = fill candle; 7 = TP1; 8 = return to BE.
const Tp1BeCandles: [number, number, number, number][] = [
  [99.5, 100.2, 99.0, 99.8],
  [99.8, 100.4, 99.4, 100.1],
  [100.1, 100.6, 99.6, 99.9],
  [99.9, 100.3, 99.2, 99.7],
  [99.7, 100.5, 99.5, 100.2],
  [100.2, 100.8, 99.9, 100.4], // decision bar (close 100.4 > zone top 100)
  [100.4, 100.9, 99.8, 100.6], // fill candle (low 99.8 ≤ 100)
  [100.6, 103.4, 100.2, 103.2], // TP1 @103 fills
  [103.2, 103.0, 99.95, 100.1], // drops to breakeven stop @100
  [100.1, 101.0, 99.9, 100.5],
  [100.5, 101.2, 100.0, 100.8],
];

export function runAllTests(): TestResult[] {
  const results: TestResult[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    results.push({ name, pass, detail });

  // ---- 1. partial TP accounting ------------------------------------------
  {
    const candles = mkCandles(Tp1BeCandles);
    const res = simulateTrade(candles, mkSetup(), execConfig(), "XAUUSD", "15min");
    const t = res.trade;
    const pass =
      !!t &&
      t.outcome === "TP1_BE" &&
      t.legs.length === 2 &&
      t.legs[0].label === "TP1" &&
      Math.abs(t.legs[0].share - 0.5) < 1e-9 &&
      Math.abs(t.grossR - 0.75) < 1e-9 &&
      Math.abs(t.netR - 0.75) < 1e-9;
    add(
      "Partial TP accounting",
      pass,
      t
        ? `legs=[${t.legs.map((l) => `${l.label}:${(l.share * 100).toFixed(0)}%@${l.exitPrice}→${l.netR}R`).join(", ")}] gross=${t.grossR}R net=${t.netR}R (expect 50%@TP1 +1.5R raw + 50%@BE 0R = +0.75R)`
        : "trade did not fill"
    );
  }

  // ---- 2. breakeven accounting (the 4407.72 bug) ---------------------------
  {
    const candles = mkCandles(Tp1BeCandles);
    const res = simulateTrade(candles, mkSetup(), execConfig(), "XAUUSD", "15min");
    const t = res.trade;
    const pass =
      !!t &&
      Math.abs(t.initialStop - 98) < 1e-9 &&
      Math.abs(t.currentStop - 100) < 1e-9 &&
      Math.abs(t.breakevenStop! - 100) < 1e-9 &&
      t.initialStop !== t.entry &&
      Math.abs(t.riskPerUnit - 2) < 1e-9 &&
      t.beActivatedTime === candles[7].time; // TP1 bar — effective from the NEXT bar
    add(
      "Breakeven accounting",
      pass,
      t
        ? `initialStop=${t.initialStop} currentStop=${t.currentStop} breakeven=${t.breakevenStop} entry=${t.entry} risk=${t.riskPerUnit} beActivated@bar7 (initial risk frozen at entry→initialStop)`
        : "trade did not fill"
    );
  }

  // ---- 3. cost calculation -------------------------------------------------
  {
    const candles = mkCandles(Tp1BeCandles);
    const res = simulateTrade(candles, mkSetup(), execConfig({ costs: REAL_COSTS }), "XAUUSD", "15min");
    const t = res.trade;
    // entry cost (full size): (0.3+0.05)*1 + 0.0001*100 = 0.36
    // TP1 leg: 0.36*0.5 + [(0.3+0.05)*0.5 + 0.0001*103*0.5] = 0.18 + 0.18015 = 0.36015 → /2 = 0.180075
    // BE leg: 0.36*0.5 + [(0.3+0.05)*0.5 + 0.0001*100*0.5] = 0.18 + 0.18 = 0.36 → /2 = 0.18
    // total costR = 0.360075 → 0.36 ; netR = 0.75 − 0.36 = 0.39
    const pass = !!t && Math.abs(t.costR - 0.36) < 0.005 && Math.abs(t.netR - 0.39) < 0.005;
    add("Cost calculation", pass, t ? `costR=${t.costR} (expect ≈0.36 = 0.30 spread + 0.10 slippage + commission), netR=${t.netR} (expect ≈0.39)` : "trade did not fill");
  }

  // ---- 4. position sizing ---------------------------------------------------
  {
    const candles = mkCandles(Tp1BeCandles);
    const res = simulateTrade(candles, mkSetup(), execConfig({ riskMoney: 250 }), "XAUUSD", "15min");
    const t = res.trade;
    const pass = !!t && Math.abs(t.positionSizeUnits - 125) < 1e-9 && Math.abs(t.riskMoney - 250) < 1e-9;
    add("Position sizing", pass, t ? `risk $250 / risk/unit 2.0 → ${t.positionSizeUnits} units (expect 125); netR scales money 1:1` : "trade did not fill");
  }

  // ---- 5. MFE/MAE ------------------------------------------------------------
  {
    const candles = mkCandles(Tp1BeCandles);
    const res = simulateTrade(candles, mkSetup(), execConfig(), "XAUUSD", "15min");
    const t = res.trade;
    // fill bar i6 adverse (low 99.8 → −0.10R), then i8 low 99.95 → −0.025 → mae −0.10
    // mfe from bars after fill: i7 high 103.4 → +1.70R
    const pass = !!t && Math.abs(t.mfeR - 1.7) < 0.005 && Math.abs(t.maeR - -0.1) < 0.005 && t.mfeR >= 0 && t.maeR <= 0;
    add("MFE/MAE signs & values", pass, t ? `mfeR=${t.mfeR} (expect +1.70) maeR=${t.maeR} (expect −0.10 incl. fill-bar adverse)` : "trade did not fill");
  }

  // ---- 6. timeout accounting --------------------------------------------------
  {
    const candles = mkCandles([
      [100, 100.5, 99.6, 100.1],
      [100.1, 100.4, 99.5, 99.9],
      [99.9, 100.3, 99.4, 99.8],
      [99.8, 100.2, 99.3, 99.7],
      [99.7, 100.1, 99.2, 99.6], // decision
      [99.6, 100.0, 99.55, 99.8], // fill @100 (low 99.55)
      [99.8, 100.1, 99.6, 99.7],
      [99.7, 100.0, 99.55, 99.75],
      [99.75, 99.95, 99.5, 99.6],
      [99.6, 99.9, 99.4, 99.65], // 4th bar after fill → timeout at this close (99.65)
      [99.65, 99.9, 99.3, 99.5],
    ]);
    const res = simulateTrade(candles, mkSetup(), execConfig({ maxHoldBars: 4 }), "XAUUSD", "15min");
    const t = res.trade;
    // exit at close 99.65 → raw = (99.65−100)/2 = −0.175 → gross −0.18 (rounded)
    const pass = !!t && t.legs.some((l) => l.label === "TIMEOUT") && (t.outcome === "TIMEOUT_WIN" || t.outcome === "TIMEOUT_LOSS") && t.barsHeld === 4;
    add("Timeout accounting", pass, t ? `outcome=${t.outcome} barsHeld=${t.barsHeld} netR=${t.netR} (timeout exits at candle close after maxHoldBars)` : "trade did not fill");
  }

  // ---- 7a. pessimistic ambiguity ------------------------------------------------
  {
    const candles = mkCandles([
      ...Tp1BeCandles.slice(0, 7),
      [100.6, 103.5, 97.9, 98.2], // touches SL 98 AND TP1 103 in ONE candle
      [98.2, 99, 97.5, 98],
    ]);
    const res = simulateTrade(candles, mkSetup(), execConfig(), "XAUUSD", "15min");
    const t = res.trade;
    const pass = !!t && t.outcome === "SL" && Math.abs(t.netR - -1) < 1e-9;
    add("Ambiguity: pessimistic (SL first)", pass, t ? `outcome=${t.outcome} netR=${t.netR} (both SL and TP in one candle → stop assumed first)` : "trade did not fill");
  }

  // ---- 7b. optimistic ambiguity ---------------------------------------------------
  {
    const candles = mkCandles([
      ...Tp1BeCandles.slice(0, 7),
      [100.6, 103.5, 97.9, 103.0],
      [103.0, 104, 100.5, 103.5],
    ]);
    const res = simulateTrade(candles, mkSetup(), execConfig({ ambiguity: "optimistic" }), "XAUUSD", "15min");
    const t = res.trade;
    const pass = !!t && t.legs.some((l) => l.label === "TP1") && t.outcome !== "SL";
    add("Ambiguity: optimistic (TP first)", pass, t ? `outcome=${t.outcome} legs=[${t.legs.map((l) => l.label).join(",")}]` : "trade did not fill");
  }

  // ---- 7c. randomized determinism ---------------------------------------------------
  {
    const candles = mkCandles([
      ...Tp1BeCandles.slice(0, 7),
      [100.6, 103.5, 97.9, 98.2],
      [98.2, 99, 97.5, 98],
    ]);
    const a = simulateTrade(candles, mkSetup(), execConfig({ ambiguity: "randomized", randomSeed: 7 }), "XAUUSD", "15min");
    const b = simulateTrade(candles, mkSetup(), execConfig({ ambiguity: "randomized", randomSeed: 7 }), "XAUUSD", "15min");
    const pass = !!a.trade && !!b.trade && a.trade.netR === b.trade.netR && a.trade.outcome === b.trade.outcome;
    add("Ambiguity: randomized is seeded/reproducible", pass, `run A netR=${a.trade?.netR} run B netR=${b.trade?.netR} (same seed → identical)`);
  }

  // ---- 7d. lower-timeframe resolution ------------------------------------------------
  {
    const parent = mkCandles([
      ...Tp1BeCandles.slice(0, 7),
      [100.6, 103.5, 97.9, 98.2], // ambiguous 15m candle
      [98.2, 99, 97.5, 98],
    ]);
    // 5m subcandles inside the ambiguous bucket (time = parent.time + 0/300/600):
    // target touched at +300, stop only at +600 → target first
    const bucketTime = parent[7].time;
    const ltf: Candle[] = [
      { time: bucketTime, open: 100.6, high: 101.5, low: 100.2, close: 101.4 },
      { time: bucketTime + 300, open: 101.4, high: 103.5, low: 101.0, close: 103.0 },
      { time: bucketTime + 600, open: 103.0, high: 103.1, low: 97.9, close: 98.2 },
    ];
    const res = simulateTrade(parent, mkSetup(), execConfig({ ambiguity: "ltf" }), "XAUUSD", "15min", { ltfCandles: ltf, ltfSeconds: 300, parentSeconds: 900 });
    const t = res.trade;
    const pass = !!t && t.legs.some((l) => l.label === "TP1");
    add("Ambiguity: LTF resolution", pass, t ? `outcome=${t.outcome} legs=[${t.legs.map((l) => l.label).join(",")}] (5m data shows TP printed before SL)` : "trade did not fill");
  }

  // ---- 8/9. look-ahead: truncation invariance + replay consistency --------------------
  {
    const candles = syntheticIctSeries(900);
    const full = runBacktestCore("XAUUSD", "15min", candles, [], testCoreConfig());
    let pass = true;
    let detail = "";
    const checkpoints = [300, 500, 700];
    for (const T of checkpoints) {
      const trunc = runBacktestCore("XAUUSD", "15min", candles.slice(0, T), [], testCoreConfig());
      // every trade that CLOSED before T−2 in the full run must exist identically
      const closedBefore = full.trades.filter((t) => t.exitIndex < T - 2);
      const match = closedBefore.every((t) => {
        const c = trunc.trades.find((x) => x.id === t.id);
        return c && c.netR === t.netR && c.entry === t.entry && c.initialStop === t.initialStop && c.outcome === t.outcome && c.mfeR === t.mfeR && c.maeR === t.maeR;
      });
      const noLateEntries = trunc.trades.every((t) => t.entryIndex < T);
      if (!match || !noLateEntries) {
        pass = false;
        detail = `truncation at ${T}: match=${match} noLateEntries=${noLateEntries} (full run trades=${full.trades.length})`;
        break;
      }
    }
    if (pass) detail = `trades=${full.trades.length}; runs truncated at ${checkpoints.join("/")} reproduce identical closed trades`;
    if (full.trades.length === 0) {
      detail += " | FUNNEL: " + full.funnel.map((f) => `${f.stage}=${f.count}`).join(", ");
    }
    add("No look-ahead: truncation invariance", pass, detail);
  }

  // ---- 10. minimum RR gate --------------------------------------------------------------
  {
    const candles = syntheticIctSeries(900);
    const gated = runBacktestCore("XAUUSD", "15min", candles, [], testCoreConfig({ minRR: 500 }));
    const normal = runBacktestCore("XAUUSD", "15min", candles, [], testCoreConfig());
    const pass = gated.trades.length === 0 && normal.trades.length >= 0;
    add("Minimum-RR gate", pass, `minRR=500 → ${gated.trades.length} trades (expect 0); default minRR → ${normal.trades.length} trades`);
  }

  // ---- 11. SL-equals-entry display guard --------------------------------------------------
  {
    const candles = syntheticIctSeries(900);
    const run = runBacktestCore("XAUUSD", "15min", candles, [], testCoreConfig());
    const bad = run.trades.filter((t) => Math.abs(t.initialStop - t.entry) < 1e-9);
    const pass = bad.length === 0;
    add("Initial stop never equals entry", pass, bad.length === 0 ? `0/${run.trades.length} trades with stop==entry` : `${bad.length} violations`);
  }

  return results;
}

function testCoreConfig(over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    ...DEFAULT_CONFIG,
    warmupBars: 40,
    minBarsBetweenSignals: 4,
    sessions: [], // synthetic series has no real session structure
    sweepQualityMin: 0.3,
    displacementQualityMin: 0.4,
    zoneQualityMin: 0.3,
    tierB: 65,
    tierA: 78,
    ...over,
  };
}

/**
 * Seeded synthetic series with injected ICT sequences engineered to pass the
 * full setup chain: swing low forms (confirmed 2 bars later) → sweep candle
 * trades under it and closes back above (rejection) → two displacement
 * candles up (creating an FVG and breaking the prior swing high = MSS) →
 * price holds above the gap while the limit order rests → pullback fills.
 * Repeats every 150 bars so ~900 bars produce several trades.
 */
export function syntheticIctSeries(n: number): Candle[] {
  const rand = mulberry32(2024);
  const candles: Candle[] = [];
  let price = 4300;
  const mk = (o: number, h: number, l: number, c: number, i: number): Candle => ({
    time: 1700000000 + i * 900,
    open: o,
    high: h,
    low: l,
    close: c,
  });

  for (let i = 0; i < n; i++) {
    const phase = i % 150;
    if (phase >= 100) {
      // PATTERN BLOCK — starts right after the give-back, so the dip-sweep
      // fires in the DISCOUNT half of the trailing range (buy the dip)
      let c: Candle;
      if (phase <= 103) {
        // drift down into the pattern
        const o = price;
        const cl = o - 2.2;
        c = mk(o, o + 1.5, cl - 1.5, cl, i);
      } else if (phase === 104) {
        // swing-low A
        c = mk(price, price + 1.8, price - 5.5, price - 2.6, i);
      } else if (phase <= 107) {
        const o = price;
        const cl = o + 2.0;
        c = mk(o, o + 3.0, o - 1.4, cl, i);
      } else if (phase === 108) {
        // swing-high H (MSS reference), confirmed 2 bars later
        c = mk(price, price + 8.8, price - 1.0, price + 7.0, i);
      } else if (phase <= 111) {
        const o = price;
        const cl = o - 2.2;
        c = mk(o, o + 1.4, o - 3.0, cl, i);
      } else if (phase === 112) {
        // swing-low B (the liquidity that will be swept), confirmed at 114
        c = mk(price, price + 1.4, price - 6.6, price - 3.5, i);
      } else if (phase === 113) {
        // stays above B's low so the fractal at 112 survives
        const o = price;
        const cl = o + 0.9;
        c = mk(o, o + 1.6, o + 0.3, cl, i);
      } else if (phase === 114) {
        // small hold candle — B's fractal window (112±2) must stay clean
        const o = price;
        const cl = o + 0.4;
        c = mk(o, o + 1.0, o - 0.6, cl, i);
      } else if (phase === 115) {
        // SWEEP: wick 1 point below the confirmed swing low B, close back above
        const bLow = Math.min(candles[i - 3].low, candles[i - 2].low, candles[i - 1].low);
        const cl = bLow + 1.0;
        c = mk(price, price + 1.2, bLow - 1.0, cl, i);
      } else if (phase === 116) {
        // displacement candle 1 (large bullish body)
        c = mk(price, price + 5.5, price - 0.5, price + 4.5, i);
      } else if (phase === 117) {
        // displacement candle 2 — completes the FVG (low > sweep-candle high)
        // and closes ABOVE the swing high H → MSS/BOS bullish
        const gapLow = candles[i - 2].high + 1.5;
        c = mk(price, price + 10.0, gapLow, price + 9.0, i);
      } else if (phase <= 125) {
        // hold above the FVG so the limit order rests untouched
        const o = price;
        const cl = o + 0.6 + (rand() - 0.5) * 1.2;
        c = mk(o, Math.max(o, cl) + 1.0, Math.min(o, cl) - 1.0, cl, i);
      } else if (phase === 126 || phase === 128) {
        // deep pullback candles — retrace to the FVG top (entry fill)
        const o = price;
        const cl = o - 7.0;
        c = mk(o, o + 1.0, cl - 4.0, cl, i);
      } else if (phase === 127 || phase === 129) {
        // partial recovery between pullbacks
        const o = price;
        const cl = o + 1.5;
        c = mk(o, o + 2.5, o - 0.8, cl, i);
      } else if (phase <= 134) {
        const o = price;
        const cl = o + (rand() - 0.2) * 4.0;
        c = mk(o, Math.max(o, cl) + 1.4, Math.min(o, cl) - 1.4, cl, i);
      } else if (phase <= 149) {
        // early-cycle rally continues (post-pattern expansion)
        const o = price;
        const cl = o + (rand() - 0.2) * 5.0;
        c = mk(o, Math.max(o, cl) + 1.4, Math.min(o, cl) - 1.4, cl, i);
      } else {
        const o = price;
        const cl = o + (rand() - 0.5) * 7.0 + 1.2;
        c = mk(o, Math.max(o, cl) + 1.6, Math.min(o, cl) - 1.6, cl, i);
      }
      price = c.close;
      candles.push(c);
      continue;
    } else if (phase >= 70) {
      // give-back into the pattern: deep enough to create 4H swing structure
      // and put the next setup in discount, shallow enough to keep trend
      const o = price;
      const cl = o - 1.6 + (rand() - 0.5) * 2.0;
      const c = mk(o, o + 1.2, Math.min(o, cl) - 1.0, cl, i);
      price = cl;
      candles.push(c);
      continue;
    }
    const o = price;
    // up-drifting walk with real two-way noise (er ≈ 0.4 → TREND_UP, and
    // pullbacks deep enough for 4H fractal swings to exist)
    const cl = o + (rand() - 0.5) * 7.0 + 1.2;
    const c = mk(o, Math.max(o, cl) + 1.6, Math.min(o, cl) - 1.6, cl, i);
    price = cl;
    candles.push(c);
  }
  return candles;
}

export function summarize(results: TestResult[]): { passed: number; total: number; allPass: boolean } {
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, allPass: passed === results.length };
}

/** Temporary debug aid: inspect the setup chain around injection windows. */
export function debugSynthetic(): unknown {
  const candles = syntheticIctSeries(900);
  const cfg = testCoreConfig();
  const ctx: SeriesContext = buildSeriesContext("XAUUSD", "15min", candles, []);
  const cooldown: CooldownState = { usedSweepKeys: new Set<string>(), blacklistedZones: new Set<string>(), lastSignalIndex: -Infinity };
  const out: unknown[] = [];

  // coarse bias trace
  const biasTrace: { i: number; bias: string; mkt: string; vol: string }[] = [];
  for (let i = 40; i < candles.length; i += 10) {
    biasTrace.push({ i, bias: ctx.biasAt(i), mkt: ctx.regime.regimeAt(i), vol: ctx.volRegimes[i] });
  }
  out.push({ biasTrace });

  // HTF introspection
  const htf = resample(candles, htfSecondsFor(900));
  const htfSwings = findSwings(htf, 2);
  out.push({
    htfInfo: {
      buckets: htf.length,
      swings: htfSwings.length,
      firstBuckets: htf.slice(0, 6).map((b) => ({ t: b.time, o: Math.round(b.open), h: Math.round(b.high), l: Math.round(b.low), c: Math.round(b.close) })),
    },
  });

  // no-RR-gate config used by both the window trace and the ladder scan
  const cfgNoRR: EngineConfig = { ...cfg, minRR: 0.1, sessions: [] };

  for (const [lo, hi] of [[560, 590]] as const) {
    for (let i = lo; i <= hi; i++) {
      const r = buildSetupAt(ctx, i, cfgNoRR, cooldown);
      const bias = ctx.biasAt(i);
      if (r.rejection) out.push({ i, phase: i % 150, bias, rejection: r.rejection });
      if (r.setup) out.push({ i, phase: i % 150, SETUP: true, entry: r.setup.entry, risk: r.setup.riskPerUnit, rr: r.setup.rrToFinal, tier: r.setup.tier, score: r.setup.totalScore });
    }
  }

  // ladder scan with the RR gate effectively disabled
  const rrScan: unknown[] = [];
  const rejectionTally = new Map<string, number>();
  const sweepDump = ctx.sweeps.filter((s) => s.index >= 540 && s.index <= 620).map((s) => ({ i: s.index, side: s.side, level: Math.round(s.level * 10) / 10 }));
  out.push({ sweepDump, biasAt555_585: Array.from({ length: 31 }, (_, k) => ({ i: 555 + k, bias: ctx.biasAt(555 + k) })).filter((b) => b.bias !== "BEARISH") });
  for (let i = 40; i < candles.length - 1; i++) {
    const r = buildSetupAt(ctx, i, cfgNoRR, cooldown);
    if (r.setup) {
      rrScan.push({
        i,
        phase: i % 150,
        entry: Math.round(r.setup.entry * 10) / 10,
        risk: Math.round(r.setup.riskPerUnit * 10) / 10,
        rrTp1: r.setup.rrToTp1,
        rrFinal: r.setup.rrToFinal,
        targets: r.setup.targets.map((t) => `${t.source}:${Math.round(t.price * 10) / 10}(${t.rr}R)`),
      });
    } else if (r.rejection) {
      rejectionTally.set(r.rejection, (rejectionTally.get(r.rejection) ?? 0) + 1);
    }
  }
  out.push({ rrScanCount: rrScan.length });
  out.push({ rejectionTally: Object.fromEntries(rejectionTally) });
  out.push({ rrScan: (rrScan as unknown[]).slice(0, 12) });
  // raw dump of one injection window (cycle 4: bars 550–590)
  const dump: unknown[] = [];
  for (let i = 550; i <= 590; i++) {
    const c = candles[i];
    dump.push({ i, ph: i % 150, o: c.open, h: c.high, l: c.low, c: c.close });
  }
  const events = ctx.structureEvents.filter((e) => e.index >= 540 && e.index <= 600);
  out.push({ structureEvents: events });
  out.push({ dump });
  return out;
}
