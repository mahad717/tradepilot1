/**
 * Task 22 — push the "★ Best (London + NY)" preset further.
 * Base: london,ny-am,ny-pm · BE+ costs (tp1cost) · optimistic · midpoint ·
 * tol 0.15 · expiry 30 · ladder 40/30/30 · horizon 12 · cooldown 8.
 * Anchor: 91 trades · 80.2% WR · +20.70R (Task 20 champion, unchanged by
 * Task 21's cooldown-8 default — verified no-op on this profile).
 *
 * Fresh angle vs sweep2: only families NEVER swept on Best (or newly
 * interacting with the Task-21 engine). Sweep2 results remain valid for
 * already-covered dims (cooldown 8 no-op ⇒ identical base), so we do NOT
 * repeat them.
 *   - tolerance 0.20/0.25 (sweep2 only tried 0.075/0.1/0.15 — and tolerance
 *     was the deepest lever on the Max-R profile in Task 21)
 *   - full partial-ladder grid (only 40/30/30 and 25/25/50 ever tried here)
 *   - model subsets (never tested anywhere): drop A/B/C/D, add E_SMT
 *   - zone hygiene toggles: sameZoneCooldown / oneTradePerSweep
 *   - stop geometry: maxStopAtr 3.0, maxStopPctOfPrice
 *   - tierB 60/65/75, minRR 1.5/1.75, costGate 0.30/0.45
 *   - confluence gates: allowUnconfirmedSweep off, requireDiscountPremium,
 *     block HIGH vol
 *   - BE trigger timing under tp1cost, maxHold retest, range lookback
 *
 * Constraint (standing): trades >= 91 AND WR >= 80.2 AND net > 20.70.
 * WR-first hierarchy (Task 21): strict WR gains rank above equal-WR/net-only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);
const N = candles.length;
const W1 = candles;

const uiBase = {
  minRR: 2, beMode: "tp1cost", ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"] as string[],
  entryAnchor: "midpoint", entryToleranceR: 0.15, maxCostPctOfR: 0.35,
  obInvalidation: "close-mid", obDisplacementFactor: 1.2, tierB: 70,
};
const base = csvConfigFromUi("XAUUSD" as SymbolKey, uiBase as never);

interface Row { name: string; trades: number; wr: number; net: number; pf: number; dd: number; }
function run(cnds: typeof candles, label: string, over: Record<string, unknown> = {}): Row {
  const cfg: Record<string, unknown> = { ...base, ...over };
  const r = runCsvBacktest({
    symbol: "XAUUSD" as SymbolKey, csvSummary: summary, candles: cnds,
    strictness: "balanced", config: cfg as never,
  });
  return { name: label, trades: r.trades.length, wr: r.metrics.winRate, net: r.metrics.netR, pf: r.metrics.profitFactor, dd: r.metrics.maxDrawdownR };
}
const line = (x: Row) => `${x.name.padEnd(26)} ${String(x.trades).padStart(4)}  ${x.wr.toFixed(1).padStart(5)}%  ${x.net >= 0 ? "+" : ""}${x.net.toFixed(2).padStart(7)}R  PF ${x.pf.toFixed(2).padStart(5)}  DD ${x.dd.toFixed(2)}R`;

console.log("=== Best baselines (sanity: must be 91 / 80.2 / +20.70) ===");
const b1 = run(W1, "W1 tail (production)");
console.log(line(b1));

const M = ["A_SWEEP_REVERSAL", "B_FVG_CONTINUATION", "C_OB_REVERSAL", "D_FVG_OB_CONFLUENCE", "E_SMT_REVERSAL"];
const without = (k: string) => M.filter((m) => m !== k);

const V: [string, Record<string, unknown>][] = [
  // tolerance — never swept past 0.15 on Best; deepest lever on Max-R
  ["tol 0.2", { entryToleranceR: 0.2 }],
  ["tol 0.25", { entryToleranceR: 0.25 }],
  // ladder grid — only 40/30/30 & 25/25/50 ever tried on this profile
  ["ladder 35/30/35", { partialShares: [0.35, 0.3, 0.35] }],
  ["ladder 30/30/40", { partialShares: [0.3, 0.3, 0.4] }],
  ["ladder 45/25/30", { partialShares: [0.45, 0.25, 0.3] }],
  ["ladder 40/25/35", { partialShares: [0.4, 0.25, 0.35] }],
  ["ladder 35/25/40", { partialShares: [0.35, 0.25, 0.4] }],
  ["ladder 45/30/25", { partialShares: [0.45, 0.3, 0.25] }],
  ["ladder 30/35/35", { partialShares: [0.3, 0.35, 0.35] }],
  ["ladder 40/40/20", { partialShares: [0.4, 0.4, 0.2] }],
  ["ladder 35/35/30", { partialShares: [0.35, 0.35, 0.3] }],
  ["ladder 50/20/30", { partialShares: [0.5, 0.2, 0.3] }],
  ["ladder 30/25/45", { partialShares: [0.3, 0.25, 0.45] }],
  ["ladder 25/30/45", { partialShares: [0.25, 0.3, 0.45] }],
  // horizon beyond 12
  ["horizon 10", { targetHorizonR: 10 }],
  ["horizon 14", { targetHorizonR: 14 }],
  ["horizon 16", { targetHorizonR: 16 }],
  // expiry around 30
  ["expiry 24", { orderExpiryBars: 24 }],
  ["expiry 36", { orderExpiryBars: 36 }],
  ["expiry 42", { orderExpiryBars: 42 }],
  // tier floor — never swept on Best
  ["tierB 65", { tierB: 65 }],
  ["tierB 60", { tierB: 60 }],
  ["tierB 75", { tierB: 75 }],
  // minRR
  ["minRR 1.75", { minRR: 1.75 }],
  ["minRR 1.5", { minRR: 1.5 }],
  // stop geometry
  ["maxStopAtr 3.0", { maxStopAtrMult: 3.0 }],
  ["maxStopPct 0.015", { maxStopPctOfPrice: 0.015 }],
  ["maxStopPct 0.03", { maxStopPctOfPrice: 0.03 }],
  // cost gate
  ["costGate 0.30", { maxCostPctOfR: 0.3 }],
  ["costGate 0.45", { maxCostPctOfR: 0.45 }],
  // zone hygiene — defaults true, never toggled
  ["zoneCooldown off", { sameZoneCooldown: false }],
  ["onePerSweep off", { oneTradePerSweep: false }],
  // model subsets — never tested anywhere
  ["drop A sweep", { models: without("A_SWEEP_REVERSAL") }],
  ["drop B fvg", { models: without("B_FVG_CONTINUATION") }],
  ["drop C ob", { models: without("C_OB_REVERSAL") }],
  ["drop D confluence", { models: without("D_FVG_OB_CONFLUENCE") }],
  ["add E smt", { models: M }],
  // confluence gates
  ["confirmed sweeps only", { allowUnconfirmedSweep: false }],
  ["req premium/discount", { requireDiscountPremium: true }],
  ["block HIGH vol", { blockedVolRegimes: ["EXTREME", "HIGH"] }],
  // BE trigger timing under tp1cost
  ["beTrigger 0.8", { beTriggerR: 0.8 }],
  ["beTrigger 1.2", { beTriggerR: 1.2 }],
  // max hold retest under current base
  ["maxHold 48", { maxHoldBars: 48 }],
  ["maxHold 144", { maxHoldBars: 144 }],
  // range lookback — never tested
  ["rangeLook 72", { rangeLookbackBars: 72 }],
  ["rangeLook 120", { rangeLookbackBars: 120 }],
];

console.log(`\n=== phase 1: ${V.length} variants on W1 (qualifier: trades>=${b1.trades} AND wr>=${b1.wr} AND net>${b1.net}) ===`);
const p1: Row[] = [];
for (const [label, over] of V) {
  const r = run(W1, label, over);
  p1.push(r);
  const strict = r.trades >= b1.trades && r.wr > b1.wr && r.net > b1.net;
  const soft = !strict && r.trades >= b1.trades && r.wr >= b1.wr && r.net > b1.net;
  console.log(`${strict ? "STRICT" : soft ? "PASS " : "     "} ${line(r)}`);
}
const qualified = p1.filter((x) => x.trades >= b1.trades && x.wr >= b1.wr && x.net > b1.net);
console.log(`\nqualified: ${qualified.length ? qualified.sort((a, b) => b.wr - a.wr || b.net - a.net).map((x) => x.name).join(", ") : "NONE"}`);
writeFileSync("sweep4-results.json", JSON.stringify({ baseline: { W1: b1 }, phase1: p1 }, null, 2));
