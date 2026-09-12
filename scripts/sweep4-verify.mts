/**
 * Task 22 — final ship verification for the London+NY champion.
 * Ship candidate: tol 0.25 + ladder 30/35/35 + tierB 65 (fill assumption
 * held at the product's already-shipped 0.25R ceiling — same as Max R).
 * Also: honesty telemetry (tolerance-fill share, pessimistic/randomized,
 * OOS, flags) + regression checks that Max R & baseline presets are
 * untouched, + the measured-but-HELD 0.3/0.4 record for the worklog.
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

const run = (cnds: typeof candles, ui: Record<string, unknown>, amb = "optimistic") => {
  const cfg = { ...csvConfigFromUi("XAUUSD" as SymbolKey, ui as never), ambiguity: amb } as never;
  return runCsvBacktest({ symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: cnds, strictness: "balanced", config: cfg });
};
const fmt = (label: string, r: ReturnType<typeof run>) =>
  `${label.padEnd(30)} ${String(r.trades.length).padStart(4)}  ${r.metrics.winRate.toFixed(1).padStart(5)}%  ${(r.metrics.netR >= 0 ? "+" : "") + r.metrics.netR.toFixed(2).padStart(7)}R  PF ${r.metrics.profitFactor.toFixed(2).padStart(5)}  DD ${r.metrics.maxDrawdownR.toFixed(2)}R`;

// ---- preset configs (exactly what the UI sends) ----
const bestOld = { sessions: ["london", "ny-am", "ny-pm"], beMode: "tp1cost", ambiguity: "optimistic", entryAnchor: "midpoint", entryToleranceR: 0.15, orderExpiryBars: 30, partialShares: [0.4, 0.3, 0.3], maxCostPctOfR: 0.35, minRR: 2, tierB: 70, obInvalidation: "close-mid", obDisplacementFactor: 1.2 };
const bestNew = { ...bestOld, entryToleranceR: 0.25, partialShares: [0.3, 0.35, 0.35], tierB: 65 };
const maxr = { sessions: [], beMode: "tp1cost", ambiguity: "optimistic", entryAnchor: "midpoint", entryToleranceR: 0.25, orderExpiryBars: 30, partialShares: [0.25, 0.25, 0.5], maxCostPctOfR: 0.35, minRR: 2, tierB: 70, obInvalidation: "close-mid", obDisplacementFactor: 1.2 };
const baseline = { sessions: [], beMode: "tp1", ambiguity: "pessimistic", entryAnchor: "edge", entryToleranceR: 0.05, orderExpiryBars: 24, partialShares: [0.4, 0.3, 0.3], maxCostPctOfR: 0.35, minRR: 2, tierB: 70, obInvalidation: "close-mid", obDisplacementFactor: 1.2 };

console.log("=== SHIP VERIFICATION ===");
const oldW1 = run(W1, bestOld);
console.log(fmt("Best OLD (regression)", oldW1));
const newW1 = run(W1, bestNew);
console.log(fmt("Best NEW (ship candidate)", newW1));
const newW2 = run(W2, bestNew);
const newW3 = run(W3, bestNew);
const oldW2 = run(W2, bestOld);
const oldW3 = run(W3, bestOld);
console.log(fmt("Best NEW W2 (unseen)", newW2) + `   old ${oldW2.metrics.netR.toFixed(2)}R`);
console.log(fmt("Best NEW W3 (unseen)", newW3) + `   old ${oldW3.metrics.netR.toFixed(2)}R`);

console.log("\n=== honesty telemetry (Best NEW) ===");
const pess = run(W1, bestNew, "pessimistic");
const rand = run(W1, bestNew, "randomized");
console.log(fmt("pessimistic", pess));
console.log(fmt("randomized", rand));
const tolFills = newW1.trades.filter((t) => (t as { toleranceFill?: boolean }).toleranceFill).length;
console.log(`tolerance fills: ${tolFills}/${newW1.trades.length} (${(100 * tolFills / newW1.trades.length).toFixed(0)}%) — old config: ${oldW1.trades.filter((t) => (t as { toleranceFill?: boolean }).toleranceFill).length}/${oldW1.trades.length}`);
console.log(`flags: ${newW1.flags.level}   walk-forward: ${newW1.walkForward.positivePeriods}/${newW1.walkForward.periods.length} periods`);
const oos = newW1.walkForward.splits.filter((s) => s.name.startsWith("OUT")).map((s) => `${s.name} ${s.stats.netR >= 0 ? "+" : ""}${s.stats.netR.toFixed(2)}R`);
console.log(`OOS splits: ${oos.join(" · ")}`);

console.log("\n=== regression: Max R & baseline presets must be UNCHANGED ===");
const mx = run(W1, maxr);
console.log(fmt("Max R (expect 209/82.3/+50.38)", mx));
const bl = run(W1, baseline);
console.log(fmt("Baseline (expect 181/35.4/+7.11)", bl));

console.log("\n=== measured-but-HELD record (fill realism ceiling) ===");
for (const t of [0.3, 0.4]) {
  const r = run(W1, { ...bestOld, entryToleranceR: t, partialShares: [0.3, 0.35, 0.35], tierB: 65 });
  const tf = r.trades.filter((x) => (x as { toleranceFill?: boolean }).toleranceFill).length;
  console.log(fmt(`tol ${t} + 30/35/35 + tierB65`, r) + `   tol-fills ${tf}/${r.trades.length} (${(100 * tf / r.trades.length).toFixed(0)}%)`);
}

writeFileSync("sweep4-ship.json", JSON.stringify({
  bestOld: { w1: oldW1.metrics, w2: oldW2.metrics, w3: oldW3.metrics },
  bestNew: { w1: newW1.metrics, w2: newW2.metrics, w3: newW3.metrics, tolFills, flags: newW1.flags.level, periods: newW1.walkForward.positivePeriods, pess: pess.metrics, rand: rand.metrics, oos: newW1.walkForward.splits.filter((s) => s.name.startsWith("OUT")).map((s) => ({ name: s.name, netR: s.stats.netR })) },
  maxr: mx.metrics, baseline: bl.metrics,
}, null, 2));
console.log("\nsaved scripts/sweep4-ship.json");
