// Strategy diagnostics, MFE/MAE analysis, backtest report and robustness
// flags (spec #23, #25, #32, #33, #34). Honest by construction: all inputs
// come from the executed trade records; nothing is fitted or fabricated.
import type {
  BacktestMetricsV2,
  FunnelCounters,
  TradeRecord,
} from "./types";
import { REJECTION_LABELS, MODEL_LABELS } from "./types";
import type { ModelKey, RejectionCode, RrDiagnostics, SessionDiagnostics, OrderFlowSummary } from "./types";
import type { DiagSink } from "./sequence";
import { STAGE_DEPTH } from "./sequence";
import { SESSION_LABELS } from "./sessions";
import type { PeriodStats } from "./walkforward";

export function computeMetrics(trades: TradeRecord[]): BacktestMetricsV2 {
  const wins = trades.filter((t) => t.netR > 0);
  const losses = trades.filter((t) => t.netR <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netR, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  const totalGross = trades.reduce((s, t) => s + t.grossR, 0);
  const totalCosts = trades.reduce((s, t) => s + t.costR, 0);
  const net = trades.reduce((s, t) => s + t.netR, 0);

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let best = 0;
  let worst = 0;
  for (const t of trades) {
    equity += t.netR;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (t.netR > 0) streak = streak > 0 ? streak + 1 : 1;
    else streak = streak < 0 ? streak - 1 : -1;
    best = Math.max(best, streak);
    worst = Math.min(worst, streak);
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    // N/A semantics (spec §13): null when there is nothing meaningful to show
    winRate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : null,
    grossR: round(totalGross),
    costsR: round(totalCosts),
    netR: round(net),
    expectancyR: trades.length ? round(net / trades.length) : null,
    expectancyGrossR: trades.length ? round(totalGross / trades.length) : null,
    avgWinR: wins.length ? round(grossWin / wins.length) : 0,
    avgLossR: losses.length ? round(-grossLoss / losses.length) : 0,
    // NEVER report "PF 99" for a sample with no losers (spec §13)
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    maxDrawdownR: round(maxDd),
    bestStreak: best,
    worstStreak: Math.abs(worst),
    avgMfeWinners: round(avg(wins.map((t) => t.mfeR))),
    avgMfeLosers: round(avg(losses.map((t) => t.mfeR))),
    avgMaeWinners: round(avg(wins.map((t) => t.maeR))),
    avgMaeLosers: round(avg(losses.map((t) => t.maeR))),
  };
}

// ---------------------------------------------------------------------------
// "Why are trades losing?" (spec #23)
// ---------------------------------------------------------------------------

export interface LossReasonRow {
  reason: string;
  description: string;
  count: number;
  pct: number;
}

/**
 * Rule-based attribution for losing trades. These are DIAGNOSTIC HEURISTICS
 * computed from the executed record — they tell you what the losing trades
 * looked like, not proven causation.
 */
export function tagLossReasons(t: TradeRecord): string[] {
  if (t.netR >= 0) return [];
  const tags: string[] = [];
  if (t.scores.liquidity < 12) tags.push("weak-sweep");
  if (t.scores.structure < 16) tags.push("weak-displacement");
  if (t.scores.entry < 14) tags.push("poor-entry-zone");
  if (t.mktRegime === "RANGE") tags.push("range-market");
  if (t.volRegime === "HIGH" || t.volRegime === "EXTREME") tags.push("high-volatility");
  if (t.volRegime === "LOW") tags.push("low-volatility");
  if (!t.smtAligned) tags.push("no-smt");
  if (t.plannedRR < 2.5) tags.push("low-rr");
  if (t.session === "off-session") tags.push("bad-session");
  if (t.mfeR >= 1) tags.push("gave-back-1r-plus");
  else if (t.mfeR < 0.5) tags.push("never-travelled-half-r");
  if (t.outcome === "SL" && t.barsHeld <= 3) tags.push("stopped-immediately");
  return tags.length ? tags : ["unclassified"];
}

export const LOSS_REASON_DESCRIPTIONS: Record<string, string> = {
  "weak-sweep": "Low liquidity score — sweep quality/recency was marginal",
  "weak-displacement": "Structure score low — MSS/BOS or displacement was soft",
  "poor-entry-zone": "Entry category low — zone quality or freshness was weak",
  "range-market": "Traded in a RANGE regime",
  "high-volatility": "Volatility regime HIGH/EXTREME at entry",
  "low-volatility": "Volatility regime LOW at entry",
  "no-smt": "No XAU/XAG SMT confirmation",
  "low-rr": "Planned RR below 2.5R (just over the gate)",
  "bad-session": "Taken outside all kill zones",
  "gave-back-1r-plus": "Trade reached +1R MFE then returned a loss — management gave it back",
  "never-travelled-half-r": "Never reached +0.5R MFE — entry/stop location problem",
  "stopped-immediately": "Stopped within 3 bars of fill",
  unclassified: "No specific weakness identified",
};

export function lossReasonTable(trades: TradeRecord[]): LossReasonRow[] {
  const losers = trades.filter((t) => t.netR < 0);
  if (losers.length === 0) return [];
  const counts = new Map<string, number>();
  for (const t of losers) {
    for (const tag of t.lossReasons) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      description: LOSS_REASON_DESCRIPTIONS[reason] ?? reason,
      count,
      pct: Math.round((count / losers.length) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Signal funnel (spec §1) — market-state stages per BAR + opportunity stages
// per CANDIDATE (bar × model). Percentages are of total candles, exactly like
// the spec's example ("Liquidity sweeps 184 3.7%").
// ---------------------------------------------------------------------------

export interface FunnelRow {
  stage: string;
  count: number;
  /** percentage of total candles (spec §1) */
  pct: number;
  unit: "bars" | "candidates" | "orders";
}

export function funnelStages(ctx: {
  totalCandles: number;
  diag: import("./sequence").DiagSink;
  funnel: FunnelCounters;
}): FunnelRow[] {
  const { totalCandles, diag, funnel } = ctx;
  const pct = (n: number) => (totalCandles > 0 ? Math.round((n / totalCandles) * 10000) / 100 : 0);
  return [
    { stage: "Total candles", count: totalCandles, pct: 100, unit: "bars" },
    { stage: "HTF bias available", count: diag.biasBars, pct: pct(diag.biasBars), unit: "bars" },
    { stage: "Valid HTF context (bias + regime OK)", count: diag.contextBars, pct: pct(diag.contextBars), unit: "bars" },
    { stage: "Dealing range identified", count: diag.rangeBars, pct: pct(diag.rangeBars), unit: "bars" },
    { stage: "Liquidity pool within reach", count: diag.poolBars, pct: pct(diag.poolBars), unit: "bars" },
    { stage: "Liquidity sweep detected", count: diag.sweepBars, pct: pct(diag.sweepBars), unit: "bars" },
    { stage: "MSS/CHOCH detected", count: diag.structureBars, pct: pct(diag.structureBars), unit: "bars" },
    { stage: "Kill Zone condition", count: diag.kzBars, pct: pct(diag.kzBars), unit: "bars" },
    { stage: "Setup candidates evaluated", count: diag.candidates, pct: pct(diag.candidates), unit: "candidates" },
    { stage: "Sweep w/ rejection quality OK", count: diag.sweepsQuality, pct: pct(diag.sweepsQuality), unit: "candidates" },
    { stage: "Displacement confirmed", count: diag.displacements, pct: pct(diag.displacements), unit: "candidates" },
    { stage: "FVG detected", count: diag.fvgSeen, pct: pct(diag.fvgSeen), unit: "candidates" },
    { stage: "Order Block detected", count: diag.obSeen, pct: pct(diag.obSeen), unit: "candidates" },
    { stage: "Premium/discount condition", count: diag.pdOk, pct: pct(diag.pdOk), unit: "candidates" },
    { stage: "Valid retracement (zone + stop)", count: diag.stopValid, pct: pct(diag.stopValid), unit: "candidates" },
    { stage: "Execution cost within gate", count: Math.max(0, diag.stopValid - diag.costRejected), pct: pct(Math.max(0, diag.stopValid - diag.costRejected)), unit: "candidates" },
    { stage: "Structural target valid", count: diag.targetsValid, pct: pct(diag.targetsValid), unit: "candidates" },
    { stage: "SMT confirmation", count: diag.smtOk, pct: pct(diag.smtOk), unit: "candidates" },
    { stage: "Minimum RR satisfied", count: diag.rrOk, pct: pct(diag.rrOk), unit: "candidates" },
    { stage: "Final signals (orders placed)", count: funnel.ordersPlaced, pct: pct(funnel.ordersPlaced), unit: "orders" },
    { stage: "Orders filled", count: funnel.ordersFilled, pct: pct(funnel.ordersFilled), unit: "orders" },
    { stage: "Orders expired unfilled", count: funnel.ordersExpired, pct: pct(funnel.ordersExpired), unit: "orders" },
  ];
}

// ---------------------------------------------------------------------------
// Rejection-reason table (spec §2) + model comparison (spec §7) + RR/session
// diagnostics (spec §9, §10) + sample-size categories (spec §12).
// ---------------------------------------------------------------------------

export interface RejectionRow {
  code: RejectionCode;
  label: string;
  count: number;
}

/** Ranked rejection table from the PRIMARY (deepest) rejection per bar. */
export function rejectionTable(diag: DiagSink): RejectionRow[] {
  return [...diag.primary.entries()]
    .map(([code, count]) => ({ code, label: REJECTION_LABELS[code] ?? code, count }))
    .sort((a, b) => b.count - a.count);
}

export interface ModelPerformanceRow {
  model: ModelKey;
  label: string;
  opportunities: number;
  topRejections: { code: RejectionCode; label: string; count: number }[];
  validSetups: number;
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number;
  netR: number;
}

/**
 * Per-model rejections count ONLY the model-conditional stage (zone selection
 * and deeper, STAGE_DEPTH ≥ 6). The shared prefix (bias → sweep → MSS →
 * displacement) is identical across models by construction — listing it per
 * model produced three identical columns and zero information.
 */
export function modelPerformance(diag: DiagSink, trades: TradeRecord[]): ModelPerformanceRow[] {
  const rows: ModelPerformanceRow[] = [];
  for (const [model, stat] of diag.byModel.entries()) {
    const ts = trades.filter((t) => t.model === model);
    const m = computeMetrics(ts);
    rows.push({
      model,
      label: MODEL_LABELS[model] ?? model,
      opportunities: stat.opportunities,
      topRejections: [...stat.rejections.entries()]
        .filter(([code]) => (STAGE_DEPTH[code] ?? 0) >= 6)
        .map(([code, count]) => ({ code, label: REJECTION_LABELS[code] ?? code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
      validSetups: stat.valid,
      trades: m.trades,
      winRate: m.winRate,
      expectancyR: m.expectancyR,
      profitFactor: m.profitFactor,
      maxDrawdownR: m.maxDrawdownR,
      netR: m.netR,
    });
  }
  return rows.sort((a, b) => b.opportunities - a.opportunities);
}

// ---------------------------------------------------------------------------
// Pending-order telemetry (spec §9 extension): why did orders not fill?
// ---------------------------------------------------------------------------

export interface PendingTelemetryInput {
  outcome: "filled" | "expired" | "invalidated";
  fillBarOffset: number | null;
  lateFillBarOffset: number | null;
  closestApproachR: number | null;
  toleranceFill: boolean;
}

export function summarizeOrderFlow(items: PendingTelemetryInput[], expiryBars: number): OrderFlowSummary {
  const placed = items.length;
  const filled = items.filter((p) => p.outcome === "filled").length;
  const invalidated = items.filter((p) => p.outcome === "invalidated").length;
  const expired = items.filter((p) => p.outcome === "expired").length;
  const latencies = items
    .map((p) => p.fillBarOffset)
    .filter((v): v is number => v !== null);
  const lateFills = items.filter((p) => p.lateFillBarOffset !== null).length;
  const toleranceFills = items.filter((p) => p.toleranceFill).length;
  const approaches = items
    .filter((p) => p.outcome === "expired")
    .map((p) => p.closestApproachR)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const bucket = (max: number) => latencies.filter((v) => v <= max).length;
  const rateAt = (bars: number) => {
    const touches = items.filter((p) => p.fillBarOffset !== null && p.fillBarOffset <= bars).length;
    return placed > 0 ? Math.round((touches / placed) * 1000) / 10 : null;
  };
  const median = approaches.length ? Math.round(approaches[Math.floor(approaches.length / 2)] * 100) / 100 : null;
  const notes: string[] = [];
  if (placed === 0) notes.push("No orders were placed in this run.");
  if (expired > 0 && median !== null && median > 0.75) notes.push(`Expired orders never came closer than ~${median}R to entry — the retracement depth, not the expiry window, is the constraint.`);
  else if (expired > 0 && median !== null) notes.push(`Expired orders came within ~${median}R of entry — a longer expiry window (or a nearer entry limit) would have caught several.`);
  if (lateFills > 0) notes.push(`${lateFills} order${lateFills === 1 ? "" : "s"} were eventually touched AFTER the ${expiryBars}-bar expiry window.`);
  if (toleranceFills > 0) notes.push(`${toleranceFills} fill${toleranceFills === 1 ? "" : "s"} came from the entry-tolerance margin (price never actually touched the limit).`);
  if (placed > 0 && rateAt(48) !== null) notes.push(`Cumulative fill rate: ${rateAt(6)}% within 6 bars, ${rateAt(12)}% within 12, ${rateAt(24)}% within 24, ${rateAt(48)}% within 48.`);
  return {
    placed,
    filled,
    expired,
    invalidated,
    lateFills,
    toleranceFills,
    fillLatency: { le3: bucket(3), le6: bucket(6), le12: bucket(12), le24: bucket(24), le48: bucket(48) },
    fillRateAt: { bars6: rateAt(6), bars12: rateAt(12), bars24: rateAt(24), bars48: rateAt(48) },
    medianClosestApproachR: median,
    note: notes.join(" "),
  };
}

/** RR-filter histogram counted BEFORE the gate applies (spec §9). */
export function rrDiagnostics(rr: DiagSink["rrDiag"]): RrDiagnostics {
  const sorted = [...rr.values].sort((a, b) => a - b);
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  return {
    evaluated: rr.evaluated,
    beforeFilter: rr.withTargets,
    ge1_5: rr.ge15,
    ge2: rr.ge20,
    ge2_5: rr.ge25,
    ge3: rr.ge30,
    medianMaxRr: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    medianTp1Rr: med(rr.tp1Values),
    medianTp3Rr: med(rr.tp3Values),
    targetsCapped: rr.targetsCappedAccum,
    sample: rr.values.slice(-400),
    tp1Sample: rr.tp1Values.slice(-400),
    tp3Sample: rr.tp3Values.slice(-400),
  };
}

/** Session breakdown of fully-valid setups, counted with NO session gate (spec §10). */
export function sessionDiagnostics(diag: DiagSink): SessionDiagnostics {
  const order = ["london", "ny-am", "ny-pm", "london-close", "asia", "off-session"];
  const rows = [...diag.setupsBySession.entries()]
    .map(([session, setups]) => ({
      session,
      label: SESSION_LABELS[session as keyof typeof SESSION_LABELS] ?? session,
      setups,
    }))
    .sort((a, b) => {
      const ia = order.indexOf(a.session);
      const ib = order.indexOf(b.session);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.setups - a.setups;
    });
  return {
    bySession: rows,
    note:
      "Setups counted with every session allowed (before cooldowns). Use this to judge whether a session filter is unnecessarily restrictive — not to auto-pick the best session.",
  };
}

export type SampleCategory = "INSUFFICIENT" | "LOW" | "MODERATE" | "STRONGER" | "EMPTY";

export const SAMPLE_CATEGORIES: Record<SampleCategory, { label: string; note: string }> = {
  EMPTY: { label: "NO TRADES", note: "No trades in this sample. Expectancy, win rate and profit factor are undefined — the only honest reading is that the strategy found nothing to trade." },
  INSUFFICIENT: { label: "INSUFFICIENT SAMPLE", note: "Fewer than 20 trades. Performance cannot be meaningfully evaluated — treat every number as noise." },
  LOW: { label: "LOW CONFIDENCE", note: "20–49 trades. Directional evidence only." },
  MODERATE: { label: "MODERATE SAMPLE", note: "50–99 trades. Suggestive, not conclusive." },
  STRONGER: { label: "STRONGER SAMPLE", note: "100+ trades. Still informational — never a guarantee of validity." },
};

export function sampleCategory(trades: number): SampleCategory {
  if (trades <= 0) return "EMPTY";
  if (trades < 20) return "INSUFFICIENT";
  if (trades < 50) return "LOW";
  if (trades < 100) return "MODERATE";
  return "STRONGER";
}

// ---------------------------------------------------------------------------
// MFE/MAE analysis (spec #25)
// ---------------------------------------------------------------------------

export interface MfeMaePoint {
  mfeR: number;
  maeR: number;
  netR: number;
  outcome: string;
  win: boolean;
}

export interface MfeMaeAnalysis {
  points: MfeMaePoint[];
  avgMfeWinners: number;
  avgMfeLosers: number;
  avgMaeWinners: number;
  avgMaeLosers: number;
  reading: string[];
}

export function mfeMaeAnalysis(trades: TradeRecord[]): MfeMaeAnalysis {
  const wins = trades.filter((t) => t.netR > 0);
  const losses = trades.filter((t) => t.netR <= 0);
  const avg = (arr: number[]) => (arr.length ? round(arr.reduce((s, x) => s + x, 0) / arr.length) : 0);
  const aw = avg(wins.map((t) => t.mfeR));
  const al = avg(losses.map((t) => t.mfeR));
  const awMae = avg(wins.map((t) => t.maeR));
  const alMae = avg(losses.map((t) => t.maeR));

  const reading: string[] = [];
  if (trades.length >= 5) {
    if (alMae < -1.1) reading.push("Losers cut deeper than −1R MAE on average — consider whether entries or stop placement (not wider stops) are the problem.");
    if (aw < 0.8) reading.push("Winners only travel +0.8R MFE on average — TP1/TP2 may sit too far, or entries are late.");
    if (al > 0.6 && alMae > -0.6) reading.push("Losers often travelled before failing — breakeven earlier (risk1 mode) is worth testing, not assuming.");
    if (al < 0.35 && losses.length > wins.length) reading.push("Losers barely travel — entries may be too late in the retracement.");
  } else {
    reading.push("Too few trades for reliable MFE/MAE reading — treat as indicative only.");
  }

  return {
    points: trades.map((t) => ({ mfeR: t.mfeR, maeR: t.maeR, netR: t.netR, outcome: t.outcome, win: t.netR > 0 })),
    avgMfeWinners: aw,
    avgMfeLosers: al,
    avgMaeWinners: awMae,
    avgMaeLosers: alMae,
    reading,
  };
}

// ---------------------------------------------------------------------------
// Trade-management + session + score-bucket stats (spec #32)
// ---------------------------------------------------------------------------

export interface ManagementRates {
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  beRate: number;
  timeoutRate: number;
  slRate: number;
  /** median bars from fill to each TP hit — null when that TP never hit */
  medianBarsToTp1: number | null;
  medianBarsToTp2: number | null;
  medianBarsToTp3: number | null;
}

export function managementRates(trades: TradeRecord[]): ManagementRates {
  const n = trades.length || 1;
  const pct = (arr: TradeRecord[]) => round((arr.length / n) * 100);
  const medBars = (pick: (t: TradeRecord) => number | null): number | null => {
    const v = trades.map(pick).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  return {
    tp1HitRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TP1"))),
    tp2HitRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TP2"))),
    tp3HitRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TP3"))),
    beRate: pct(trades.filter((t) => t.breakevenStop !== null && t.outcome !== "SL")),
    timeoutRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TIMEOUT"))),
    slRate: pct(trades.filter((t) => t.outcome === "SL")),
    medianBarsToTp1: medBars((t) => t.barsToTp1),
    medianBarsToTp2: medBars((t) => t.barsToTp2),
    medianBarsToTp3: medBars((t) => t.barsToTp3),
  };
}

export interface SessionStat {
  session: string;
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  netR: number;
}

export function sessionStats(trades: TradeRecord[]): SessionStat[] {
  const bySession = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    const arr = bySession.get(t.session) ?? [];
    arr.push(t);
    bySession.set(t.session, arr);
  }
  return [...bySession.entries()].map(([session, ts]) => {
    const m = computeMetrics(ts);
    return {
      session: SESSION_LABELS[session as keyof typeof SESSION_LABELS] ?? session,
      trades: ts.length,
      winRate: m.winRate,
      expectancyR: m.expectancyR,
      netR: m.netR,
    };
  }).sort((a, b) => b.trades - a.trades);
}

export interface ScoreBucketStat {
  bucket: string;
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  netR: number;
}

export function scoreBucketStats(trades: TradeRecord[]): ScoreBucketStat[] {
  const buckets: { bucket: string; test: (t: TradeRecord) => boolean }[] = [
    { bucket: "70–79 (B)", test: (t) => t.totalScore >= 70 && t.totalScore < 80 },
    { bucket: "80–89 (A)", test: (t) => t.totalScore >= 80 && t.totalScore < 90 },
    { bucket: "90–100 (A+)", test: (t) => t.totalScore >= 90 },
  ];
  return buckets.map(({ bucket, test }) => {
    const ts = trades.filter(test);
    const m = computeMetrics(ts);
    return { bucket, trades: ts.length, winRate: m.winRate, expectancyR: m.expectancyR, netR: m.netR };
  });
}

// ---------------------------------------------------------------------------
// Report + robustness flags (spec #32, #34)
// ---------------------------------------------------------------------------

export interface RobustnessFlags {
  level: "GREEN" | "YELLOW" | "RED";
  reasons: string[];
}

export function robustnessFlags(
  metrics: BacktestMetricsV2,
  periods: PeriodStats[]
): RobustnessFlags {
  const reasons: string[] = [];
  const positivePeriods = periods.filter((p) => p.netR > 0).length;
  const totalPositive = periods.reduce((s, p) => s + Math.max(0, p.netR), 0);
  const bestPeriodShare = totalPositive > 0
    ? Math.max(...periods.map((p) => Math.max(0, p.netR))) / totalPositive
    : 1;

  const exp = metrics.expectancyR; // nullable (spec §13)
  const pf = metrics.profitFactor; // null when no losers — never read as "99"

  // Sample-size gate FIRST (spec §12): tiny samples are RED, no matter how
  // good the numbers look. "1 trade, PF 99, positive expectancy" is NOT
  // meaningful evidence and must never be presented as such.
  const cat = sampleCategory(metrics.trades);
  if (cat === "EMPTY") {
    reasons.push("No trades — there is nothing to evaluate in this sample.");
    return { level: "RED", reasons };
  }
  if (cat === "INSUFFICIENT") {
    reasons.push(`Only ${metrics.trades} trade${metrics.trades === 1 ? "" : "s"}. Performance cannot be meaningfully evaluated.`);
    if (metrics.trades === 1) reasons.push("A single trade says nothing about the strategy — this is not evidence of an edge.");
    return { level: "RED", reasons };
  }
  if (cat === "LOW") reasons.push(`${metrics.trades} trades — LOW confidence sample (20–49).`);
  if (cat === "MODERATE") reasons.push(`${metrics.trades} trades — MODERATE sample (50–99).`);
  if (cat === "STRONGER") reasons.push(`${metrics.trades} trades — STRONGER sample (100+), still informational only.`);

  if (exp !== null && pf !== null && exp > 0.05 && pf > 1.1) reasons.push("Positive expectancy and profit factor above 1.1");
  if (exp !== null && exp <= 0) reasons.push("Non-positive net expectancy");
  if (pf !== null && pf < 0.95) reasons.push("Profit factor below 0.95");
  if (pf === null && metrics.trades > 0) reasons.push("No losing trades in sample — profit factor is N/A, not 99");
  if (metrics.maxDrawdownR > 8) reasons.push(`Drawdown ${metrics.maxDrawdownR}R is large relative to typical expectations`);
  // Out-of-sample honesty: the LAST walk-forward period is the held-out
  // stretch. A GREEN verdict must not paper over a negative OOS period.
  const oos = periods.length ? periods[periods.length - 1] : null;
  const oosNet = oos?.netR ?? null;
  const oosNegative = oosNet !== null && oosNet < 0;
  if (periods.length >= 3) {
    if (positivePeriods / periods.length >= 0.6) reasons.push(`${positivePeriods}/${periods.length} periods positive`);
    else reasons.push(`Only ${positivePeriods}/${periods.length} periods positive — performance uneven across time`);
    if (bestPeriodShare > 0.8) reasons.push("Most of the net gain depends on a single period");
    else if (bestPeriodShare > 0.6) reasons.push(`${Math.round(bestPeriodShare * 100)}% of the net gain comes from a single period — performance is concentrated, not evenly distributed`);
    if (oosNegative) reasons.push(`Out-of-sample period NEGATIVE (${oosNet}R over ${oos?.trades ?? 0} trades) — the recent regime was not kind to this configuration`);
  }

  const red = (exp !== null && exp < -0.05) || (pf !== null && pf < 0.9) || (periods.length >= 3 && bestPeriodShare > 0.8 && exp !== null && exp <= 0.05);
  const green = exp !== null && pf !== null && exp > 0.05 && pf > 1.1 && metrics.trades >= 30 && metrics.maxDrawdownR <= 8 && periods.length >= 3 && positivePeriods / periods.length >= 0.6 && bestPeriodShare <= 0.6 && !oosNegative;
  return { level: red ? "RED" : green ? "GREEN" : "YELLOW", reasons };
}

export interface BacktestReport {
  diagnostics: {
    bestSetup: { side: string; entryTime: number; netR: number } | null;
    worstSetup: { side: string; entryTime: number; netR: number } | null;
    bestSession: SessionStat | null;
    worstSession: SessionStat | null;
    bestScoreRange: ScoreBucketStat | null;
    worstScoreRange: ScoreBucketStat | null;
  };
  risk: {
    maxConsecutiveLosses: number;
    averageLossR: number;
    averageWinR: number;
    largestLossR: number;
    largestWinR: number;
    maxDrawdownR: number;
  };
  management: ManagementRates;
}

export function buildReport(trades: TradeRecord[], metrics: BacktestMetricsV2): BacktestReport {
  const sorted = [...trades].sort((a, b) => b.netR - a.netR);
  const sessions = sessionStats(trades).filter((s) => s.trades >= 3);
  const buckets = scoreBucketStats(trades).filter((b) => b.trades >= 3);
  const byExpectancy = (a: { expectancyR: number | null }, b: { expectancyR: number | null }) => (b.expectancyR ?? -99) - (a.expectancyR ?? -99);
  let consec = 0;
  let worst = 0;
  for (const t of trades) {
    if (t.netR < 0) {
      consec++;
      worst = Math.max(worst, consec);
    } else consec = 0;
  }
  const losses = trades.map((t) => t.netR).filter((r) => r < 0);
  const wins = trades.map((t) => t.netR).filter((r) => r > 0);

  return {
    diagnostics: {
      bestSetup: sorted[0] ? { side: sorted[0].side, entryTime: sorted[0].entryTime, netR: sorted[0].netR } : null,
      worstSetup: sorted.length ? { side: sorted[sorted.length - 1].side, entryTime: sorted[sorted.length - 1].entryTime, netR: sorted[sorted.length - 1].netR } : null,
      bestSession: sessions.length ? [...sessions].sort(byExpectancy)[0] : null,
      worstSession: sessions.length ? [...sessions].sort(byExpectancy)[sessions.length - 1] : null,
      bestScoreRange: buckets.length ? [...buckets].sort(byExpectancy)[0] : null,
      worstScoreRange: buckets.length ? [...buckets].sort(byExpectancy)[buckets.length - 1] : null,
    },
    risk: {
      maxConsecutiveLosses: worst,
      averageLossR: metrics.avgLossR,
      averageWinR: metrics.avgWinR,
      largestLossR: losses.length ? round(Math.min(...losses)) : 0,
      largestWinR: wins.length ? round(Math.max(...wins)) : 0,
      maxDrawdownR: metrics.maxDrawdownR,
    },
    management: managementRates(trades),
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
