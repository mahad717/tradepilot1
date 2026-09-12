// Isomorphic backtest core — the PURE heart of the engine, importable from
// the server AND the browser.
//
// Why this module exists: the deployed Cloudflare Worker kills requests that
// exceed its per-request CPU/memory budget, so a 25 MB CSV upload (480k rows
// parsed + a 25k-candle engine run in one request) dies with HTTP 503. The
// engine itself never needed the server: every module below the orchestration
// layer is pure TypeScript. Moving the core here lets the browser run
// uploaded-CSV backtests LOCALLY — no upload, no Worker limits, full audits —
// while src/lib/ict/backtest.ts (server-only) keeps the fetch-driven paths.
//
// Contents:
//   - moved verbatim from backtest.ts: BacktestResult/BacktestOptions,
//     data-quality audit, scanTrades, runBacktestCore, debugCorePhases,
//     comparison types + row builders
//   - NEW: runCsvBacktest — the uploaded-file pipeline (weekend hygiene,
//     150-candle granular refusals, 25k cap, SMT-disabled honesty), plus
//     row-level sensitivity/strictness/dimension builders and all-in-one
//     helpers so server, tests and the UI share ONE implementation.
import {
  DEFAULT_CONFIG,
  STRICTNESS_PRESETS,
  buildSeriesContext,
  buildSetupAt,
  presetFor,
  type CooldownState,
  type EngineConfig,
  type Strictness,
  type SeriesContext,
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
import type { TradeRecord, DataQuality, RejectedSetupSample, RrDiagnostics, SessionDiagnostics, OrderFlowSummary, ObPipeline, SmtSplit, SmtSplitStat, CostModel } from "./types";
import type { Candle, IntervalKey, SymbolKey } from "@/lib/market/types";
import type { CsvParseSummary } from "@/lib/market/csv";
import { intervalLabelOfKey, granularityLabel } from "@/lib/market/csv";
import { dropWeekendCandles } from "@/lib/market/weekends";

/** Engine window cap for uploaded files — the most recent N candles run. */
export const CSV_CANDLE_CAP = 25000;

export interface BacktestResult {
  symbol: SymbolKey;
  interval: IntervalKey;
  bars: number;
  from: number;
  to: number;
  source: string;
  silverSource: string;
  /** SMT companion state — which correlated series drove divergence checks */
  smt: {
    /** companion label, null when no companion was usable */
    companion: string | null;
    source: string;
    /** divergence events that became knowable inside the window */
    events: number;
    /** share of traded bars whose timestamp has companion data (null = no companion) */
    coveragePct: number | null;
    note: string;
  };
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
  /** where Order-Block candidates actually die (Model C/D diagnosis) */
  obPipeline: ObPipeline;
  /** active OB invalidation rule (compare dimension "obInvalidation") */
  obInvalidation: string;
  /** active OB creation threshold — displacement body ≥ factor × per-bar ATR */
  obDisplacement: number;
  /**
   * Live-SMT honesty check: do SMT-aligned entries actually outperform?
   * null when no live companion ran on this window (a split without SMT
   * data would be attribution noise, same as the no-smt loser tag).
   */
  smtSplit: SmtSplit | null;
  /** requested vs actually-fetched history (deep windows can fall short) */
  fetch: { requested: number; receivedRaw: number; requests: number; shortfallPct: number; deep: boolean };
  /** set when the run was driven by an uploaded CSV instead of the market API */
  csvSummary?: CsvParseSummary;
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
    entryAnchor: string;
    entryToleranceR: number;
    maxCostPctOfR: number;
    targetHorizonR: number;
    orderExpiryBars: number;
    obInvalidation: string;
    obDisplacementFactor: number;
    tierB: number;
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
  /** false skips the SMT companion fetch entirely (SMT confluence then absent) */
  includeCompanion?: boolean;
  /**
   * Uploaded-history mode: when present the run uses these candles verbatim —
   * no TwelveData fetch, no SMT companion (pairing an uploaded series with a
   * live API companion would fabricate divergences across different feeds).
   */
  csvCandles?: Candle[];
  /** parser report for the uploaded CSV — echoed in the result */
  csvSummary?: CsvParseSummary;
}

/**
 * Data-quality audit of the history (spec §18-historical data).
 * The regular Fri-close → Sun-reopen gap (≤ 60h, Fri/Sat/Sun → Sun/Mon) is
 * EXPECTED for spot metals and is not counted as a data issue. On daily (or
 * coarser) candles the whole weekend collapses into one Fri → Mon jump of
 * ≤ 96h — also expected, never a data issue.
 */
function isWeekendGap(fromSec: number, toSec: number, intervalSec = 3600): boolean {
  const a = new Date(fromSec * 1000);
  const b = new Date(toSec * 1000);
  const da = a.getUTCDay();
  const db = b.getUTCDay();
  if (intervalSec >= 86400) {
    return (da === 5 || da === 6 || da === 0) && (db === 0 || db === 1) && toSec - fromSec <= 96 * 3600;
  }
  return (da === 5 || da === 6 || da === 0) && (db === 0 || db === 1) && toSec - fromSec <= 60 * 3600;
}

export function auditDataQuality(candles: Candle[], intervalSec: number, weekendDropped: number): DataQuality {
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
        if (isWeekendGap(p.time, c.time, intervalSec)) weekendGaps++;
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

/** The flat→setup→pending-order loop, extracted so it can be timed in isolation. */
function scanTrades(
  ctx: SeriesContext,
  candles: Candle[],
  cfg: EngineConfig,
  execute: ExecuteConfig,
  executeOpts: { ltfCandles?: Candle[]; ltfSeconds?: number; parentSeconds?: number }
): { trades: TradeRecord[]; pendingTelemetry: PendingTelemetryInput[]; ambiguityCollisions: number } {
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

    const res = simulateTrade(candles, setup, execute, ctx.symbol, ctx.interval, executeOpts);
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
  return { trades, pendingTelemetry, ambiguityCollisions };
}

export function intervalSecondsOfCore(interval: IntervalKey): number {
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
 * runner, the walk-forward partition, the validation suite's replay tests and
 * now the browser's uploaded-CSV runs.
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
  const ctx = buildSeriesContext(symbol, interval, candles, smtEvents, cfg.obInvalidation, cfg.obDisplacementFactor);
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
    entryToleranceR: cfg.entryToleranceR,
  };
  const executeOpts = { ltfCandles, ltfSeconds, parentSeconds: ctx.intervalSec };

  const scan = scanTrades(ctx, candles, cfg, execute, executeOpts);
  const trades = scan.trades;
  const pendingTelemetry = scan.pendingTelemetry;
  const ambiguityCollisions = scan.ambiguityCollisions;

  // tag losers for diagnostics (SMT attribution only when SMT was live —
  // "no-smt" on 100% of losers is noise when the gate is unavailable for all)
  const smtLive = silverSource !== "unavailable" && silverSource !== "SIMULATED";
  for (const t of trades) t.lossReasons = t.netR < 0 ? lossReasonTags(t, smtLive) : [];

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
    "Stops and targets are STRUCTURAL (sweep extremes, protected swings, liquidity pools, PDH/PDL, PWH/PWL, session and external range liquidity) — never fixed R multiples. The minRR gate asks whether AT LEAST ONE structural target within the horizon is minRR away (TP3 = farthest IN-HORIZON level).",
    "Kill zones are DST-aware market-local windows (London 07:00–10:00 Europe/London, NY AM 09:30–12:00 and NY PM 13:30–16:00 America/New_York, Asia 00:00–06:00 UTC).",
    "Accounting: R is measured against each trade's INITIAL stop. Partial exits are share-weighted legs. Breakeven moves take effect the bar after activation.",
    `Costs model — ${symbol}: ${describeCosts(cfg.costs[symbol] ?? DEFAULT_COSTS[symbol])}. Gross R and cost R are reported separately; expectancy is shown gross AND net.`,
    cfg.maxCostPctOfR > 0
      ? `Execution-cost gate: ON — setups whose estimated round-trip cost exceeds ${(cfg.maxCostPctOfR * 100).toFixed(0)}% of 1R are declined (${ctx.diag.costRejected} rejected at the gate).`
      : "Execution-cost gate: OFF — every setup is evaluated regardless of its cost share of 1R.",
    `Entry: limit at the zone ${cfg.entryAnchor === "midpoint" ? "MIDPOINT (deeper fill — verified-best anchor)" : "proximal EDGE (honest-touch baseline)"}${cfg.entryToleranceR > 0 ? `, tolerance +${cfg.entryToleranceR}R (marketable last-look)` : ", strict touch (no tolerance)"}.`,
    `OB invalidation rule: ${cfg.obInvalidation}; creation threshold: displacement body ≥ ${cfg.obDisplacementFactor} × per-bar ATR — the compare dimensions obInvalidation and obDisplacement scan both sides of the OB definition on the same data.`,
    `Target horizon: execution ladder capped at ${cfg.targetHorizonR}R — farther structural levels are landmarks for the RR landmark view, not tradable targets.`,
    `Same-candle SL/TP ambiguity: ${cfg.ambiguity} model. Pessimistic assumes the stop fills first.`,
    `Sessions traded: ${cfg.sessions.length ? cfg.sessions.join(", ") : "ALL (kill zone is a score confluence)"}. Volatility blocks: ${cfg.blockedVolRegimes.join(", ") || "none"}. UNCLEAR market regime → NO TRADE.`,
    dq.note,
    `Pending-order flow: ${ctx.funnel.ordersPlaced} placed → ${ctx.funnel.ordersFilled} filled, ${ctx.funnel.ordersExpired} expired within the ${cfg.orderExpiryBars}-bar window, ${pendingTelemetry.filter((p) => p.outcome === "invalidated").length} zone-invalidated. ${summarizeOrderFlow(pendingTelemetry, cfg.orderExpiryBars).note}`.trim(),
    `Same-candle SL+TP collisions: ${ambiguityCollisions}.${ambiguityCollisions === 0 ? " The ambiguity model had no effect on this run." : ""}`,
    `Weekend candles dropped before the run: ${dq.weekendCandles} (spot metals feeds quote through closed weekends — ICT sessions must not fire there).`,
    silverSource === "SIMULATED"
      ? "Companion feed is SIMULATED — SMT confirmation is illustrative only on this run."
      : "See the SMT companion panel for the divergence source, event count and coverage.",
    "Rule-based historical study for strategy evaluation only — past performance does not guarantee future results. Never describe a small sample as statistically reliable.",
  ];

  const rrDiagOut = rrDiagnostics(ctx.diag.rrDiag);
  const modelCStat = ctx.diag.byModel.get("C_OB_REVERSAL");
  const obPipeline: ObPipeline = {
    zonesCreated: ctx.diag.obZonesCreated,
    zonesInvalidated: ctx.diag.obZonesInvalidated,
    windowSeen: ctx.diag.obWindowSeen,
    skippedMitigated: ctx.diag.obSkipMitigated,
    skippedPosition: ctx.diag.obSkipPosition,
    skippedSweepExtreme: ctx.diag.obSkipSweepExtreme,
    skippedBlacklist: ctx.diag.obSkipBlacklist,
    candidatesWithOb: ctx.diag.obSeen,
    modelCValidSetups: modelCStat?.valid ?? 0,
    displacementFactor: cfg.obDisplacementFactor,
    note: obPipelineNote(ctx.diag, cfg.obDisplacementFactor),
  };

  // SMT honesty split — only meaningful when a live companion actually ran
  // (smtLive is computed above, next to the loser tagging)
  const smtSplit: SmtSplit | null = smtLive ? smtSplitOf(trades) : null;

  // core default (pure runs have no companion I/O) — the public runner overrides
  const smt = {
    companion: null as string | null,
    source: "unavailable",
    events: 0,
    coveragePct: null as number | null,
    note: "Pure core run — no SMT companion was fetched.",
  };

  return {
    symbol,
    interval,
    bars: candles.length,
    from: candles[0]?.time ?? 0,
    to: candles[candles.length - 1]?.time ?? 0,
    source,
    silverSource,
    smt,
    metrics,
    sampleInfo: { category: cat, label: SAMPLE_CATEGORIES[cat].label, note: SAMPLE_CATEGORIES[cat].note },
    equityCurve,
    trades,
    funnel: funnelStages({ totalCandles: candles.length, diag: ctx.diag, funnel: ctx.funnel }),
    rejections: rejectionTable(ctx.diag),
    modelStats: modelPerformance(ctx.diag, trades),
    rrDiagnostics: rrDiagOut,
    sessionFilterDiagnostics: sessionDiagnostics(ctx.diag),
    rejectedSamples: ctx.diag.samples,
    dataQuality: dq,
    orderFlow: summarizeOrderFlow(pendingTelemetry, cfg.orderExpiryBars),
    ambiguityCollisions,
    obPipeline,
    obInvalidation: cfg.obInvalidation,
    obDisplacement: cfg.obDisplacementFactor,
    smtSplit,
    fetch: { requested: candles.length, receivedRaw: candles.length, requests: 0, shortfallPct: 0, deep: false },
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
      entryAnchor: cfg.entryAnchor,
      entryToleranceR: cfg.entryToleranceR,
      maxCostPctOfR: cfg.maxCostPctOfR,
      targetHorizonR: cfg.targetHorizonR,
      orderExpiryBars: cfg.orderExpiryBars,
      obInvalidation: cfg.obInvalidation,
      obDisplacementFactor: cfg.obDisplacementFactor,
      tierB: cfg.tierB,
    },
    notes,
  };
}

/** One-line diagnosis of where OB candidates actually die. */
function obPipelineNote(diag: import("./sequence").DiagSink, factor: number): string {
  if (diag.obZonesCreated === 0) {
    return `No order blocks were created in this window at all — the displacement requirement (body ≥ ${factor} × per-bar ATR with opposing direction) never fired; the detector, not the window, is the bottleneck.`;
  }
  const parts: string[] = [
    `${diag.obZonesCreated} OBs created series-wide at ${factor}× ATR displacement (${diag.obZonesInvalidated} later invalidated)`,
  ];
  if (diag.obWindowSeen === 0) {
    parts.push("NONE fell inside a candidate's sweep→MSS window — the sequence window, not OB quality, is the bottleneck");
  } else {
    parts.push(`${diag.obWindowSeen} seen in candidate windows`);
    const skips: string[] = [];
    if (diag.obSkipMitigated) skips.push(`${diag.obSkipMitigated} mitigated/consumed`);
    if (diag.obSkipPosition) skips.push(`${diag.obSkipPosition} already consumed by price`);
    if (diag.obSkipSweepExtreme) skips.push(`${diag.obSkipSweepExtreme} insane vs sweep extreme`);
    if (diag.obSkipBlacklist) skips.push(`${diag.obSkipBlacklist} blacklisted`);
    if (skips.length) parts.push(`skips: ${skips.join(", ")}`);
    parts.push(`${diag.obSeen} candidates kept a usable OB`);
  }
  return `${parts.join(" — ")}.`;
}

/**
 * SMT honesty split: does the +5 alignment bonus separate outcomes? Cohorts
 * are CLOSED trades, split on the entry-time SMT alignment flag. Notes call
 * out tiny cohorts instead of pretending either row is evidence.
 */
function smtSplitOf(trades: TradeRecord[]): SmtSplit {
  const stat = (ts: TradeRecord[]): SmtSplitStat => {
    const m = computeMetrics(ts);
    return { trades: ts.length, winRate: m.winRate, expectancyR: m.expectancyR, netR: m.netR };
  };
  const aligned = trades.filter((t) => t.smtAligned);
  const notAligned = trades.filter((t) => !t.smtAligned);
  const a = stat(aligned);
  const n = stat(notAligned);
  let note: string;
  if (a.trades === 0 && n.trades === 0) {
    note = "No closed trades on this window — no SMT conclusion is possible.";
  } else if (a.trades < 5) {
    note = `Only ${a.trades} SMT-aligned trade${a.trades === 1 ? "" : "s"} — the split is illustrative, not evidence. Judge the bonus via the score-bucket table and compare dimensions instead.`;
  } else {
    const edge = (a.expectancyR ?? 0) - (n.expectancyR ?? 0);
    note = `Aligned entries ${edge >= 0 ? "outperform" : "UNDERPERFORM"} non-aligned by ${Math.abs(Math.round(edge * 100) / 100)}R expectancy on this window (${a.trades} vs ${n.trades} trades). One window is not proof — read both cohorts before trusting the +5 bonus.`;
  }
  return { live: true, aligned: a, notAligned: n, note };
}

function lossReasonTags(t: TradeRecord, smtLive: boolean): string[] {
  const tags: string[] = [];
  if (t.scores.liquidity < 12) tags.push("weak-sweep");
  if (t.scores.structure < 16) tags.push("weak-displacement");
  if (t.scores.entry < 14) tags.push("poor-entry-zone");
  if (t.mktRegime === "RANGE") tags.push("range-market");
  if (t.volRegime === "HIGH" || t.volRegime === "EXTREME") tags.push("high-volatility");
  if (t.volRegime === "LOW") tags.push("low-volatility");
  if (smtLive && !t.smtAligned) tags.push("no-smt");
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
    { bucket: "60–69 (C)", test: (t) => t.totalScore >= 60 && t.totalScore < 70 },
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

/**
 * Debug phase-timer for resource investigations: times each engine phase in
 * isolation on REAL data. Small payload — returns even when the full run
 * would exceed a Worker CPU cap. Pure — safe in the browser too.
 */
export function debugCorePhases(
  symbol: SymbolKey,
  interval: IntervalKey,
  candles: Candle[],
  smtEvents: SmtEvent[],
  config: Partial<EngineConfig>,
  strictness: Strictness = "balanced",
  stopAfter?: "ctx" | "scan"
): Record<string, number> {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...presetFor(strictness), ...config };
  if (!cfg.costs.XAUUSD) cfg.costs = { ...DEFAULT_COSTS };
  const timings: Record<string, number> = { bars: candles.length, stopAfter: 0 };
  timings.stopAfter = stopAfter === "ctx" ? 1 : stopAfter === "scan" ? 2 : 3;
  let t0 = performance.now();
  const ctx = buildSeriesContext(symbol, interval, candles, smtEvents, cfg.obInvalidation, cfg.obDisplacementFactor);
  timings.buildSeriesContextMs = performance.now() - t0;
  timings.zones = ctx.zones.length;
  timings.sweeps = ctx.sweeps.length;
  timings.pools = ctx.pools.length;
  if (stopAfter === "ctx") return timings;

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
    entryToleranceR: cfg.entryToleranceR,
  };
  const executeOpts = { parentSeconds: ctx.intervalSec };

  t0 = performance.now();
  const scan = scanTrades(ctx, candles, cfg, execute, executeOpts);
  timings.scanMs = performance.now() - t0;
  timings.ordersPlaced = ctx.funnel.ordersPlaced;
  timings.trades = scan.trades.length;
  if (stopAfter === "scan") return timings;

  t0 = performance.now();
  const metrics = computeMetrics(scan.trades);
  const wf = walkForward(scan.trades, candles.length, cfg.warmupBars, 5);
  const mc = scan.trades.length >= 5 ? runMonteCarlo(scan.trades.map((t) => t.netR), 1000, cfg.randomSeed) : null;
  timings.postMs = performance.now() - t0;
  timings.mcPaths = mc ? 1000 : 0;
  timings.netR = Math.round(metrics.netR * 100) / 100;
  return timings;
}

// ---------------------------------------------------------------------------
// Uploaded-CSV runs — the browser-executable pipeline.
//
// Mirrors runBacktest's csvMode branch EXACTLY (same cfg merge, same weekend
// hygiene, same 150-candle granular refusals, same SMT-disabled honesty) but
// with zero I/O: safe on the server, in a Node test and in the browser.
// ---------------------------------------------------------------------------

export interface CsvRunOptions {
  symbol: SymbolKey;
  /** uploaded candles (chronological, parser-validated) */
  candles: Candle[];
  /** parser report — echoed into the result and drives the refusal errors */
  csvSummary: CsvParseSummary;
  /** engine overrides (minRR, beMode, sessions, costs …) */
  config?: Partial<EngineConfig>;
  strictness?: Strictness;
  /** candle spacing; defaults to the parser's detected interval */
  interval?: IntervalKey;
}

/**
 * The UI/server knob set → EngineConfig overrides. Mirrors
 * api/backtest/params.ts buildConfig() field-for-field so an in-browser CSV
 * run and a server run of the same knobs produce IDENTICAL results (seeded
 * engine + seeded Monte Carlo).
 */
export function csvConfigFromUi(
  symbol: SymbolKey,
  ui: {
    minRR: number;
    beMode: string;
    ambiguity: string;
    seed?: number;
    sessions: string[];
    entryAnchor: string;
    entryToleranceR: number;
    maxCostPctOfR: number;
    targetHorizonR?: number;
    obInvalidation: string;
    obDisplacementFactor: number;
    tierB: number;
    spread?: number | null;
    slip?: number | null;
    commBp?: number | null;
  }
): Partial<EngineConfig> {
  const cfg: Partial<EngineConfig> = {
    minRR: ui.minRR,
    beMode: ui.beMode as never,
    ambiguity: ui.ambiguity as never,
    randomSeed: Number.isFinite(ui.seed ?? 42) ? (ui.seed ?? 42) : 42,
    sessions: ui.sessions,
    entryAnchor: ui.entryAnchor as never,
    entryToleranceR: ui.entryToleranceR,
    maxCostPctOfR: ui.maxCostPctOfR,
    targetHorizonR: ui.targetHorizonR ?? 8,
    obInvalidation: ui.obInvalidation as never,
    obDisplacementFactor: ui.obDisplacementFactor,
    tierB: ui.tierB,
  };
  if (ui.spread != null || ui.slip != null || ui.commBp != null) {
    const base = DEFAULT_COSTS[symbol];
    cfg.costs = {
      ...DEFAULT_COSTS,
      [symbol]: {
        spread: ui.spread ?? base.spread,
        slippagePerSide: ui.slip ?? base.slippagePerSide,
        commissionPctPerSide: ui.commBp != null ? ui.commBp / 1e4 : base.commissionPctPerSide,
      },
    } as never;
  }
  return cfg;
}

/**
 * Run the engine on an UPLOADED candle series — no fetch, no companion.
 * Throws the same granular errors as the server route for unusable files
 * (weekly/monthly granularity, below the 150-candle minimum).
 */
export function runCsvBacktest(opts: CsvRunOptions): BacktestResult {
  const symbol = opts.symbol;
  const strictness = opts.strictness ?? "balanced";
  const interval: IntervalKey = opts.interval ?? opts.csvSummary.detectedInterval ?? "15min";
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...presetFor(strictness), ...opts.config };
  if (!cfg.costs.XAUUSD) cfg.costs = { ...DEFAULT_COSTS };

  // cap: the engine window is the most recent CSV_CANDLE_CAP candles of a
  // longer file. The summary is CLONED before appending the cap warning so
  // caller-owned state (React state, cached parse results) is never mutated.
  const summary: CsvParseSummary = { ...opts.csvSummary, warnings: [...opts.csvSummary.warnings] };
  let rawCandles = opts.candles;
  if (rawCandles.length > CSV_CANDLE_CAP) {
    summary.warnings.push(`Using the most recent ${CSV_CANDLE_CAP} of ${rawCandles.length} candles.`);
    rawCandles = rawCandles.slice(-CSV_CANDLE_CAP);
  }

  // CSV runs deliver exactly the file's candles: no fetch shortfall possible.
  const fetch = {
    requested: rawCandles.length,
    receivedRaw: rawCandles.length,
    requests: 0,
    shortfallPct: 0,
    deep: false,
  };

  // Spot metals feeds quote ~24/7 — drop dead weekend hours so ICT session
  // logic never fires in a closed market. Counted in the data-quality audit.
  const { candles, dropped: weekendDropped } = dropWeekendCandles(rawCandles);
  if (candles.length < 150) {
    const s = opts.csvSummary;
    if (s.granularity === "weekly" || s.granularity === "monthly") {
      throw new Error(
        `CSV data is ${granularityLabel(s.granularity).toUpperCase()} (${s.parsed} usable candles from ${s.rowsSeen} rows). The engine needs ≥150 INTRADAY candles (5m/15m/1H) — kill zones, session liquidity and FVG/OB precision cannot be observed on ${granularityLabel(s.granularity)} bars. Weekly/monthly files serve as macro context only; upload intraday history to run the engine.`
      );
    }
    const tf = s.detectedInterval ? `${intervalLabelOfKey(s.detectedInterval)} ` : "";
    throw new Error(
      `CSV data has only ${candles.length} usable ${tf}candles (from ${s.rowsSeen} rows). The engine needs ≥150. Upload a longer history — for meaningful ICT results, several months of 5m/15m/1H candles.`
    );
  }

  const dataQuality = auditDataQuality(candles, intervalSecondsOfCore(interval), weekendDropped);
  dataQuality.requestedBars = fetch.requested;
  dataQuality.rawFetched = fetch.receivedRaw;
  dataQuality.fetchRequests = fetch.requests;
  dataQuality.fetchShortfallPct = fetch.shortfallPct;
  {
    const s = opts.csvSummary;
    dataQuality.note = `Data source: uploaded CSV (${s.format}) — ${s.parsed} candles${s.detectedInterval ? ` @ ${intervalLabelOfKey(s.detectedInterval)}` : ""}, ${new Date((s.from ?? 0) * 1000).toISOString().slice(0, 10)} → ${new Date((s.to ?? 0) * 1000).toISOString().slice(0, 10)}; ${s.skipped} row${s.skipped === 1 ? "" : "s"} skipped, ${s.duplicatesRemoved} duplicate${s.duplicatesRemoved === 1 ? "" : "s"} removed. ${dataQuality.note}`;
    if (s.detectedSeconds !== null && s.detectedSeconds >= 86400) {
      dataQuality.note += ` WARNING: daily (or coarser) candles — kill zones, session liquidity and intraday FVG/OB precision cannot be observed on daily bars; treat results as a coarse approximation.`;
    }
  }

  // CSV runs deliberately go WITHOUT an SMT companion: mixing an uploaded
  // series with a live API feed would fabricate divergences across sources.
  const smt = {
    companion: null as string | null,
    source: "disabled (uploaded CSV)",
    events: 0,
    coveragePct: null as number | null,
    note: "Data source is an uploaded CSV — SMT confluence is disabled. Pairing an uploaded series with a live API companion would fabricate divergences across different feeds.",
  };

  const result = runBacktestCore(symbol, interval, candles, [], cfg, "CSV", "unavailable", undefined, undefined, strictness, dataQuality);
  result.fetch = fetch;
  result.smt = smt;
  result.csvSummary = summary;
  return result;
}

// ---------------------------------------------------------------------------
// Comparison machinery (parity with the server's compareStrictness /
// compareDimension) — split into ROW-LEVEL builders so a browser UI can
// interleave paints between the multi-second runs, plus all-in-one helpers
// for server/test callers.
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

export type CompareDimension = "strictness" | "expiry" | "sessions" | "entry" | "be" | "obInvalidation" | "obDisplacement" | "ambiguity";

export interface DimensionRow {
  label: string;
  description: string;
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number;
  netR: number;
  grossR: number;
  costsR: number;
}

export interface DimensionComparison {
  dimension: CompareDimension;
  rows: DimensionRow[];
}

export interface SensitivityRow {
  minRR: number;
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  netR: number;
}

export function toStrictnessRow(strictness: Strictness, r: BacktestResult): StrictnessComparisonRow {
  return {
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
  };
}

export function toDimensionRow(label: string, description: string, r: BacktestResult): DimensionRow {
  return {
    label,
    description,
    trades: r.metrics.trades,
    winRate: r.metrics.winRate,
    expectancyR: r.metrics.expectancyR,
    profitFactor: r.metrics.profitFactor,
    maxDrawdownR: r.metrics.maxDrawdownR,
    netR: r.metrics.netR,
    grossR: r.metrics.grossR,
    costsR: r.metrics.costsR,
  };
}

export function sensitivityRowCsv(opts: CsvRunOptions, rr: number, base?: BacktestResult): SensitivityRow {
  const baseMinRR = opts.config?.minRR;
  const r = base && rr === baseMinRR ? base : runCsvBacktest({ ...opts, config: { ...opts.config, minRR: rr } });
  return {
    minRR: rr,
    trades: r.metrics.trades,
    winRate: r.metrics.winRate,
    expectancyR: r.metrics.expectancyR,
    profitFactor: r.metrics.profitFactor,
    netR: r.metrics.netR,
  };
}

export function strictnessRowCsv(opts: CsvRunOptions, strictness: Strictness, base?: BacktestResult): StrictnessComparisonRow {
  const r = base && strictness === (opts.strictness ?? "balanced") ? base : runCsvBacktest({ ...opts, strictness });
  return toStrictnessRow(strictness, r);
}

/** The per-dimension run plan — label, description, config overrides. */
export function dimensionPlan(dim: Exclude<CompareDimension, "strictness">): { label: string; description: string; over: Partial<EngineConfig> }[] {
  if (dim === "expiry") {
    return [
      { label: "6-bar expiry", description: "pending limits live 6 bars", over: { orderExpiryBars: 6 } },
      { label: "12-bar expiry", description: "pending limits live 12 bars (current default)", over: { orderExpiryBars: 12 } },
      { label: "24-bar expiry", description: "pending limits live 24 bars", over: { orderExpiryBars: 24 } },
    ];
  }
  if (dim === "sessions") {
    return [
      { label: "All sessions", description: "every session allowed (kill zone = score confluence only)", over: { sessions: [] } },
      { label: "Kill zones only", description: "asia + london + ny-am + ny-pm allowed", over: { sessions: ["asia", "london", "ny-am", "ny-pm"] } },
    ];
  }
  if (dim === "entry") {
    return [
      { label: "Edge + strict", description: "limit at the proximal edge, no tolerance (honest-touch baseline)", over: { entryAnchor: "edge", entryToleranceR: 0 } },
      { label: "Edge + 0.05R tolerance", description: "marketable last-look within 0.05R of the edge limit", over: { entryAnchor: "edge", entryToleranceR: 0.05 } },
      { label: "Midpoint + strict", description: "limit at the zone midpoint — deeper fill, worse location", over: { entryAnchor: "midpoint", entryToleranceR: 0 } },
      { label: "Midpoint + 0.05R tolerance", description: "marketable last-look around the midpoint limit (verified best on XAU 15m)", over: { entryAnchor: "midpoint", entryToleranceR: 0.05 } },
    ];
  }
  if (dim === "ambiguity") {
    // The SL/TP same-bar conflict sweep — which side of an ambiguous candle
    // wins. Pessimistic = lower bound, Optimistic = upper bound, Randomized
    // = seeded 50/50 (the expected honest read in between).
    return [
      { label: "Pessimistic", description: "conflict resolves to the STOP — lower-bound win rate", over: { ambiguity: "pessimistic" } },
      { label: "Optimistic", description: "conflict resolves to the TARGET — upper-bound win rate (verified best)", over: { ambiguity: "optimistic" } },
      { label: "Randomized", description: "seeded 50/50 per conflict — expected honest read in between", over: { ambiguity: "randomized" } },
    ];
  }
  if (dim === "be") {
    return [
      { label: "TP1 → entry (plain BE)", description: "stop to entry after TP1 — scratch, before costs", over: { beMode: "tp1" } },
      { label: "TP1 → entry + costs (BE+)", description: "stop locks the round-trip cost buffer on the remaining shares — worst case after TP1 is a small net win (current default)", over: { beMode: "tp1cost" } },
      { label: "risk1 @ +0.5R trigger", description: "stop to entry once prior-bar MFE reached +0.5R (also covers trades that miss TP1)", over: { beMode: "risk1", beTriggerR: 0.5 } },
      { label: "Structural", description: "stop to the last confirmed swing beyond entry", over: { beMode: "structural" } },
    ];
  }
  if (dim === "obInvalidation") {
    return [
      { label: "Close through midpoint", description: "a CLOSE beyond the zone midpoint kills the block (current default)", over: { obInvalidation: "close-mid" } },
      { label: "Wick through midpoint", description: "ANY trade beyond the midpoint kills the block (strictest)", over: { obInvalidation: "wick-mid" } },
      { label: "Close through full zone", description: "a CLOSE beyond the whole zone kills the block (classic strict ICT)", over: { obInvalidation: "close-distal" } },
      { label: "Wick through full zone", description: "ANY trade through the whole zone kills the block (loosest)", over: { obInvalidation: "wick-distal" } },
    ];
  }
  // obDisplacement — invalidation rules proved to give IDENTICAL trade sets
  // (Task 12), so OB scarcity lives upstream at creation.
  return [
    { label: "0.8× ATR displacement", description: "very loose creation — any decent opposing-candle reversal qualifies", over: { obDisplacementFactor: 0.8 } },
    { label: "1.0× ATR displacement", description: "loose creation — body at least one average true range", over: { obDisplacementFactor: 1.0 } },
    { label: "1.2× ATR displacement", description: "current default — institutional displacement required", over: { obDisplacementFactor: 1.2 } },
    { label: "1.5× ATR displacement", description: "strict creation — only violent reversals create blocks", over: { obDisplacementFactor: 1.5 } },
  ];
}

/** All-in-one: minRR sensitivity rows across periods (server/test callers). */
export function minRRSensitivityCsv(opts: CsvRunOptions, minRRs: number[], base?: BacktestResult): SensitivityRow[] {
  return minRRs.map((rr) => sensitivityRowCsv(opts, rr, base));
}

/** All-in-one: the three strictness presets on the uploaded window. */
export function compareStrictnessCsv(opts: CsvRunOptions, base?: BacktestResult): StrictnessComparisonRow[] {
  const levels: Strictness[] = ["conservative", "balanced", "aggressive"];
  return levels.map((s) => strictnessRowCsv(opts, s, base));
}

/** All-in-one: one-dimension comparison on the uploaded window. */
export function compareDimensionCsv(opts: CsvRunOptions, dimension: CompareDimension, base?: BacktestResult): DimensionComparison {
  if (dimension === "strictness") {
    const rows = compareStrictnessCsv(opts, base).map((r) => ({
      label: r.strictness,
      description: r.description,
      trades: r.trades,
      winRate: r.winRate,
      expectancyR: r.expectancyR,
      profitFactor: r.profitFactor,
      maxDrawdownR: r.maxDrawdownR,
      netR: r.netR,
      grossR: 0,
      costsR: 0,
    }));
    return { dimension, rows };
  }
  const rows = dimensionPlan(dimension).map(({ label, description, over }) =>
    toDimensionRow(label, description, runCsvBacktest({ ...opts, config: { ...opts.config, ...over } }))
  );
  return { dimension, rows };
}
