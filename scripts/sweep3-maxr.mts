/**
 * Task 21 — push the "All sessions · max R" preset further.
 * Base: all sessions · BE+ costs · optimistic · midpoint · tol 0.15 ·
 * expiry 30 · engine partials 40/30/30 · horizon 12.
 * Constraint: trades >= 194 (the preset's identity) AND wr >= 71.6 AND
 * net > 31.23. Phase 3 gate: champion must not regress W2/W3 vs baseline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);
const N = candles.length;
const W1 = candles;
const W2 = candles.slice(0, N - 30000);
const W3 = candles.slice(0, N - 60000);

const uiMax: Record<string, unknown> = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: [], entryAnchor: "midpoint",
  entryToleranceR: 0.15, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70,
};
const base = csvConfigFromUi("XAUUSD" as SymbolKey, uiMax as never);

interface Row { name: string; trades: number; wr: number; net: number; pf: number; dd: number; }
function run(cnds: typeof candles, label: string, over: Record<string, unknown> = {}): Row {
  const cfg: Record<string, unknown> = { ...base, ...over };
  const r = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: cnds,
    strictness: "balanced", config: cfg as never,
  });
  return { name: label, trades: r.trades.length, wr: r.metrics.winRate, net: r.metrics.netR, pf: r.metrics.profitFactor, dd: r.metrics.maxDrawdownR };
}
const line = (x: Row) => `${x.name.padEnd(34)} ${String(x.trades).padStart(4)}  ${x.wr.toFixed(1).padStart(5)}%  ${x.net >= 0 ? "+" : ""}${x.net.toFixed(2).padStart(7)}R  PF ${x.pf.toFixed(2).padStart(5)}  DD ${x.dd.toFixed(2)}R`;

console.log("=== Max R baselines ===");
const b1 = run(W1, "W1 tail (production)");
const b2 = run(W2, "W2 mid");
const b3 = run(W3, "W3 old");
console.log(`${line(b1)}\n${line(b2)}\n${line(b3)}`);

const V: [string, Record<string, unknown>][] = [
  // target reach
  ["horizon 10", { targetHorizonR: 10 }],
  ["horizon 14", { targetHorizonR: 14 }],
  ["horizon 16", { targetHorizonR: 16 }],
  // partial ladders
  ["partials 30/35/35", { partialShares: [0.3, 0.35, 0.35] }],
  ["partials 35/35/30", { partialShares: [0.35, 0.35, 0.3] }],
  ["partials 25/25/50", { partialShares: [0.25, 0.25, 0.5] }],
  ["partials 50/25/25", { partialShares: [0.5, 0.25, 0.25] }],
  ["partials 40/40/20", { partialShares: [0.4, 0.4, 0.2] }],
  ["partials 30/30/40", { partialShares: [0.3, 0.3, 0.4] }],
  // tolerance
  ["tol 0.2", { entryToleranceR: 0.2 }],
  ["tol 0.25", { entryToleranceR: 0.25 }],
  ["tol 0.1", { entryToleranceR: 0.1 }],
  // expiry
  ["expiry 36", { orderExpiryBars: 36 }],
  ["expiry 48", { orderExpiryBars: 48 }],
  ["expiry 18", { orderExpiryBars: 18 }],
  // tier floor
  ["tierB 65", { tierB: 65 }],
  ["tierB 75", { tierB: 75 }],
  ["tierB 60", { tierB: 60 }],
  // cost gate
  ["costGate 0.30", { maxCostPctOfR: 0.3 }],
  ["costGate 0.40", { maxCostPctOfR: 0.4 }],
  ["costGate 0.45", { maxCostPctOfR: 0.45 }],
  // minRR — more trades welcome here
  ["minRR 1.5", { minRR: 1.5 }],
  ["minRR 1.75", { minRR: 1.75 }],
  // cooldown
  ["cooldown 6", { minBarsBetweenSignals: 6 }],
  ["cooldown 8", { minBarsBetweenSignals: 8 }],
  // freshness
  ["sweepAge 6", { maxSweepAgeBars: 6 }],
  ["sweepAge 10", { maxSweepAgeBars: 10 }],
  ["structAge 10", { maxStructureAgeBars: 10 }],
  ["structAge 18", { maxStructureAgeBars: 18 }],
  // quality floors
  ["sweepQ 0.30", { sweepQualityMin: 0.3 }],
  ["sweepQ 0.40", { sweepQualityMin: 0.4 }],
  ["dispQ 0.40", { displacementQualityMin: 0.4 }],
  ["dispQ 0.50", { displacementQualityMin: 0.5 }],
  ["zoneQ 0.35", { zoneQualityMin: 0.35 }],
  ["zoneQ 0.45", { zoneQualityMin: 0.45 }],
  // stop geometry
  ["minStopAtr 0.25", { minStopAtrMult: 0.25 }],
  ["minStopAtr 0.35", { minStopAtrMult: 0.35 }],
  ["maxStopAtr 2.0", { maxStopAtrMult: 2.0 }],
  ["maxStopAtr 3.0", { maxStopAtrMult: 3.0 }],
  // BE trigger
  ["beTrigger 0.8", { beTriggerR: 0.8 }],
  // max hold
  ["maxHold 72", { maxHoldBars: 72 }],
  ["maxHold 144", { maxHoldBars: 144 }],
];

console.log(`\n=== phase 1: ${V.length} variants on W1 (qualifier: trades>=${b1.trades} AND wr>=${b1.wr} AND net>${b1.net}) ===`);
const p1: Row[] = [];
for (const [label, over] of V) {
  const r = run(W1, label, over);
  p1.push(r);
  const ok = r.trades >= b1.trades && r.wr >= b1.wr && r.net > b1.net;
  console.log(`${ok ? "PASS" : "    "} ${line(r)}`);
}
const qualified = p1.filter((x) => x.trades >= b1.trades && x.wr >= b1.wr && x.net > b1.net).sort((a, b) => b.net - a.net);
console.log(`\nqualified: ${qualified.length ? qualified.map((x) => x.name).join(", ") : "NONE"}`);
writeFileSync("sweep3-results.json", JSON.stringify({ baseline: { W1: b1, W2: b2, W3: b3 }, phase1: p1 }, null, 2));
