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
import type { SeriesContext } from "./sequence";
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
import { getCompanionCandles } from "@/lib/market";
import type { TradeRecord, DataQuality, RejectedSetupSample, RrDiagnostics, SessionDiagnostics, OrderFlowSummary, ObPipeline, SmtSplit, SmtSplitStat } from "./types";
import type { Candle } from "@/lib/market/types";

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
  // fetch accounting: deep windows can silently fall short (upstream runs
  // dry / request budget) — surface requested vs received so two runs of
  // the same selector are comparable and shortfalls are never hidden.
  const requests = (fetchRes as { requests?: number }).requests ?? 0;
  const fetch = {
    requested: bars,
    receivedRaw: rawCandles.length,
    requests,
    shortfallPct: bars > 0 ? Math.max(0, Math.round(((bars - rawCandles.length) / bars) * 1000) / 10) : 0,
    deep: bars > 5000,
  };
  // Spot metals feeds quote ~24/7 — drop dead weekend hours so ICT session
  // logic never fires in a closed market. Counted in the data-quality audit.
  const { candles, dropped: weekendDropped } = dropWeekendCandles(rawCandles);
  if (candles.length < 150) throw new Error("Not enough historical candles for a backtest");
  const dataQuality = auditDataQuality(candles, intervalSecondsOf(interval), weekendDropped);
  dataQuality.requestedBars = fetch.requested;
  dataQuality.rawFetched = fetch.receivedRaw;
  dataQuality.fetchRequests = fetch.requests;
  dataQuality.fetchShortfallPct = fetch.shortfallPct;
  if (fetch.deep && fetch.shortfallPct > 10) {
    dataQuality.note += ` WARNING: requested ${fetch.requested} bars but the upstream delivered only ${fetch.receivedRaw} raw (${fetch.shortfallPct}% shortfall over ${fetch.requests} chunk requests) — this window is SMALLER than the selector promises; runs are only comparable at equal received bars.`;
  }

  // SMT companion (optional): the correlated second series SMT compares
  // against. Live companion → real divergence confluence; unavailable → SMT
  // score bonus is silently absent, which the run now states explicitly.
  const companion = fetchRes.source === "LIVE" ? await getCompanionCandles(symbol, interval, bars) : null;
  const companionFailed = !!companion?.error;
  const companionCandles = companion && !companion.error ? dropWeekendCandles(companion.candles).candles : [];
  const smtEvents: SmtEvent[] = companionCandles.length > 40 ? smtSeries(candles, companionCandles) : [];
  const companionTimeSet = new Set(companionCandles.map((c) => c.time));
  const smtCoveragePct = companion && !companion.error
    ? Math.round((candles.filter((c) => companionTimeSet.has(c.time)).length / Math.max(1, candles.length)) * 1000) / 10
    : null;
  const smt = {
    companion: companion && !companion.error ? companion.label : null,
    source: companion && !companion.error ? companion.source : (fetchRes.source !== "LIVE" ? "unavailable (simulated base series)" : "unavailable"),
    events: smtEvents.length,
    coveragePct: smtCoveragePct,
    note: companionFailed
      ? `SMT companion fetch failed (${companion!.error}) — SMT confluence contributes nothing on this run. This is often a transient credit/rate limit; retry shortly.`
      : companion?.note ?? (fetchRes.source !== "LIVE"
        ? "The traded series is simulated — pairing it with a live companion would fabricate divergences, so SMT is disabled on this run."
        : "No SMT companion was fetchable — SMT confluence contributes nothing on this run."),
  };
  if (smtCoveragePct !== null && smtCoveragePct < 60) {
    smt.note += ` WARNING: companion data covers only ${smtCoveragePct}% of the traded window (upstream returned a partial series) — divergence confluence was judged on the covered part only; runs at different coverage are not comparable.`;
  }

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

  // legacy field name kept for UI/API compat — now reflects the SMT companion
  const silverSource = companion && !companion.error ? companion.source : "unavailable";
  const result = runBacktestCore(symbol, interval, candles, smtEvents, cfg, fetchRes.source, silverSource, ltfCandles, ltfSeconds, strictness, dataQuality);
  result.fetch = fetch; // caller-side accounting overrides the core default
  result.smt = smt;
  return result;
}

/**
 * The flat→setup→pending-order loop, extracted so the debug phase-timer can
 * time the scan in isolation (deep-window 1102 localization).
 */
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

    const res = simulateTrade(candles, setup, execute, symbolOf(ctx), intervalOf(ctx), executeOpts);
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

// ctx carries symbol/interval for simulateTrade's trade-id prefix
function symbolOf(ctx: SeriesContext): SymbolKey {
  return ctx.symbol;
}
function intervalOf(ctx: SeriesContext): IntervalKey {
  return ctx.interval;
}

/**
 * Debug phase-timer for the deep-window resource investigation: times each
 * engine phase in isolation on REAL data. Small payload — returns even when
 * the full run would exceed the Worker CPU cap.
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
    `Entry: limit at the zone ${cfg.entryAnchor === "midpoint" ? "MIDPOINT (deeper fill, worse location)" : "proximal EDGE (ICT default)"}${cfg.entryToleranceR > 0 ? `, tolerance +${cfg.entryToleranceR}R (marketable last-look)` : ", strict touch (no tolerance)"}.`,
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

// local re-implementations to avoid circular import with diagnostics
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

// ---------------------------------------------------------------------------
// Dimension comparison — run the SAME data through variants of ONE execution
// dimension (expiry window / session filter / entry placement) and report all
// variants objectively. Never auto-select a winner. This exists because the
// diagnostics showed the decision-relevant sensitivities are NOT strictness:
// costs, entry placement and target realism.
// ---------------------------------------------------------------------------

export type CompareDimension = "strictness" | "expiry" | "sessions" | "entry" | "be" | "obInvalidation" | "obDisplacement";

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

const dimRow = (label: string, description: string, r: BacktestResult): DimensionRow => ({
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
});

export async function compareDimension(
  opts: {
    symbol: SymbolKey;
    interval: IntervalKey;
    bars?: number;
    config?: Partial<EngineConfig>;
    includeSilverForSmt?: boolean;
  },
  dimension: CompareDimension
): Promise<DimensionComparison> {
  const run = (label: string, description: string, over: Partial<EngineConfig>) =>
    runBacktest({ ...opts, config: { ...opts.config, ...over } }).then((r) => dimRow(label, description, r));

  if (dimension === "expiry") {
    const rows = await Promise.all([
      run("6-bar expiry", "pending limits live 6 bars", { orderExpiryBars: 6 }),
      run("12-bar expiry", "pending limits live 12 bars (current default)", { orderExpiryBars: 12 }),
      run("24-bar expiry", "pending limits live 24 bars", { orderExpiryBars: 24 }),
    ]);
    return { dimension, rows };
  }
  if (dimension === "sessions") {
    const rows = await Promise.all([
      run("All sessions", "every session allowed (kill zone = score confluence only)", { sessions: [] }),
      run("Kill zones only", "asia + london + ny-am + ny-pm allowed", { sessions: ["asia", "london", "ny-am", "ny-pm"] }),
    ]);
    return { dimension, rows };
  }
  if (dimension === "entry") {
    const rows = await Promise.all([
      run("Edge + strict", "limit at the proximal edge, no tolerance (honest-touch baseline)", { entryAnchor: "edge", entryToleranceR: 0 }),
      run("Edge + 0.05R tolerance", "marketable last-look within 0.05R of the edge limit (current default)", { entryAnchor: "edge", entryToleranceR: 0.05 }),
      run("Midpoint + strict", "limit at the zone midpoint — deeper fill, worse location", { entryAnchor: "midpoint", entryToleranceR: 0 }),
    ]);
    return { dimension, rows };
  }
  if (dimension === "be") {
    // The breakeven-rule experiment — what happens to the position after TP1.
    // Same fills in every row (BE never changes entries), so any win-rate
    // difference is pure management, not selection.
    const rows = await Promise.all([
      run("TP1 → entry (plain BE)", "stop to entry after TP1 — scratch, before costs", { beMode: "tp1" }),
      run("TP1 → entry + costs (BE+)", "stop locks the round-trip cost buffer on the remaining shares — worst case after TP1 is a small net win (current default)", { beMode: "tp1cost" }),
      run("risk1 @ +0.5R trigger", "stop to entry once prior-bar MFE reached +0.5R (also covers trades that miss TP1)", { beMode: "risk1", beTriggerR: 0.5 }),
      run("Structural", "stop to the last confirmed swing beyond entry", { beMode: "structural" }),
    ]);
    return { dimension, rows };
  }
  if (dimension === "obInvalidation") {
    // The OB definition experiment — when does a tapped order block stop
    // being tradable? Four rules, same data, reported objectively.
    const rows = await Promise.all([
      run("Close through midpoint", "a CLOSE beyond the zone midpoint kills the block (current default)", { obInvalidation: "close-mid" }),
      run("Wick through midpoint", "ANY trade beyond the midpoint kills the block (strictest)", { obInvalidation: "wick-mid" }),
      run("Close through full zone", "a CLOSE beyond the whole zone kills the block (classic strict ICT)", { obInvalidation: "close-distal" }),
      run("Wick through full zone", "ANY trade through the whole zone kills the block (loosest)", { obInvalidation: "wick-distal" }),
    ]);
    return { dimension, rows };
  }
  if (dimension === "obDisplacement") {
    // The OB creation-side experiment — invalidation rules proved to give
    // IDENTICAL trade sets (Task 12), so OB scarcity lives upstream at
    // creation. Scan the displacement threshold; more created blocks should
    // mean more Model C/D windows, at lower average zone quality.
    const rows = await Promise.all([
      run("0.8× ATR displacement", "very loose creation — any decent opposing-candle reversal qualifies", { obDisplacementFactor: 0.8 }),
      run("1.0× ATR displacement", "loose creation — body at least one average true range", { obDisplacementFactor: 1.0 }),
      run("1.2× ATR displacement", "current default — institutional displacement required", { obDisplacementFactor: 1.2 }),
      run("1.5× ATR displacement", "strict creation — only violent reversals create blocks", { obDisplacementFactor: 1.5 }),
    ]);
    return { dimension, rows };
  }
  // strictness — reuse the preset comparison, normalized to the same row shape
  const rows = (await compareStrictness(opts)).map((r) => ({
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
  return { dimension: "strictness", rows };
}
