/**
 * Task 22 phase 2+3 — combos of sweep4 qualifiers, then walk-forward gates.
 *
 * Phase-1 qualifiers (Best anchor 91 / 80.2% / +20.70R):
 *   tol 0.25 (102/87.3%/+24.56) · tol 0.2 (99/84.8%/+23.53) ·
 *   ladder 30/35/35 (91/81.3%/+22.95) · ladder 40/25/35 (91/81.3%/+21.20) ·
 *   ladder 30/30/40 (91/80.2%/+23.37 soft) · ladder 35/25/40 (soft) ·
 *   expiry 36 (STRICT) · expiry 42 (soft) · tierB 65/60 (STRICT) ·
 *   minRR 1.5/1.75 (STRICT)
 *
 * Gate: champion must beat baseline W2 AND W3 net R (walk-forward), and
 * carry trades >= 91, WR >= 80.2 on W1. WR-first ranking (Task 21).
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
  const r = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: cnds,
    strictness: "balanced", config: cfg as never,
  });
  return r;
}
const row = (name: string, r: ReturnType<typeof run>): Row =>
  ({ name, trades: r.trades.length, wr: r.metrics.winRate, net: r.metrics.netR, pf: r.metrics.profitFactor, dd: r.metrics.maxDrawdownR });
const line = (x: Row) => `${x.name.padEnd(40)} ${String(x.trades).padStart(4)}  ${x.wr.toFixed(1).padStart(5)}%  ${x.net >= 0 ? "+" : ""}${x.net.toFixed(2).padStart(7)}R  PF ${x.pf.toFixed(2).padStart(5)}  DD ${x.dd.toFixed(2)}R`;

console.log("=== baseline (current Best) ===");
const bW1 = row("W1", run(W1));
const bW2 = row("W2", run(W2));
const bW3 = row("W3", run(W3));
console.log(`${line(bW1)}\n${line(bW2)}\n${line(bW3)}`);

const T25 = { entryToleranceR: 0.25 };
const T2 = { entryToleranceR: 0.2 };
const T3 = { entryToleranceR: 0.3 };
const L303535 = { partialShares: [0.3, 0.35, 0.35] };
const L302545 = { partialShares: [0.3, 0.25, 0.45] };
const L253045 = { partialShares: [0.25, 0.3, 0.45] };
const L303040 = { partialShares: [0.3, 0.3, 0.4] };
const E36 = { orderExpiryBars: 36 };
const E42 = { orderExpiryBars: 42 };
const B65 = { tierB: 65 };
const R15 = { minRR: 1.5 };

const C: [string, Record<string, unknown>][] = [
  // how far does the tolerance lever go?
  ["tol 0.3", T3],
  ["tol 0.3 + 30/35/35", { ...T3, ...L303535 }],
  // tol 0.25 × ladder
  ["tol .25 + 30/35/35", { ...T25, ...L303535 }],
  ["tol .25 + 40/25/35", { ...T25, partialShares: [0.4, 0.25, 0.35] }],
  ["tol .25 + 30/30/40", { ...T25, ...L303040 }],
  ["tol .25 + 30/25/45", { ...T25, ...L302545 }],
  ["tol .25 + 25/30/45", { ...T25, ...L253045 }],
  // tol 0.2 × ladder
  ["tol .2 + 30/35/35", { ...T2, ...L303535 }],
  ["tol .2 + 30/30/40", { ...T2, ...L303040 }],
  // tol × expiry
  ["tol .25 + expiry 36", { ...T25, ...E36 }],
  ["tol .25 + expiry 42", { ...T25, ...E42 }],
  // tol × floors
  ["tol .25 + tierB 65", { ...T25, ...B65 }],
  ["tol .25 + minRR 1.5", { ...T25, ...R15 }],
  // triples / grand
  ["tol .25 + exp42 + 30/35/35", { ...T25, ...E42, ...L303535 }],
  ["tol .25 + exp42 + tierB65 + RR1.5", { ...T25, ...E42, ...B65, ...R15 }],
  ["tol .2 + exp42 + tierB65 + RR1.5", { ...T2, ...E42, ...B65, ...R15 }],
  ["tol .25 + 30/30/40 + exp42", { ...T25, ...L303040, ...E42 }],
  ["tol .25 + 30/35/35 + tierB65", { ...T25, ...L303535, ...B65 }],
];

console.log(`\n=== phase 2: ${C.length} combos on W1 ===`);
const p2: Row[] = [];
for (const [label, over] of C) {
  const r = row(label, run(W1, over));
  p2.push(r);
  const ok = r.trades >= bW1.trades && r.wr >= bW1.wr && r.net > bW1.net;
  console.log(`${ok ? "PASS" : "    "} ${line(r)}`);
}

const qual = p2.filter((x) => x.trades >= bW1.trades && x.wr >= bW1.wr && x.net > bW1.net)
  .sort((a, b) => b.wr - a.wr || b.net - a.net);
if (!qual.length) { console.log("\nNO COMBO QUALIFIED"); process.exit(0); }

console.log("\n=== phase 3: walk-forward gates on top-3 (must beat baseline W2/W3) ===");
const verdicts: { name: string; w1: Row; w2: Row; w3: Row; ship: boolean }[] = [];
for (const cand of qual.slice(0, 3)) {
  // recover the override set by name — rerun via matched label
  const found = C.find(([l]) => l === cand.name)!;
  const w2 = row("W2", run(W2, found[1]));
  const w3 = row("W3", run(W3, found[1]));
  const ship = w2.net > bW2.net && w3.net > bW3.net;
  verdicts.push({ name: cand.name, w1: cand, w2, w3, ship });
  console.log(`\n[${cand.name}] ${ship ? "SHIP-CANDIDATE" : "REJECT"}`);
  console.log(`  W1 ${line(cand)}`);
  console.log(`  W2 ${line(w2)}   (baseline ${bW2.net >= 0 ? "+" : ""}${bW2.net.toFixed(2)}R @ ${bW2.wr.toFixed(1)}%)`);
  console.log(`  W3 ${line(w3)}   (baseline ${bW3.net >= 0 ? "+" : ""}${bW3.net.toFixed(2)}R @ ${bW3.wr.toFixed(1)}%)`);
}

const champ = verdicts.filter((v) => v.ship).sort((a, b) => b.w1.wr - a.w1.wr || b.w1.net - a.w1.net)[0];
console.log(`\n=== CHAMPION: ${champ ? champ.name : "none"} ===`);
writeFileSync("sweep4-phase23.json", JSON.stringify({ baseline: { W1: bW1, W2: bW2, W3: bW3 }, phase2: p2, verdicts, champion: champ ?? null }, null, 2));

if (champ) {
  // honesty telemetry on the champion
  const over = C.find(([l]) => l === champ.name)![1];
  const cfg = { ...base, ...over } as never;
  const pess = runCsvBacktest({ symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: W1, strictness: "balanced", config: { ...(base as never), ...(over as never), ambiguity: "pessimistic" } as never });
  const rand = runCsvBacktest({ symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: W1, strictness: "balanced", config: { ...(base as never), ...(over as never), ambiguity: "randomized" } as never });
  const tf = champ.w1.trades ? pess.orderFlow?.toleranceFills : 0;
  console.log(`\npessimistic read: ${pess.metrics.winRate.toFixed(1)}% / ${pess.metrics.netR >= 0 ? "+" : ""}${pess.metrics.netR.toFixed(2)}R (spread ${(champ.w1.wr - pess.metrics.winRate).toFixed(1)}pp)`);
  console.log(`randomized read:  ${rand.metrics.winRate.toFixed(1)}% / ${rand.metrics.netR >= 0 ? "+" : ""}${rand.metrics.netR.toFixed(2)}R`);
  console.log(`OOS periods: ${(pess.walkForward?.periods ?? []).map((p: { stats: { netR: number } }) => p.stats.netR.toFixed(2)).join(" / ")}`);
  console.log(`flags: ${pess.flags?.level ?? "?"}`);
  console.log(`tolerance fills (pess run): ${pess.orderFlow?.toleranceFills ?? "n/a"} of ${pess.trades.length}`);
}
