/**
 * Task 21 phase 2 (combos) + phase 3 (walk-forward gate + Best-preset guard).
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
const line = (x: Row) => `${x.name.padEnd(42)} ${String(x.trades).padStart(4)}  ${x.wr.toFixed(1).padStart(5)}%  ${x.net >= 0 ? "+" : ""}${x.net.toFixed(2).padStart(7)}R  PF ${x.pf.toFixed(2).padStart(5)}  DD ${x.dd.toFixed(2)}R`;

const T25 = { entryToleranceR: 0.25 };
const T20 = { entryToleranceR: 0.2 };
const C8 = { minBarsBetweenSignals: 8 };
const P2550 = { partialShares: [0.25, 0.25, 0.5] };
const P3035 = { partialShares: [0.3, 0.35, 0.35] };
const B65 = { tierB: 65 };
const MS3 = { maxStopAtrMult: 3.0 };

const combos: [string, Record<string, unknown>][] = [
  ["T25+C8", { ...T25, ...C8 }],
  ["T25+P2550", { ...T25, ...P2550 }],
  ["T25+P3035", { ...T25, ...P3035 }],
  ["T25+B65", { ...T25, ...B65 }],
  ["T25+MS3", { ...T25, ...MS3 }],
  ["T25+C8+P2550", { ...T25, ...C8, ...P2550 }],
  ["T25+C8+P3035", { ...T25, ...C8, ...P3035 }],
  ["T25+C8+B65", { ...T25, ...C8, ...B65 }],
  ["T25+C8+MS3", { ...T25, ...C8, ...MS3 }],
  ["T20+C8", { ...T20, ...C8 }],
  ["T20+P2550", { ...T20, ...P2550 }],
  ["T20+C8+P2550", { ...T20, ...C8, ...P2550 }],
  ["T25+C8+P2550+B65", { ...T25, ...C8, ...P2550, ...B65 }],
  ["T25+C8+P3035+B65", { ...T25, ...C8, ...P3035, ...B65 }],
];

console.log("=== phase 2: combos on W1 (qualifier: trades>=194, wr>=71.6, net>31.23) ===");
const p2: Row[] = [];
for (const [label, over] of combos) {
  const r = run(W1, label, over);
  p2.push(r);
  const ok = r.trades >= 194 && r.wr >= 71.6 && r.net > 31.23;
  console.log(`${ok ? "PASS" : "    "} ${line(r)}`);
}
const passing = p2.filter((x) => x.trades >= 194 && x.wr >= 71.6 && x.net > 31.23).sort((a, b) => b.net - a.net);
if (!passing.length) { console.log("\nNO combo passes — keeping current Max R."); process.exit(0); }

const champName = passing[0].name;
const champOver = combos.find(([l]) => l === champName)![1];
console.log(`\n=== phase 3: walk-forward gate for "${champName}" ===`);
const cb2 = run(W2, "W2 baseline");
const cc2 = run(W2, "W2 champion", champOver);
const cb3 = run(W3, "W3 baseline");
const cc3 = run(W3, "W3 champion", champOver);
[cb2, cc2, cb3, cc3].forEach((x) => console.log(line(x)));
const gate2 = cc2.net >= cb2.net - 0.5;
const gate3 = cc3.net >= cb3.net - 0.5;
console.log(`\nW2 gate: ${gate2 ? "PASS" : "FAIL"} (${cc2.net.toFixed(2)} vs ${cb2.net.toFixed(2)})`);
console.log(`W3 gate: ${gate3 ? "PASS" : "FAIL"} (${cc3.net.toFixed(2)} vs ${cb3.net.toFixed(2)})`);

// Best-preset guard: champion shares engine knobs (partials/cooldown/tierB are
// engine-level). If the champion changed them, the BEST preset (kill zones,
// tol 0.15, partials 40/30/30) must NOT regress on W1.
const uiBest: Record<string, unknown> = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"], entryAnchor: "midpoint",
  entryToleranceR: 0.15, maxCostPctOfR: 0.35, obInvalidation: "close-mid",
  obDisplacementFactor: 1.2, tierB: 70,
};
const bestNow = runCsvBacktest({
  symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: W1, strictness: "balanced",
  config: csvConfigFromUi("XAUUSD" as SymbolKey, uiBest as never),
});
console.log(`\nBest guard (unchanged UI knobs, engine defaults): ${bestNow.trades.length} / ${bestNow.metrics.winRate}% / +${bestNow.metrics.netR}R (expect 91 / 80.2% / +20.70R)`);

console.log(`\nVERDICT: ${gate2 && gate3 ? "SHIP" : "HOLD"}`);
writeFileSync("sweep3-phase23.json", JSON.stringify({ phase2: p2, champion: { name: champName, over: champOver, W1: passing[0], W2: { baseline: cb2, champion: cc2 }, W3: { baseline: cb3, champion: cc3 }, bestGuard: { trades: bestNow.trades.length, wr: bestNow.metrics.winRate, net: bestNow.metrics.netR }, verdict: gate2 && gate3 ? "SHIP" : "HOLD" } }, null, 2));
