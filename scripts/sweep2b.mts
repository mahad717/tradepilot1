/**
 * Sweep v2 — phase 2 (interactions) + phase 3 (walk-forward gate).
 *
 * Phase 2: combine the phase-1 qualifiers (expiry30/36, partials 40/30/30,
 * horizon 10/12, tol 0.15, maxHold 48, minStopAtr 0.35) into pair/triple/
 * quad combos on W1 (production tail 25k).
 *
 * Phase 3: the top combo must survive the walk-forward gate:
 *   W1: trades >= 79 AND wr >= 75.9 AND net > 11.09   (ship condition)
 *   W2/W3: net NOT worse than baseline by more than 0.5R (overfit guard —
 *   those windows were never used for selection)
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
const line = (x: Row) => `${x.name.padEnd(38)} ${String(x.trades).padStart(4)}  ${x.wr.toFixed(1).padStart(5)}%  ${x.net >= 0 ? "+" : ""}${x.net.toFixed(2).padStart(6)}R  PF ${x.pf.toFixed(2).padStart(5)}  DD ${x.dd.toFixed(2)}R`;

// knobs
const E30 = { orderExpiryBars: 30 };
const E36 = { orderExpiryBars: 36 };
const P40 = { partialShares: [0.4, 0.3, 0.3] };
const H12 = { targetHorizonR: 12 };
const T15 = { entryToleranceR: 0.15 };
const MH48 = { maxHoldBars: 48 };
const MS035 = { minStopAtrMult: 0.35 };

const combos: [string, Record<string, unknown>][] = [
  ["E30+P40", { ...E30, ...P40 }],
  ["E30+H12", { ...E30, ...H12 }],
  ["E30+T15", { ...E30, ...T15 }],
  ["E30+MH48", { ...E30, ...MH48 }],
  ["E30+P40+H12", { ...E30, ...P40, ...H12 }],
  ["E30+P40+T15", { ...E30, ...P40, ...T15 }],
  ["E30+P40+MH48", { ...E30, ...P40, ...MH48 }],
  ["E30+P40+H12+MH48", { ...E30, ...P40, ...H12, ...MH48 }],
  ["E30+P40+T15+H12", { ...E30, ...P40, ...T15, ...H12 }],
  ["E36+P40", { ...E36, ...P40 }],
  ["P40+H12", { ...P40, ...H12 }],
  ["P40+T15", { ...P40, ...T15 }],
  ["P40+H12+T15", { ...P40, ...H12, ...T15 }],
  ["H12+T15", { ...H12, ...T15 }],
  ["P40+MS035", { ...P40, ...MS035 }],
  ["GRAND E30+P40+H12+T15+MH48", { ...E30, ...P40, ...H12, ...T15, ...MH48 }],
];

console.log("=== phase 2: interaction combos on W1 ===");
const p2: Row[] = [];
for (const [label, over] of combos) {
  const r = run(W1, label, over);
  p2.push(r);
  const ok = r.trades >= 79 && r.wr >= 75.9 && r.net > 11.09;
  console.log(`${ok ? "PASS" : "    "} ${line(r)}`);
}

const passing = p2.filter((x) => x.trades >= 79 && x.wr >= 75.9 && x.net > 11.09).sort((a, b) => b.net - a.net);
if (!passing.length) {
  console.log("\nNO combo passes the ship gate on W1 — keeping current defaults.");
  writeFileSync("sweep2-phase2.json", JSON.stringify(p2, null, 2));
  process.exit(0);
}

// ------------------------------------------------------------- phase 3 --
const champName = passing[0].name;
const champOver = combos.find(([l]) => l === champName)![1];
console.log(`\n=== phase 3: walk-forward gate for champion "${champName}" ===`);
const cb2 = run(W2, "W2 baseline");
const cc2 = run(W2, "W2 champion", champOver);
const cb3 = run(W3, "W3 baseline");
const cc3 = run(W3, "W3 champion", champOver);
[cb2, cc2, cb3, cc3].forEach((x) => console.log(line(x)));

const gate2 = cc2.net >= cb2.net - 0.5;
const gate3 = cc3.net >= cb3.net - 0.5;
console.log(`\nW2 gate: ${gate2 ? "PASS" : "FAIL"} (champion ${cc2.net.toFixed(2)}R vs baseline ${cb2.net.toFixed(2)}R)`);
console.log(`W3 gate: ${gate3 ? "PASS" : "FAIL"} (champion ${cc3.net.toFixed(2)}R vs baseline ${cb3.net.toFixed(2)}R)`);
console.log(`\nVERDICT: ${gate2 && gate3 ? "SHIP — champion survives both unseen windows" : "HOLD — champion fails the unseen-window gate; keep current defaults"}`);

writeFileSync("sweep2-phase23.json", JSON.stringify({
  phase2: p2, champion: { name: champName, over: champOver, W1: passing[0], W2: { baseline: cb2, champion: cc2 }, W3: { baseline: cb3, champion: cc3 }, verdict: gate2 && gate3 ? "SHIP" : "HOLD" },
}, null, 2));
