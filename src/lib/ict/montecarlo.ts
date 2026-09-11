// Monte Carlo analysis on ACTUAL historical trade results (spec #22).
// Only resamples the realized net-R sequence — no synthetic trades, no
// fabricated performance. i.i.d. bootstrap with a seeded PRNG so runs are
// reproducible.
import { mulberry32 } from "./rng";

export interface MonteCarloResult {
  iterations: number;
  tradesPerPath: number;
  medianFinalR: number;
  p5FinalR: number;
  p95FinalR: number;
  probFinalNegative: number; // 0..1
  medianMaxDrawdownR: number;
  p95MaxDrawdownR: number;
  medianMaxConsecutiveLosses: number;
  p95MaxConsecutiveLosses: number;
  histogram: { bucket: string; count: number }[];
  note: string;
}

function maxDrawdown(rs: number[]): number {
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return dd;
}

function maxConsecutiveLosses(rs: number[]): number {
  let cur = 0;
  let worst = 0;
  for (const r of rs) {
    if (r < 0) {
      cur++;
      worst = Math.max(worst, cur);
    } else cur = 0;
  }
  return worst;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

export function runMonteCarlo(netRs: number[], iterations = 1000, seed = 1234): MonteCarloResult {
  const n = netRs.length;
  if (n === 0) {
    return {
      iterations: 0, tradesPerPath: 0, medianFinalR: 0, p5FinalR: 0, p95FinalR: 0,
      probFinalNegative: 0, medianMaxDrawdownR: 0, p95MaxDrawdownR: 0,
      medianMaxConsecutiveLosses: 0, p95MaxConsecutiveLosses: 0, histogram: [],
      note: "No trades to resample.",
    };
  }
  const rand = mulberry32(seed);
  const finals: number[] = [];
  const dds: number[] = [];
  const streaks: number[] = [];

  for (let it = 0; it < iterations; it++) {
    const path: number[] = new Array(n);
    for (let k = 0; k < n; k++) path[k] = netRs[Math.floor(rand() * n)];
    finals.push(path.reduce((s, r) => s + r, 0));
    dds.push(maxDrawdown(path));
    streaks.push(maxConsecutiveLosses(path));
  }

  const sortedFinals = [...finals].sort((a, b) => a - b);
  const sortedDd = [...dds].sort((a, b) => a - b);
  const sortedStreaks = [...streaks].sort((a, b) => a - b);

  // histogram of final equity (12 buckets)
  const lo = sortedFinals[0];
  const hi = sortedFinals[sortedFinals.length - 1];
  const bins = 12;
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const f of finals) {
    const b = Math.min(bins - 1, Math.floor((f - lo) / width));
    counts[b]++;
  }
  const histogram = counts.map((count, i) => ({
    bucket: `${(lo + i * width).toFixed(1)}R`,
    count,
  }));

  const probLoss = finals.filter((f) => f < 0).length / iterations;

  return {
    iterations,
    tradesPerPath: n,
    medianFinalR: round(percentile(sortedFinals, 0.5)),
    p5FinalR: round(percentile(sortedFinals, 0.05)),
    p95FinalR: round(percentile(sortedFinals, 0.95)),
    probFinalNegative: Math.round(probLoss * 1000) / 1000,
    medianMaxDrawdownR: round(percentile(sortedDd, 0.5)),
    p95MaxDrawdownR: round(percentile(sortedDd, 0.95)),
    medianMaxConsecutiveLosses: percentile(sortedStreaks, 0.5),
    p95MaxConsecutiveLosses: percentile(sortedStreaks, 0.95),
    histogram,
    note:
      "Bootstrap resampling of the actual historical net-R sequence (i.i.d. assumption). " +
      "It quantifies the RANGE of plausible outcomes of THIS trade sample — it does not create performance.",
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
