// Engine v2 — walk-forward backtester orchestrator.
//
// Bias controls (verified by the self-test suite, spec #36):
//  - NO look-ahead: setups decided on bar close i; orders fill from i+1;
//    HTF bias uses only CLOSED HTF candles; swings used only when confirmed.
//  - Same-candle SL/TP ambiguity: pessimistic by default (stop first),
//    optional optimistic / seeded-random / lower-timeframe resolution.
//  - Costs separated: spread + slippage + commission, attributed per leg.
//  - Results reported in net R against the INITIAL risk of each trade.
import "server-only";
import { getCandles } from "@/lib/market";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import {
  DEFAULT_CONFIG,
  buildSeriesContext,
  buildSetupAt,
  type CooldownState,
  type EngineConfig,
  type SeriesContext,
} from "./sequence";
import { simulateTrade, type ExecuteConfig } from "./execution";
import { computeMetrics, lossReasonTable, mfeMaeAnalysis, robustnessFlags, buildReport, funnelRows, sessionStats, scoreBucketStats, type BacktestReport, type FunnelRow, type LossReasonRow, type MfeMaeAnalysis, type RobustnessFlags, type SessionStat, type ScoreBucketStat, type ManagementRates } from "./diagnostics";
import { runMonteCarlo, type MonteCarloResult } from "./montecarlo";
import { walkForward, type WalkForwardResult } from "./walkforward";
import { smtSeries, type SmtEvent } from "./smtseries";
import { DEFAULT_COSTS, describeCosts } from "./costs";
import type { TradeRecord } from "./types";
import type { Candle } from "@/lib/market/types";

export interface BacktestResult {
  symbol: SymbolKey;
  interval: IntervalKey;
  bars: number;
  from: number;
  to: number;
  source: string;
  metrics: ReturnType<typeof computeMetrics>;
  equityCurve: { time: number; r: number }[];
  trades: TradeRecord[];
  funnel: FunnelRow[];
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
}

/** Public entry — fetches data then runs the pure core. */
export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  const { symbol, interval } = opts;
  const bars = Math.min(Math.max(opts.bars ?? 1500, 400), 5000);
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config };
  if (!cfg.costs.XAUUSD) cfg.costs = { ...DEFAULT_COSTS };

  const { candles, source } = await getCandles(symbol, interval, bars);
  if (candles.length < 150) throw new Error("Not enough historical candles for a backtest");

  // silver for SMT confirmation (optional — simulated silver is labelled)
  let silver: Candle[] = [];
  let silverSource = "unavailable";
  if (opts.includeSilverForSmt !== false) {
    try {
      const res = await getCandles("XAGUSD", interval, Math.min(bars, 5000));
      silver = res.candles;
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

  const core = runBacktestCore(symbol, interval, candles, smtEvents, cfg, source, silverSource, ltfCandles, ltfSeconds);
  return core;
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
  ltfSeconds?: number
): BacktestResult {
  const ctx: SeriesContext = buildSeriesContext(symbol, interval, candles, smtEvents);
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
    // cooldown gates (spec #17)
    if (i - cooldown.lastSignalIndex < cfg.minBarsBetweenSignals) {
      i++;
      continue;
    }
    cooldown.lastSignalIndex = i;
    cooldown.usedSweepKeys.add(setup.sweepKey);
    ctx.funnel.ordersPlaced++;

    const res = simulateTrade(candles, setup, execute, symbol, interval, executeOpts);
    if (res.filled && res.trade) {
      trades.push(res.trade);
      ctx.funnel.ordersFilled++;
      ctx.funnel.tradesClosed++;
      if (res.trade.netR < 0 && cfg.sameZoneCooldown) {
        cooldown.blacklistedZones.add(res.trade.zoneId);
      }
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

  const notes = [
    "Sequence-verified setups only: HTF bias → discount/premium → sweep+rejection → displacement → MSS/BOS → fresh FVG/OB → retracement entry. NO TRADE is a first-class outcome.",
    "Stops and targets are STRUCTURAL (sweep extremes, protected swings, liquidity pools, PDH/PDL, PWH/PWL, session and external range liquidity) — never fixed R multiples. Trades below the minimum RR are rejected.",
    "Accounting: R is measured against each trade's INITIAL stop. Partial exits are share-weighted legs. Breakeven moves take effect the bar after activation.",
    `Costs model — ${symbol}: ${describeCosts(cfg.costs[symbol] ?? DEFAULT_COSTS[symbol])}. Gross R and cost R are reported separately.`,
    `Same-candle SL/TP ambiguity: ${cfg.ambiguity} model. Pessimistic assumes the stop fills first.`,
    `Sessions traded: ${cfg.sessions.length ? cfg.sessions.join(", ") : "any"}. Volatility blocks: ${cfg.blockedVolRegimes.join(", ") || "none"}. UNCLEAR market regime → NO TRADE.`,
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
    metrics,
    equityCurve,
    trades,
    funnel: funnelRows(ctx.funnel),
    lossReasons: lossReasonTable(trades),
    mfeMae: mfeMaeAnalysis(trades),
    sessions: sessionStats(trades),
    scoreBuckets: scoreBucketStats(trades),
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
      partialShares: [...cfg.partialShares],
      maxHoldBars: cfg.maxHoldBars,
      tierThresholds: { aPlus: cfg.tierAPlus, a: cfg.tierA, b: cfg.tierB },
    },
    notes,
  };
}

// local re-implementation to avoid circular import with diagnostics
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
