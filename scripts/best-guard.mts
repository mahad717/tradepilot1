/** Ship decision: can cooldown 8 / partials 25/25/50 become ENGINE defaults
 * without degrading the Best (kill-zone) preset? Test each on W1. */
import { readFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);

const uiBest: Record<string, unknown> = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"], entryAnchor: "midpoint",
  entryToleranceR: 0.15, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70,
};
const go = (label: string, over: Record<string, unknown>) => {
  const r = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles, strictness: "balanced",
    config: { ...csvConfigFromUi("XAUUSD" as SymbolKey, uiBest as never), ...over } as never,
  });
  console.log(`${label.padEnd(28)} ${String(r.trades.length).padStart(4)}  ${r.metrics.winRate.toFixed(1)}%  +${r.metrics.netR}R  PF ${r.metrics.profitFactor}  DD ${r.metrics.maxDrawdownR}R`);
};
console.log("Best preset under candidate engine defaults (W1):");
go("current (C12, P40/30/30)", {});
go("cooldown 8", { minBarsBetweenSignals: 8 });
go("partials 25/25/50", { partialShares: [0.25, 0.25, 0.5] });
go("cooldown 8 + 25/25/50", { minBarsBetweenSignals: 8, partialShares: [0.25, 0.25, 0.5] });
