/**
 * Sweep v2 — "Can we further improve" round 2 (Task 20).
 *
 * Upgrades vs the round-1 sweep (Task 19):
 *  1. Walk-forward structure: screen on the production tail window (W1 = last
 *     25k, exactly what the product runs), then validate the champion on two
 *     DISJOINT earlier windows (W2/W3) that selection never saw.
 *  2. Untapped knobs: targetHorizonR, maxHoldBars, minBarsBetweenSignals,
 *     maxSweepAgeBars, maxStructureAgeBars, quality floors, stop-ATR bounds,
 *     partial-share ladder, finer expiry/tolerance/costGate grids, session
 *     pairs, all 4 OB invalidation modes.
 *
 * Standing constraint: trades >= baseline(79) on W1 AND winRate not lower —
 * a knob wins only if it improves BOTH net R and WR at equal-or-more trades.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

// ---------------------------------------------------------------- harness --
const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);
const N = candles.length;
const W1 = candles; // engine caps to the last 25k = production window
const W2 = candles.slice(0, N - 30000); // engine takes [-55000..-30000)
const W3 = candles.slice(0, N - 60000); // engine takes [-85000..-60000)

const uiBase = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"] as string[],
  entryAnchor: "midpoint", entryToleranceR: 0.05, maxCostPctOfR: 0.35,
  obInvalidation: "close-mid", obDisplacementFactor: 1.2, tierB: 70,
};
const base = csvConfigFromUi("XAUUSD" as SymbolKey, uiBase);

interface Row { name: string; trades: number; wr: number; net: number; pf: number; dd: number; }

function run(cnds: typeof candles, label: string, over: Record<string, unknown> = {}): Row {
  const cfg: Record<string, unknown> = { ...base, ...over };
  const r = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: cnds,
    strictness: "balanced", config: cfg as never,
  });
  return {
    name: label, trades: r.trades.length, wr: r.metrics.winRate,
    net: r.metrics.netR, pf: r.metrics.profitFactor, dd: r.metrics.maxDrawdownR,
  };
}

const fmt = (rows: Row[]) => rows.map((x) =>
  `${x.name.padEnd(34)} ${String(x.trades).padStart(4)}  ${x.wr.toFixed(1).padStart(5)}%  ${x.net >= 0 ? "+" : ""}${x.net.toFixed(2).padStart(6)}R  PF ${x.pf.toFixed(2).padStart(5)}  DD ${x.dd.toFixed(2)}R`
).join("\n");

// ---------------------------------------------------------------- baselines --
console.log("=== baselines (current shipped defaults) ===");
const b1 = run(W1, "W1 tail 25k (production)");
const b2 = run(W2, "W2 mid  [-55000..-30000)");
const b3 = run(W3, "W3 old  [-85000..-60000)");
console.log(fmt([b1, b2, b3]));

// ---------------------------------------------------------------- phase 1 --
const V: [string, Record<string, unknown>][] = [
  // order expiry — finer/larger grid around the 24 winner
  ["expiry 18", { orderExpiryBars: 18 }],
  ["expiry 30", { orderExpiryBars: 30 }],
  ["expiry 36", { orderExpiryBars: 36 }],
  ["expiry 48", { orderExpiryBars: 48 }],
  // entry tolerance
  ["tol 0.075", { entryToleranceR: 0.075 }],
  ["tol 0.1", { entryToleranceR: 0.1 }],
  ["tol 0.15", { entryToleranceR: 0.15 }],
  // cost gate
  ["costGate 0.30", { maxCostPctOfR: 0.3 }],
  ["costGate 0.40", { maxCostPctOfR: 0.4 }],
  ["costGate 0.45", { maxCostPctOfR: 0.45 }],
  // tier floor
  ["tierB 65", { tierB: 65 }],
  ["tierB 75", { tierB: 75 }],
  // OB displacement factor
  ["obDisp 1.0", { obDisplacementFactor: 1.0 }],
  ["obDisp 1.1", { obDisplacementFactor: 1.1 }],
  ["obDisp 1.3", { obDisplacementFactor: 1.3 }],
  // OB invalidation — the other 3 modes
  ["obInv wick-mid", { obInvalidation: "wick-mid" }],
  ["obInv close-distal", { obInvalidation: "close-distal" }],
  ["obInv wick-distal", { obInvalidation: "wick-distal" }],
  // target horizon — NEVER swept before
  ["horizon 5R", { targetHorizonR: 5 }],
  ["horizon 6R", { targetHorizonR: 6 }],
  ["horizon 10R", { targetHorizonR: 10 }],
  ["horizon 12R", { targetHorizonR: 12 }],
  // max hold — NEVER swept before
  ["maxHold 48", { maxHoldBars: 48 }],
  ["maxHold 72", { maxHoldBars: 72 }],
  ["maxHold 144", { maxHoldBars: 144 }],
  // signal cooldown — NEVER swept before (more trades possible)
  ["cooldown 6", { minBarsBetweenSignals: 6 }],
  ["cooldown 8", { minBarsBetweenSignals: 8 }],
  ["cooldown 16", { minBarsBetweenSignals: 16 }],
  // freshness windows — NEVER swept before
  ["sweepAge 6", { maxSweepAgeBars: 6 }],
  ["sweepAge 10", { maxSweepAgeBars: 10 }],
  ["sweepAge 12", { maxSweepAgeBars: 12 }],
  ["structAge 10", { maxStructureAgeBars: 10 }],
  ["structAge 18", { maxStructureAgeBars: 18 }],
  ["structAge 22", { maxStructureAgeBars: 22 }],
  // quality floors — NEVER swept before
  ["sweepQ 0.30", { sweepQualityMin: 0.3 }],
  ["sweepQ 0.40", { sweepQualityMin: 0.4 }],
  ["dispQ 0.40", { displacementQualityMin: 0.4 }],
  ["dispQ 0.50", { displacementQualityMin: 0.5 }],
  ["zoneQ 0.35", { zoneQualityMin: 0.35 }],
  ["zoneQ 0.45", { zoneQualityMin: 0.45 }],
  // stop geometry — NEVER swept before
  ["minStopAtr 0.25", { minStopAtrMult: 0.25 }],
  ["minStopAtr 0.35", { minStopAtrMult: 0.35 }],
  ["maxStopAtr 1.5", { maxStopAtrMult: 1.5 }],
  ["maxStopAtr 2.0", { maxStopAtrMult: 2.0 }],
  // partial ladder — NEVER swept before
  ["partials 60/20/20", { partialShares: [0.6, 0.2, 0.2] }],
  ["partials 40/30/30", { partialShares: [0.4, 0.3, 0.3] }],
  // session pairs
  ["sess london+ny-am", { sessions: ["london", "ny-am"] }],
  ["sess ny-am+ny-pm", { sessions: ["ny-am", "ny-pm"] }],
  ["sess london+ny-pm", { sessions: ["london", "ny-pm"] }],
];

console.log(`\n=== phase 1: ${V.length} single-knob variants on W1 (qualifier: trades>=${b1.trades} AND wr>=${b1.wr}) ===`);
const p1: Row[] = [];
for (const [label, over] of V) {
  const r = run(W1, label, over);
  p1.push(r);
  const ok = r.trades >= b1.trades && r.wr >= b1.wr && r.net > b1.net;
  console.log(`${ok ? "PASS" : "    "} ${r.name.padEnd(22)} ${String(r.trades).padStart(4)}  ${r.wr.toFixed(1).padStart(5)}%  ${r.net >= 0 ? "+" : ""}${r.net.toFixed(2).padStart(6)}R  PF ${r.pf.toFixed(2)}  DD ${r.dd.toFixed(2)}R`);
}

const qualified = p1.filter((x) => x.trades >= b1.trades && x.wr >= b1.wr && x.net > b1.net)
  .sort((a, b) => b.net - a.net);
console.log(`\nqualified: ${qualified.length ? qualified.map((x) => x.name).join(", ") : "NONE"}`);

writeFileSync("sweep2-results.json", JSON.stringify({ baseline: { W1: b1, W2: b2, W3: b3 }, phase1: p1, qualified }, null, 2));
console.log("\nsaved scripts/sweep2-results.json (phase 1)");
