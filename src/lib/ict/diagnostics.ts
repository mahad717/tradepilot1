// Strategy diagnostics, MFE/MAE analysis, backtest report and robustness
// flags (spec #23, #25, #32, #33, #34). Honest by construction: all inputs
// come from the executed trade records; nothing is fitted or fabricated.
import type {
  BacktestMetricsV2,
  FunnelCounters,
  TradeRecord,
} from "./types";
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
    winRate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
    grossR: round(totalGross),
    costsR: round(totalCosts),
    netR: round(net),
    expectancyR: trades.length ? round(net / trades.length) : 0,
    expectancyGrossR: trades.length ? round(totalGross / trades.length) : 0,
    avgWinR: wins.length ? round(grossWin / wins.length) : 0,
    avgLossR: losses.length ? round(-grossLoss / losses.length) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : grossWin > 0 ? 99 : 0,
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
// Signal funnel (spec #24)
// ---------------------------------------------------------------------------

export interface FunnelRow {
  stage: string;
  count: number;
}

export function funnelRows(f: FunnelCounters): FunnelRow[] {
  return [
    { stage: "Bars evaluated (flat, warmed up)", count: f.barsEvaluated },
    { stage: "HTF bias aligned", count: f.htfBiasOk },
    { stage: "Regime + session OK", count: Math.min(f.regimeOk, f.sessionOk) },
    { stage: "Liquidity sweep found (recent)", count: f.sweepFound },
    { stage: "Sweep rejection quality OK", count: f.sweepQualityOk },
    { stage: "Structure confirmation (MSS/BOS)", count: f.structureOk },
    { stage: "Displacement quality OK", count: f.displacementOk },
    { stage: "Entry zone found (fresh, sequenced)", count: f.zoneFound },
    { stage: "Zone quality OK", count: f.zoneQualityOk },
    { stage: "Premium/discount OK", count: f.premiumDiscountOk },
    { stage: "Structural target ≥ minRR", count: f.rrOk },
    { stage: "Score ≥ tier threshold", count: f.scoreOk },
    { stage: "Orders placed", count: f.ordersPlaced },
    { stage: "Orders filled", count: f.ordersFilled },
    { stage: "Trades closed", count: f.tradesClosed },
  ];
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
}

export function managementRates(trades: TradeRecord[]): ManagementRates {
  const n = trades.length || 1;
  const pct = (arr: TradeRecord[]) => round((arr.length / n) * 100);
  return {
    tp1HitRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TP1"))),
    tp2HitRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TP2"))),
    tp3HitRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TP3"))),
    beRate: pct(trades.filter((t) => t.breakevenStop !== null && t.outcome !== "SL")),
    timeoutRate: pct(trades.filter((t) => t.legs.some((l) => l.label === "TIMEOUT"))),
    slRate: pct(trades.filter((t) => t.outcome === "SL")),
  };
}

export interface SessionStat {
  session: string;
  trades: number;
  winRate: number;
  expectancyR: number;
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
  winRate: number;
  expectancyR: number;
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

  if (metrics.trades < 30) reasons.push(`Only ${metrics.trades} trades — sample too small for statistical confidence`);
  if (metrics.expectancyR > 0.05 && metrics.profitFactor > 1.1) reasons.push("Positive expectancy and profit factor above 1.1");
  if (metrics.expectancyR <= 0) reasons.push("Non-positive net expectancy");
  if (metrics.profitFactor < 0.95) reasons.push("Profit factor below 0.95");
  if (metrics.maxDrawdownR > 8) reasons.push(`Drawdown ${metrics.maxDrawdownR}R is large relative to typical expectations`);
  if (periods.length >= 3) {
    if (positivePeriods / periods.length >= 0.6) reasons.push(`${positivePeriods}/${periods.length} periods positive`);
    else reasons.push(`Only ${positivePeriods}/${periods.length} periods positive — performance uneven across time`);
    if (bestPeriodShare > 0.8) reasons.push("Most of the net gain depends on a single period");
  }

  const red = metrics.expectancyR < -0.05 || metrics.profitFactor < 0.9 || (periods.length >= 3 && bestPeriodShare > 0.8 && metrics.expectancyR <= 0.05);
  const green = metrics.expectancyR > 0.05 && metrics.profitFactor > 1.1 && metrics.trades >= 30 && metrics.maxDrawdownR <= 8 && periods.length >= 3 && positivePeriods / periods.length >= 0.6 && bestPeriodShare <= 0.6;
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
  const byExpectancy = (a: { expectancyR: number }, b: { expectancyR: number }) => b.expectancyR - a.expectancyR;
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
