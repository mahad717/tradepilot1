/**
 * Task 22 probe — is tol 0.3 the peak? Test 0.35/0.4 alone and × top
 * ladders from phase 2 (30/35/35, 30/30/40, 25/30/45, 35/30/35), plus
 * tol 0.3 × expiry 42. Gate top result on W2/W3 before declaring champion.
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

const uiBase = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"] as string[],
  entryAnchor: "midpoint", entryToleranceR: 0.15, maxCostPctOfR: 0.35,
  obInvalidation: "close-mid", obDisplacementFactor: 1.2, tierB: 70,
};
const base = csvConfigFromUi("XAUUSD" as SymbolKey, uiBase as never);

interface Row { name: string; trades: number; wr: number; net: number; pf: number; dd: number; }
function run(cnds: typeof candles, over: Record<string, unknown> = {}) {
  const cfg: Record<string, unknown> = { ...base, ...over };
  return runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: cnds,
    strictness: "balanced", config: cfg as never,
  });
}
const row = (name: string, r: ReturnType<typeof run>): Row =>
  ({ name, trades: r.trades.length, wr: r.metrics.winRate, net: r.metrics.netR, pf: r.metrics.profitFactor, dd: r.metrics.maxDrawdownR });
const line = (x: Row) => `${x.name.padEnd(28)} ${String(x.trades).padStart(4)}  ${x.wr.toFixed(1).padStart(5)}%  ${x.net >= 0 ? "+" : ""}${x.net.toFixed(2).padStart(7)}R  PF ${x.pf.toFixed(2).padStart(5)}  DD ${x.dd.toFixed(2)}R`;

const T = (t: number) => ({ entryToleranceR: t });
const L: Record<string, [number, number, number]> = {
  "30/35/35": [0.3, 0.35, 0.35],
  "30/30/40": [0.3, 0.3, 0.4],
  "25/30/45": [0.25, 0.3, 0.45],
  "35/30/35": [0.35, 0.3, 0.35],
  "40/30/30": [0.4, 0.3, 0.3],
};

const C: [string, Record<string, unknown>][] = [
  ["tol 0.35", T(0.35)],
  ["tol 0.4", T(0.4)],
  ["tol .3 + 30/30/40", { ...T(0.3), partialShares: L["30/30/40"] }],
  ["tol .3 + 25/30/45", { ...T(0.3), partialShares: L["25/30/45"] }],
  ["tol .3 + 35/30/35", { ...T(0.3), partialShares: L["35/30/35"] }],
  ["tol .35 + 30/35/35", { ...T(0.35), partialShares: L["30/35/35"] }],
  ["tol .35 + 30/30/40", { ...T(0.35), partialShares: L["30/30/40"] }],
  ["tol .4 + 30/35/35", { ...T(0.4), partialShares: L["30/35/35"] }],
  ["tol .3 + exp42 + 30/35/35", { ...T(0.3), orderExpiryBars: 42, partialShares: L["30/35/35"] }],
  ["tol .3 + tierB65 + 30/35/35", { ...T(0.3), tierB: 65, partialShares: L["30/35/35"] }],
];

console.log("=== probe: tolerance peak + ladder interactions (W1) ===");
const p: Row[] = [];
for (const [label, over] of C) {
  const r = row(label, run(W1, over));
  p.push(r);
  console.log(line(r));
}
writeFileSync("sweep4-probe.json", JSON.stringify({ phase2b: p }, null, 2));

// gate the best 2 by (wr, net) on W2/W3
const top = [...p].filter((x) => x.trades >= 91).sort((a, b) => b.wr - a.wr || b.net - a.net).slice(0, 2);
console.log("\n=== W2/W3 gate on top-2 ===");
for (const cand of top) {
  const found = C.find(([l]) => l === cand.name)!;
  const w2 = row("W2", run(W2, found[1]));
  const w3 = row("W3", run(W3, found[1]));
  console.log(`\n[${cand.name}] ${w2.net > 3.10 && w3.net > 1.82 ? "SHIP-CANDIDATE" : "REJECT"}`);
  console.log(`  W1 ${line(cand)}`);
  console.log(`  W2 ${line(w2)}`);
  console.log(`  W3 ${line(w3)}`);
}
