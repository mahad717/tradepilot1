/**
 * Empirical answer to "Is the system Swing Trading or Day Trading?"
 * Runs the shipped default config on the real XAU 15m file and measures
 * how long trades are actually held (bars → hours → calendar days).
 */
import { readFileSync } from "node:fs";
import { parseCsvCandles } from "../src/lib/market/csv.ts";
import { runCsvBacktest, csvConfigFromUi } from "../src/lib/ict/run-core.ts";
import type { SymbolKey } from "../src/lib/ict/types.ts";

const text = readFileSync("../upload/XAU_15m_data.csv", "utf8");
const { candles, summary } = parseCsvCandles(text);
console.log(`parsed ${candles.length} candles (${summary.detectedInterval})`);

const ui = {
  minRR: 2,
  beMode: "tp1cost",
  ambiguity: "optimistic",
  sessions: ["london", "ny-am", "ny-pm"],
  entryAnchor: "midpoint",
  entryToleranceR: 0.05,
  maxCostPctOfR: 0.35,
  obInvalidation: "close-mid",
  obDisplacementFactor: 1.2,
  tierB: 70,
};

const r = runCsvBacktest({
  symbol: "XAUUSD" as SymbolKey,
  csvSummary: summary,
  candles,
  strictness: "balanced",
  config: csvConfigFromUi("XAUUSD", ui),
});

const BAR_SECONDS = 900; // 15m
const t = r.trades;
console.log(`\n=== shipped-default run ===`);
console.log(`trades=${t.length} winRate=${r.metrics.winRate}% netR=${r.metrics.netR} PF=${r.metrics.profitFactor} maxDD=${r.metrics.maxDrawdownR}R`);
console.log(`robustness=${r.metrics.robustness?.status ?? "n/a"} OOS=${r.metrics.oosNetR ?? "n/a"}R`);

const held = t.map((x) => x.barsHeld).sort((a, b) => a - b);
const hours = held.map((b) => (b * BAR_SECONDS) / 3600);
const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length);

console.log(`\n=== hold time (entry fill → final exit) ===`);
console.log(`bars held  : mean=${mean(held).toFixed(1)}  median=${q(held, 0.5)}  p90=${q(held, 0.9)}  max=${held[held.length - 1]}`);
console.log(`hours held : mean=${mean(hours).toFixed(1)}h  median=${q(hours, 0.5).toFixed(1)}h  p90=${q(hours, 0.9).toFixed(1)}h  max=${hours[hours.length - 1].toFixed(1)}h`);

// same-trading-day check: exit on the same UTC calendar date as entry?
const sameUtcDay = t.filter((x) => {
  const d1 = new Date(x.entryTime * 1000).toISOString().slice(0, 10);
  const d2 = new Date(x.exitTime * 1000).toISOString().slice(0, 10);
  return d1 === d2;
}).length;
// and in New York time (the ICT home timezone)
const ny = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", dateStyle: "short" }).format(new Date(ts * 1000));
const sameNyDay = t.filter((x) => ny(x.entryTime) === ny(x.exitTime)).length;
const overnight = t.length - sameNyDay;
console.log(`\nclosed same trading day: UTC ${sameUtcDay}/${t.length} (${((sameUtcDay / t.length) * 100).toFixed(0)}%)  ·  New York ${sameNyDay}/${t.length} (${((sameNyDay / t.length) * 100).toFixed(0)}%)`);
console.log(`held overnight (NY calendar): ${overnight} trades`);

// outcome breakdown
const byOutcome: Record<string, number> = {};
for (const x of t) byOutcome[x.outcome] = (byOutcome[x.outcome] ?? 0) + 1;
console.log(`\noutcomes: ${JSON.stringify(byOutcome)}`);

// session split
const bySession: Record<string, number> = {};
for (const x of t) bySession[x.session] = (bySession[x.session] ?? 0) + 1;
console.log(`sessions: ${JSON.stringify(bySession)}`);

// longest 5 trades for color
const longest = [...t].sort((a, b) => b.barsHeld - a.barsHeld).slice(0, 5);
console.log(`\nlongest trades:`);
for (const x of longest) {
  const e = new Date(x.entryTime * 1000).toISOString().replace("T", " ").slice(0, 16);
  const x2 = new Date(x.exitTime * 1000).toISOString().replace("T", " ").slice(0, 16);
  console.log(`  ${x.side} ${x.session}  entry ${e} → exit ${x2}  ${x.barsHeld} bars (${((x.barsHeld * 15) / 60).toFixed(1)}h)  ${x.outcome} ${x.netR}R`);
}
