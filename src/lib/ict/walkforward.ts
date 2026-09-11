// Walk-forward period analysis (spec #19, #21) and train/validation/out-of-sample
// splits (spec #19).
//
// The engine is causal, so one continuous run can be PARTITIONED into
// consecutive periods without re-fitting anything: each period shows how the
// FIXED configuration performed inside it. Stability across periods — not
// any single period's profit — is the robustness signal.
import type { TradeRecord } from "./types";

export interface PeriodStats {
  period: string;
  label: string;
  from: number;
  to: number;
  trades: number;
  wins: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null; // null when no losing trades (spec §13)
  maxDrawdownR: number;
  netR: number;
}

export interface WalkForwardResult {
  periods: PeriodStats[];
  splits: { name: "TRAIN (60%)" | "VALIDATION (20%)" | "OUT-OF-SAMPLE (20%)"; stats: PeriodStats }[];
  positivePeriods: number;
  note: string;
}

export function computePeriodStats(trades: TradeRecord[], period: string, label: string, from: number, to: number): PeriodStats {
  const wins = trades.filter((t) => t.netR > 0);
  const grossWin = wins.reduce((s, t) => s + t.netR, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.netR <= 0).reduce((s, t) => s + t.netR, 0));
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const t of trades) {
    equity += t.netR;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return {
    period,
    label,
    from,
    to,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : null,
    expectancyR: trades.length ? round(equity / trades.length) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    maxDrawdownR: round(dd),
    netR: round(equity),
  };
}

/**
 * Partition a trade list into `k` consecutive periods by bar index.
 * `totalBars` bounds the domain so empty periods still report zero trades.
 */
export function walkForward(trades: TradeRecord[], totalBars: number, warmupBars: number, k = 5): WalkForwardResult {
  const effectiveStart = warmupBars;
  const span = Math.max(1, totalBars - effectiveStart);
  const seg = Math.floor(span / k);
  const periods: PeriodStats[] = [];

  for (let p = 0; p < k; p++) {
    const startIdx = effectiveStart + p * seg;
    const endIdx = p === k - 1 ? totalBars : startIdx + seg;
    const inPeriod = trades.filter((t) => t.entryIndex >= startIdx && t.entryIndex < endIdx);
    const from = inPeriod.length ? Math.min(...inPeriod.map((t) => t.entryTime)) : 0;
    const to = inPeriod.length ? Math.max(...inPeriod.map((t) => t.exitTime)) : 0;
    periods.push(computePeriodStats(inPeriod, `Period ${p + 1}`, `bars ${startIdx}–${endIdx}`, from, to));
  }

  // train / validation / OOS split (60/20/20 of the tradable region)
  const splits: WalkForwardResult["splits"] = [];
  const bounds: { name: WalkForwardResult["splits"][0]["name"]; a: number; b: number }[] = [
    { name: "TRAIN (60%)", a: effectiveStart, b: effectiveStart + Math.floor(span * 0.6) },
    { name: "VALIDATION (20%)", a: effectiveStart + Math.floor(span * 0.6), b: effectiveStart + Math.floor(span * 0.8) },
    { name: "OUT-OF-SAMPLE (20%)", a: effectiveStart + Math.floor(span * 0.8), b: totalBars },
  ];
  for (const b of bounds) {
    const inSeg = trades.filter((t) => t.entryIndex >= b.a && t.entryIndex < b.b);
    const from = inSeg.length ? Math.min(...inSeg.map((t) => t.entryTime)) : 0;
    const to = inSeg.length ? Math.max(...inSeg.map((t) => t.exitTime)) : 0;
    splits.push({ name: b.name, stats: computePeriodStats(inSeg, b.name, "", from, to) });
  }

  const positivePeriods = periods.filter((p) => p.netR > 0).length;

  return {
    periods,
    splits,
    positivePeriods,
    note:
      "One causal run partitioned into consecutive periods — the configuration is never re-fitted per period. " +
      "A robust strategy shows positive expectancy in MOST periods, not one lucky stretch.",
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
