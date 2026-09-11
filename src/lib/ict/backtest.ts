// Engine v3 — walk-forward backtester orchestrator.
//
// Bias controls (verified by the self-test suite, spec #36):
//  - NO look-ahead: setups decided on bar close i; orders fill from i+1;
//    HTF bias uses only CLOSED HTF candles; swings used only when confirmed.
//  - Same-candle SL/TP ambiguity: pessimistic by default (stop first),
//    optional optimistic / seeded-random / lower-timeframe resolution.
//  - Costs separated: spread + slippage + commission, attributed per leg.
//  - Results reported in net R against the INITIAL risk of each trade.
//
// Diagnostics (spec §1–§19): signal funnel, ranked rejection reasons,
// per-model performance, RR + session filter diagnostics, data-quality
// audit, rejected-setup samples and the Conservative/Balanced/Aggressive
// comparison. All numbers come from the executed run — nothing fitted.
import "server-only";
import { getCandles, getCandlesDeep, dropWeekendCandles } from "@/lib/market";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import {
  DEFAULT_CONFIG,
  STRICTNESS_PRESETS,
  buildSeriesContext,
  buildSetupAt,
  presetFor,
  type CooldownState,
  type EngineConfig,
  type Strictness,
} from "./sequence";
import { simulateTrade, type ExecuteConfig } from "./execution";
import {
  computeMetrics, lossReasonTable, mfeMaeAnalysis, robustnessFlags, buildReport,
  funnelStages, rejectionTable, modelPerformance, rrDiagnostics, sessionDiagnostics,
  sampleCategory, SAMPLE_CATEGORIES, summarizeOrderFlow,
  type BacktestReport, type FunnelRow, type LossReasonRow, type MfeMaeAnalysis,
  type RejectionRow, type ModelPerformanceRow, type PendingTelemetryInput,
  type RobustnessFlags,
  type SessionStat, type ScoreBucketStat, type ManagementRates, type SampleCategory,
} from "./diagnostics";
import { runMonteCarlo, type MonteCarloResult } from "./montecarlo";
import { walkForward, type WalkForwardResult } from "./walkforward";
import { smtSeries, type SmtEvent } from "./smtseries";
import { DEFAULT_COSTS, describeCosts } from "./costs";
import type { TradeRecord, DataQuality, RejectedSetupSample, RrDiagnostics, SessionDiagnostics, OrderFlowSummary } from "./types";
import type { Candle } from "@/lib/market/types";

export interface BacktestResult {
  symbol: SymbolKey;
  interval: IntervalKey;
  bars: number;
  from: number;
  to: number;
  source: string;
  silverSource: string;
  metrics: ReturnType<typeof computeMetrics>;
  sampleInfo: { category: SampleCategory; label: string; note: string };
  equityCurve: { time: number; r: number }[];
  trades: TradeRecord[];
  funnel: FunnelRow[];
  rejections: RejectionRow[];
  modelStats: ModelPerformanceRow[];
  rrDiagnostics: RrDiagnostics;
  sessionFilterDiagnostics: SessionDiagnostics;
  rejectedSamples: RejectedSetupSample[];
  dataQuality: DataQuality;
  orderFlow: OrderFlowSummary;
  /** same-candle SL+TP collisions — 0 means the ambiguity model had no effect */
  ambiguityCollisions: number;
  strictness: Strictness;
  strictnessNote: string;
  lossReasons: LossReasonRow[];
  mfeMae: MfeMaeAnalysis;
  sessions: SessionStat[];
  scoreBuckets: ScoreBucketStat[];
  management: ManagementRates;
  report: BacktestReport;
  monteCarlo: MonteCarloResult | null;
  walkForward: WalkForwardResult;
  flags: RobustnessFlags;
  config: {
    minRR: number;
    beMode: string;
    ambiguity: string;
    sessions: string[];
    models: string[];
    partialShares: number[];
    maxHoldBars: number;
    tierThresholds: { aPlus: number; a: number; b: number };
  };
  notes: string[];
}

export interface BacktestOptions {
  symbol: SymbolKey;
  interval: IntervalKey;
  bars?: number;
  config?: Partial<EngineConfig>;
  includeSilverForSmt?: boolean;
  strictness?: Strictness;
}

/**
 * Data-quality audit of the fetched history (spec §18-historical data).
 * The regular Fri-close → Sun-reopen gap (≤ 60h, Fri/Sat/Sun → Sun/Mon) is
 * EXPECTED for spot metals and is not counted as a data issue.
 */
function isWeekendGap(fromSec: number, toSec: number): boolean {
  const a = new Date(fromSec * 1000);
  const b = new Date(toSec * 1000);
  const da = a.getUTCDay();
  const db = b.getUTCDay();
  return (da === 5 || da === 6 || da === 0) && (db === 0 || db === 1) && toSec - fromSec <= 60 * 3600;
}

function auditDataQuality(candles: Candle[], intervalSec: number, weekendDropped: number): DataQuality {
  let duplicates = 0;
  let outOfOrder = 0;
  let gaps = 0;
  let weekendGaps = 0;
  let invalidOhlc = 0;
  let largestGapBars = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!(c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.low > 0 && c.high > 0)) invalidOhlc++;
    if (i > 0) {
      const p = candles[i - 1];
      const dt = c.time - p.time;
      if (dt === 0) duplicates++;
      else if (dt < 0) outOfOrder++;
      else if (dt > intervalSec) {
        gaps++;
        largestGapBars = Math.max(largestGapBars, Math.round(dt / intervalSec));
        if (isWeekendGap(p.time, c.time)) weekendGaps++;
      }
    }
  }
  const unexpectedGaps = gaps - weekendGaps;
  const ok = duplicates === 0 && outOfOrder === 0 && invalidOhlc === 0 && unexpectedGaps === 0;
  const issues: string[] = [];
  if (duplicates) issues.push(`${duplicates} duplicate timestamps`);
  if (outOfOrder) issues.push(`${outOfOrder} out-of-order candles`);
  if (invalidOhlc) issues.push(`${invalidOhlc} invalid OHLC rows`);
  if (unexpectedGaps) issues.push(`${unexpectedGaps} unexpected gaps (largest ${largestGapBars} bars)`);
  const clean = issues.length === 0;
  const gapNote = gaps > 0 ? ` ${gaps} gap${gaps === 1 ? "" : "s"} (${weekendGaps} expected weekend Fri→Sun reopen, largest ${largestGapBars} bars).` : "";
  const note = `${clean ? "History is clean: chronological, valid OHLC" : `Data issues: ${issues.join("; ")}`}.${gapNote} ${weekendDropped} weekend candle${weekendDropped === 1 ? "" : "s"} dropped before the run (Sat + Sun<22:00 UTC).`;
  return {
    bars: candles.length,
    duplicates, outOfOrder, gaps, invalidOhlc, largestGapBars,
    weekendCandles: weekendDropped,
    ok,
    note,
  };
}

/** Public entry — fetches data then runs the pure core. */
export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  const { symbol, interval } = opts;
  const bars = Math.min(Math.max(opts.bars ?? 1500, 400), 25000);
  const strictness = opts.strictness ?? "balanced";
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...presetFor(strictness), ...opts.config };
  if (!cfg.costs.XAUUSD) cfg.costs = { ...DEFAULT_COSTS };

  // Deep windows (sample-size starvation is the #1 honest blocker) are
  // assembled from paginated ≤5000-bar chunks; standard windows use the
  // single-request path.
  const fetchRes = bars > 5000
    ? await getCandlesDeep(symbol, interval, bars)
    : await getCandles(symbol, interval, bars);
  const rawCandles = fetchRes.candles;
  // Spot metals feeds quote ~24/7 — drop dead weekend hours so ICT session
  // logic never fires in a closed market. Counted in the data-quality audit.
  const { candles, dropped: weekendDropped } = dropWeekendCandles(rawCandles);
  if (candles.length < 150) throw new Error("Not enough historical candles for a backtest");
  const dataQuality = auditDataQuality(candles, intervalSecondsOf(interval), weekendDropped);

  // silver for SMT confirmation (optional — simulated silver is labelled)
  let silver: Candle[] = [];
  let silverSource = "unavailable";
  if (opts.includeSilverForSmt !== false && cfg.models.includes("E_SMT_REVERSAL")) {
    try {
      const res = await getCandles("XAGUSD", interval, Math.min(bars, 5000));
      silver = dropWeekendCandles(res.candles).candles;
      silverSource = res.source;
    } catch {
      silver = [];
    }
  }

  const smtEvents = silver.length > 40 ? smtSeries(candles, silver) : [];

  // lower-timeframe data for the "ltf" candle-ambiguity model (spec #29)
  let ltfCandles: Candle[] | undefined;
  let ltfSeconds: number | undefined;
  if (cfg.ambiguity === "ltf" && interval === "15min") {
    try {
      const ltf = await getCandles(symbol, "5min", Math.min(bars * 3, 5000));
      if (ltf.candles.length > 0) {
        ltfCandles = ltf.candles;
        ltfSeconds = 300;
      }
    } catch {
      // fall back to pessimistic resolution — noted in the results
    }
  }

  return runBacktestCore(symbol, interval, candles, smtEvents, cfg, fetchRes.source, silverSource, ltfCandles, ltfSeconds, strictness, dataQuality);
}

function intervalSecondsOf(interval: IntervalKey): number {
  switch (interval) {
    case "5min": return 300;
    case "15min": return 900;
    case "1h": return 3600;
    case "4h": return 14400;
    default: return 86400;
  }
}

/**
 * PURE backtest core on a given candle array (no I/O) — shared by the public
 * runner, the walk-forward partition and the validation suite's replay tests.
 */
export function runBacktestCore(
  symbol: SymbolKey,
  interval: IntervalKey,
  candles: Candle[],
  smtEvents: SmtEvent[],
  cfg: EngineConfig,
  source = "UNKNOWN",
  silverSource = "unavailable",
  ltfCandles?: Candle[],
  ltfSeconds?: number,
  strictness: Strictness = "balanced",
  dataQuality?: DataQuality
): BacktestResult {
  const ctx = buildSeriesContext(symbol, interval, candles, smtEvents);
  const execute: ExecuteConfig = {
    beMode: cfg.beMode,
    beTriggerR: cfg.beTriggerR,
    partialShares: cfg.partialShares,
    maxHoldBars: cfg.maxHoldBars,
    orderExpiryBars: cfg.orderExpiryBars,
    ambiguity: cfg.ambiguity,
    randomSeed: cfg.randomSeed,
    riskMoney: cfg.riskMoney,
    costs: cfg.costs[symbol] ?? DEFAULT_COSTS[symbol],
  };
  const executeOpts = { ltfCandles, ltfSeconds, parentSeconds: ctx.intervalSec };

  const trades: TradeRecord[] = [];
  const pendingTelemetry: PendingTelemetryInput[] = [];
  let ambiguityCollisions = 0;
  const cooldown: CooldownState = {
    usedSweepKeys: new Set(),
    blacklistedZones: new Set(),
    lastSignalIndex: -Infinity,
  };

  const start = Math.min(cfg.warmupBars, Math.max(0, candles.length - 50));
  let i = start;
  while (i < candles.length) {
    // flat — look for a new setup on bar i close
    const { setup } = buildSetupAt(ctx, i, cfg, cooldown);
    if (!setup || setup.tier === "NO_TRADE") {
      i++;
      continue;
    }
    // cooldown gate (spec #17) — recorded as a rejection for diagnostics
    if (i - cooldown.lastSignalIndex < cfg.minBarsBetweenSignals) {
      ctx.diag.rejections.set("COOLDOWN", (ctx.diag.rejections.get("COOLDOWN") ?? 0) + 1);
      ctx.diag.primary.set("COOLDOWN", (ctx.diag.primary.get("COOLDOWN") ?? 0) + 1);
      i++;
      continue;
    }
    cooldown.lastSignalIndex = i;
    cooldown.usedSweepKeys.add(setup.sweepKey);
    ctx.funnel.ordersPlaced++;

    const res = simulateTrade(candles, setup, execute, symbol, interval, executeOpts);
    pendingTelemetry.push(res.pending);
    ambiguityCollisions += res.ambiguousBars;
    if (res.filled && res.trade) {
      trades.push(res.trade);
      ctx.funnel.ordersFilled++;
      ctx.funnel.tradesClosed++;
      if (res.trade.netR < 0 && cfg.sameZoneCooldown) {
        cooldown.blacklistedZones.add(res.trade.zoneId);
      }
    } else {
      // limit order never filled → the retracement never happened
      ctx.funnel.ordersExpired++;
      ctx.diag.rejections.set("SETUP_EXPIRED", (ctx.diag.rejections.get("SETUP_EXPIRED") ?? 0) + 1);
      ctx.diag.primary.set("SETUP_EXPIRED", (ctx.diag.primary.get("SETUP_EXPIRED") ?? 0) + 1);
    }
    i = Math.max(res.endIndex + 1, i + 1);
  }

  // tag losers for diagnostics
  for (const t of trades) t.lossReasons = t.netR < 0 ? lossReasonTags(t) : [];

  const metrics = computeMetrics(trades);
  let equity = 0;
  const equityCurve = trades.map((t) => {
    equity += t.netR;
    return { time: t.exitTime, r: Math.round(equity * 100) / 100 };
  });

  const wf = walkForward(trades, candles.length, cfg.warmupBars, 5);
  const flags = robustnessFlags(metrics, wf.periods);
  const cat = sampleCategory(metrics.trades);

  const dq = dataQuality ?? {
    bars: candles.length, duplicates: 0, outOfOrder: 0, gaps: 0, invalidOhlc: 0,
    largestGapBars: 0, weekendCandles: 0, ok: true, note: "Synthetic series — data-quality audit skipped.",
  };

  const notes = [
    `Strictness preset: ${strictness.toUpperCase()} — ${STRICTNESS_PRESETS[strictness]}.`,
    `Models enabled: ${cfg.models.join(", ")}. Core requirements (spec §5): HTF context + liquidity event + MSS/CHOCH + displacement + entry zone + structural SL + valid target. SMT, kill zone, FVG+OB overlap, premium/discount and session liquidity are OPTIONAL score confluence.`,
    "Stops and targets are STRUCTURAL (sweep extremes, protected swings, liquidity pools, PDH/PDL, PWH/PWL, session and external range liquidity) — never fixed R multiples. The minRR gate asks whether AT LEAST ONE structural target is minRR away (TP3 = farthest level, not the 3rd-nearest).",
    "Kill zones are DST-aware market-local windows (London 07:00–10:00 Europe/London, NY AM 09:30–12:00 and NY PM 13:30–16:00 America/New_York, Asia 00:00–06:00 UTC).",
    "Accounting: R is measured against each trade's INITIAL stop. Partial exits are share-weighted legs. Breakeven moves take effect the bar after activation.",
    `Costs model — ${symbol}: ${describeCosts(cfg.costs[symbol] ?? DEFAULT_COSTS[symbol])}. Gross R and cost R are reported separately; expectancy is shown gross AND net.`,
    `Same-candle SL/TP ambiguity: ${cfg.ambiguity} model. Pessimistic assumes the stop fills first.`,
    `Sessions traded: ${cfg.sessions.length ? cfg.sessions.join(", ") : "ALL (kill zone is a score confluence)"}. Volatility blocks: ${cfg.blockedVolRegimes.join(", ") || "none"}. UNCLEAR market regime → NO TRADE.`,
    dq.note,
    `Pending-order flow: ${ctx.funnel.ordersPlaced} placed → ${ctx.funnel.ordersFilled} filled, ${ctx.funnel.ordersExpired} expired within the ${cfg.orderExpiryBars}-bar window, ${pendingTelemetry.filter((p) => p.outcome === "invalidated").length} zone-invalidated. ${summarizeOrderFlow(pendingTelemetry, cfg.orderExpiryBars).note}`.trim(),
    `Same-candle SL+TP collisions: ${ambiguityCollisions}.${ambiguityCollisions === 0 ? " The ambiguity model had no effect on this run." : ""}`,
    `Weekend candles dropped before the run: ${dq.weekendCandles} (spot metals feeds quote through closed weekends — ICT sessions must not fire there).`,
    silverSource === "SIMULATED"
      ? "Silver feed is SIMULATED — SMT confirmation is illustrative only on this run."
      : silverSource === "unavailable"
        ? "Silver feed unavailable — SMT confirmation disabled for this run."
        : "Live silver feed used for SMT confirmation.",
    "Rule-based historical study for strategy evaluation only — past performance does not guarantee future results. Never describe a small sample as statistically reliable.",
  ];

  return {
    symbol,
    interval,
    bars: candles.length,
    from: candles[0]?.time ?? 0,
    to: candles[candles.length - 1]?.time ?? 0,
    source,
    silverSource,
    metrics,
    sampleInfo: { category: cat, label: SAMPLE_CATEGORIES[cat].label, note: SAMPLE_CATEGORIES[cat].note },
    equityCurve,
    trades,
    funnel: funnelStages({ totalCandles: candles.length, diag: ctx.diag, funnel: ctx.funnel }),
    rejections: rejectionTable(ctx.diag),
    modelStats: modelPerformance(ctx.diag, trades),
    rrDiagnostics: rrDiagnostics(ctx.diag.rrDiag),
    sessionFilterDiagnostics: sessionDiagnostics(ctx.diag),
    rejectedSamples: ctx.diag.samples,
    dataQuality: dq,
    orderFlow: summarizeOrderFlow(pendingTelemetry, cfg.orderExpiryBars),
    ambiguityCollisions,
    strictness,
    strictnessNote: STRICTNESS_PRESETS[strictness],
    lossReasons: lossReasonTable(trades),
    mfeMae: mfeMaeAnalysis(trades),
    sessions: sessionStatsOf(trades),
    scoreBuckets: scoreBucketsOf(trades),
    management: buildReport(trades, metrics).management,
    report: buildReport(trades, metrics),
    monteCarlo: trades.length >= 5 ? runMonteCarlo(trades.map((t) => t.netR), 1000, cfg.randomSeed) : null,
    walkForward: wf,
    flags,
    config: {
      minRR: cfg.minRR,
      beMode: cfg.beMode,
      ambiguity: cfg.ambiguity,
      sessions: cfg.sessions,
      models: [...cfg.models],
      partialShares: [...cfg.partialShares],
      maxHoldBars: cfg.maxHoldBars,
      tierThresholds: { aPlus: cfg.tierAPlus, a: cfg.tierA, b: cfg.tierB },
    },
    notes,
  };
}

// local re-implementations to avoid circular import with diagnostics
function lossReasonTags(t: TradeRecord): string[] {
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

function sessionStatsOf(trades: TradeRecord[]) {
  const bySession = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    const arr = bySession.get(t.session) ?? [];
    arr.push(t);
    bySession.set(t.session, arr);
  }
  return [...bySession.entries()]
    .map(([session, ts]) => {
      const m = computeMetrics(ts);
      return { session, trades: ts.length, winRate: m.winRate, expectancyR: m.expectancyR, netR: m.netR };
    })
    .sort((a, b) => b.trades - a.trades);
}

function scoreBucketsOf(trades: TradeRecord[]) {
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
// Strictness comparison (spec §16, §17) — run the SAME data through the three
// presets and report all three objectively. Never auto-select a winner.
// ---------------------------------------------------------------------------

export interface StrictnessComparisonRow {
  strictness: Strictness;
  description: string;
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number;
  netR: number;
  modelBreakdown: { model: string; trades: number; expectancyR: number | null }[];
}

export async function compareStrictness(
  opts: {
    symbol: SymbolKey;
    interval: IntervalKey;
    bars?: number;
    config?: Partial<EngineConfig>;
    includeSilverForSmt?: boolean;
  }
): Promise<StrictnessComparisonRow[]> {
  const levels: Strictness[] = ["conservative", "balanced", "aggressive"];
  const rows: StrictnessComparisonRow[] = [];
  for (const strictness of levels) {
    const r = await runBacktest({ ...opts, strictness });
    rows.push({
      strictness,
      description: STRICTNESS_PRESETS[strictness],
      trades: r.metrics.trades,
      winRate: r.metrics.winRate,
      expectancyR: r.metrics.expectancyR,
      profitFactor: r.metrics.profitFactor,
      maxDrawdownR: r.metrics.maxDrawdownR,
      netR: r.metrics.netR,
      modelBreakdown: r.modelStats
        .filter((m) => m.trades > 0)
        .map((m) => ({ model: m.label, trades: m.trades, expectancyR: m.expectancyR })),
    });
  }
  return rows;
}
