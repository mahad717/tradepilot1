/**
 * Task 21 final ship-state measurement:
 *  - engine default now minBarsBetweenSignals 8
 *  - Best preset: kill zones · tol 0.15 · ladder 40/30/30 (unchanged numbers expected)
 *  - Max R preset champion: all sessions · tol 0.25 · ladder 25/25/50
 *  - Baseline preset re-measured (cooldown change shifts it slightly)
 *  - T25 walk-forward gate on W2/W3 + pessimistic/randomized reads
 */
import { readFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);
const N = candles.length;
const W2 = candles.slice(0, N - 30000);
const W3 = candles.slice(0, N - 60000);

function go(label: string, ui: Record<string, unknown>, cnds: typeof candles = candles) {
  const r = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: cnds,
    strictness: "balanced", config: csvConfigFromUi("XAUUSD" as SymbolKey, ui as never),
  });
  const wf = r.walkForward;
  const oos = wf.splits.find((s) => s.name.startsWith("OUT"))?.stats ?? null;
  const tolFills = r.trades.filter((t) => t.toleranceFill).length;
  console.log(`${label}:`);
  console.log(`  ${r.trades.length} trades · ${r.metrics.winRate}% WR · PF ${r.metrics.profitFactor} · DD ${r.metrics.maxDrawdownR}R · +${r.metrics.netR}R · flags=${r.flags.level} · ${wf.positivePeriods}/${wf.periods.length} periods · OOS ${oos ? oos.netR : "n/a"}R · tolFills ${tolFills}/${r.trades.length}`);
  return r;
}

const best: Record<string, unknown> = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"], entryAnchor: "midpoint",
  entryToleranceR: 0.15, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70, partialShares: [0.4, 0.3, 0.3],
};
const maxr: Record<string, unknown> = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: [], entryAnchor: "midpoint",
  entryToleranceR: 0.25, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70, partialShares: [0.25, 0.25, 0.5],
};
const base: Record<string, unknown> = {
  minRR: 2, beMode: "tp1", ambiguity: "pessimistic",
  sessions: [], entryAnchor: "edge",
  entryToleranceR: 0.05, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70, partialShares: [0.4, 0.3, 0.3],
};

console.log("=== presets at final ship state (engine cooldown 8) ===");
go("PRESET Best (verified)", best);
go("PRESET Max R champion", maxr);
go("PRESET Conservative baseline", base);

console.log("\n=== Max R honesty reads ===");
go("Max R @ pessimistic", { ...maxr, ambiguity: "pessimistic" });
go("Max R @ randomized", { ...maxr, ambiguity: "randomized" });

console.log("\n=== T25 champion walk-forward gate ===");
const b2 = go("W2 Max R OLD (tol 0.15, ladder 40/30/30)", { ...maxr, entryToleranceR: 0.15, partialShares: [0.4, 0.3, 0.3] }, W2);
const b3 = go("W3 Max R OLD", { ...maxr, entryToleranceR: 0.15, partialShares: [0.4, 0.3, 0.3] }, W3);
const c2 = go("W2 Max R champion", maxr, W2);
const c3 = go("W3 Max R champion", maxr, W3);
console.log(`\nW2 gate: ${c2.metrics.netR >= b2.metrics.netR - 0.5 ? "PASS" : "FAIL"} (${c2.metrics.netR} vs ${b2.metrics.netR})`);
console.log(`W3 gate: ${c3.metrics.netR >= b3.metrics.netR - 0.5 ? "PASS" : "FAIL"} (${c3.metrics.netR} vs ${b3.metrics.netR})`);

const bf = go("Best @ pessimistic (guard)", { ...best, ambiguity: "pessimistic" });
