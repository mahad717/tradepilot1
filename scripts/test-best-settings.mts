/**
 * Bit-exact reproduction of the Task-20 walk-forward sweep champion with the
 * NEW shipped defaults (engine: expiry 30 · partials 40/30/30 · tolerance
 * 0.15R · horizon 12R; product: London+NY · BE+ costs · optimistic · midpoint)
 * on the real XAUUSD 15m CSV (480,717 candles, engine caps to the last 25k).
 *
 * Expected (deterministic, seed 42): 91 trades · 80.2% WR · PF 17.43 ·
 * maxDD 0.26R · +20.70R net · OOS +9.03R · 5/5 periods GREEN, and the champion
 * must IMPROVE both unseen walk-forward windows (W2/W3) vs the old defaults.
 */
import { readFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi, dimensionPlan } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  PASS  ${name} — ${detail}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${detail}`); }
}
const near = (a: number, b: number, eps = 0.06) => Math.abs(a - b) <= eps;

const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);

const ui = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"], entryAnchor: "midpoint",
  entryToleranceR: 0.15, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70,
};

console.log("=== shipped-default run (production window, last 25k) ===");
const r = runCsvBacktest({
  symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles,
  strictness: "balanced", config: csvConfigFromUi("XAUUSD" as SymbolKey, ui),
});
const m = r.metrics;

check("trade count", r.trades.length === 91, `91 expected, got ${r.trades.length}`);
check("win rate", near(m.winRate, 80.2, 0.1), `80.2% expected, got ${m.winRate}%`);
check("profit factor", near(m.profitFactor, 17.43, 0.05), `17.43 expected, got ${m.profitFactor}`);
check("net R", near(m.netR, 20.7, 0.06), `+20.70R expected, got ${m.netR}R`);
check("max drawdown", near(m.maxDrawdownR, 0.26, 0.02), `0.26R expected, got ${m.maxDrawdownR}R`);
check("robustness flags", r.flags.level === "GREEN", `GREEN expected, got ${r.flags.level}`);
check("walk-forward periods", r.walkForward.positivePeriods === 5 && r.walkForward.periods.length === 5, `5/5 expected, got ${r.walkForward.positivePeriods}/${r.walkForward.periods.length}`);
const oos = r.walkForward.splits.find((s) => s.name.startsWith("OUT"))?.stats;
check("OOS split", !!oos && near(oos.netR, 9.03, 0.1), `+9.03R expected, got ${oos ? oos.netR : "n/a"}R`);

console.log("\n=== config echo (engine defaults threaded through) ===");
check("expiry default 30", r.config.orderExpiryBars === 30, `30 expected, got ${r.config.orderExpiryBars}`);
check("tolerance default 0.15", r.config.entryToleranceR === 0.15, `0.15 expected, got ${r.config.entryToleranceR}`);
check("partials 40/30/30", JSON.stringify(r.config.partialShares) === "[0.4,0.3,0.3]", `expected [0.4,0.3,0.3], got ${JSON.stringify(r.config.partialShares)}`);
check("horizon default 12", r.config.targetHorizonR === 12, `12 expected, got ${r.config.targetHorizonR}`);
const tolFills = r.trades.filter((t) => t.toleranceFill).length;
check("tolerance fills counted", tolFills === 43, `43 expected, got ${tolFills}`);

console.log("\n=== ambiguity honesty spread at new defaults ===");
const amb = (mode: string) => {
  const rr = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles, strictness: "balanced",
    config: { ...csvConfigFromUi("XAUUSD" as SymbolKey, ui), ambiguity: mode } as never,
  });
  return rr.metrics;
};
const pess = amb("pessimistic");
const rand = amb("randomized");
check("pessimistic read", near(pess.winRate, 78.0, 0.1) && near(pess.netR, 19.71, 0.1), `78.0% / +19.71R expected, got ${pess.winRate}% / ${pess.netR}R`);
check("randomized read", near(rand.winRate, 79.1, 0.1) && near(rand.netR, 20.34, 0.1), `79.1% / +20.34R expected, got ${rand.winRate}% / ${rand.netR}R`);
check("spread tight (<= 2.5pp)", m.winRate - pess.winRate <= 2.5, `${(m.winRate - pess.winRate).toFixed(1)}pp pessimistic→optimistic`);

console.log("\n=== walk-forward generalization gate (unseen windows) ===");
const N = candles.length;
const W2 = candles.slice(0, N - 30000);
const W3 = candles.slice(0, N - 60000);
const oldUi = { ...ui, entryToleranceR: 0.05 };
const oldOver = { orderExpiryBars: 24, targetHorizonR: 8, partialShares: [0.5, 0.25, 0.25] };
for (const [label, w] of [["W2", W2], ["W3", W3]] as const) {
  const oldRun = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: w, strictness: "balanced",
    config: { ...csvConfigFromUi("XAUUSD" as SymbolKey, oldUi), ...oldOver } as never,
  });
  const newRun = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: w, strictness: "balanced",
    config: csvConfigFromUi("XAUUSD" as SymbolKey, ui),
  });
  check(`${label} champion >= old defaults`, newRun.metrics.netR > oldRun.metrics.netR, `new ${newRun.metrics.netR}R vs old ${oldRun.metrics.netR}R (wr ${newRun.metrics.winRate}% vs ${oldRun.metrics.winRate}%)`);
}

console.log("\n=== compare plans ===");
const expPlan = dimensionPlan("expiry");
check("expiry rows 12/24/30", expPlan.length === 3 && expPlan[0].label === "12-bar expiry" && expPlan[1].label === "24-bar expiry" && expPlan[2].label === "30-bar expiry", expPlan.map((x) => x.label).join(" | "));
const entryPlan = dimensionPlan("entry");
check("entry rows with 0.15R", entryPlan.length === 4 && entryPlan[3].label === "Midpoint + 0.15R tolerance", entryPlan.map((x) => x.label).join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
