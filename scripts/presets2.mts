/**
 * Task 20 ship validation — measure all three UI presets at the NEW engine
 * defaults (expiry 30 · partials 40/30/30 · tolerance 0.15 · horizon 12),
 * plus honesty telemetry for the Best preset (tolerance-fill share,
 * pessimistic-ambiguity read, walk-forward periods).
 */
import { readFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);

function go(label: string, ui: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const r = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles,
    strictness: "balanced", config: { ...csvConfigFromUi("XAUUSD", ui as never), ...over } as never,
  });
  const wf = r.walkForward;
  const oos = wf.splits.find((s) => s.name.startsWith("OUT"))?.stats ?? null;
  const tolFills = r.trades.filter((t) => t.toleranceFill).length;
  console.log(`${label}:`);
  console.log(`  trades=${r.trades.length} wr=${r.metrics.winRate}% net=${r.metrics.netR}R pf=${r.metrics.profitFactor} dd=${r.metrics.maxDrawdownR}R`);
  console.log(`  flags=${r.flags.level} positivePeriods=${wf.positivePeriods}/${wf.periods.length} OOS=${oos ? oos.netR : "n/a"}R toleranceFills=${tolFills}/${r.trades.length}`);
  return r;
}

const best: Record<string, unknown> = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"], entryAnchor: "midpoint",
  entryToleranceR: 0.15, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70,
};
const base: Record<string, unknown> = {
  minRR: 2, beMode: "tp1", ambiguity: "pessimistic",
  sessions: [], entryAnchor: "edge",
  entryToleranceR: 0.05, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70,
};
const allSess: Record<string, unknown> = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: [], entryAnchor: "midpoint",
  entryToleranceR: 0.15, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70,
};

const bestRun = go("PRESET Best (verified)", best, { orderExpiryBars: 30 });
go("PRESET Conservative baseline", base, { orderExpiryBars: 24 });
go("PRESET All sessions · max R", allSess, { orderExpiryBars: 30 });

// honesty: pessimistic + randomized read at the new defaults
go("Best @ pessimistic ambiguity", best, { orderExpiryBars: 30, ambiguity: "pessimistic" });
go("Best @ randomized ambiguity", best, { orderExpiryBars: 30, ambiguity: "randomized" });

// walk-forward period detail for the Best preset
console.log("\nBest preset walk-forward periods:");
for (const p of bestRun.walkForward.periods) {
  console.log(`  ${p.label}: ${p.trades} trades, wr=${p.winRate}%, net=${p.netR}R`);
}
