// Engine v3 — walk-forward backtester orchestrator (SERVER side).
//
// Bias controls (verified by the self-test suite, spec #36):
//  - NO look-ahead: setups decided on bar close i; orders fill from i+1;
//    HTF bias uses only CLOSED HTF candles; swings used only when confirmed.
//  - Same-candle SL/TP ambiguity: pessimistic by default (stop first),
//    optional optimistic / seeded-random / lower-timeframe resolution.
//  - Costs separated: spread + slippage + commission, attributed per leg.
//  - Results reported in net R against the INITIAL risk of each trade.
//
// The PURE engine core (result types, scanner, runBacktestCore, data-quality
// audit, comparison rows, and the uploaded-CSV pipeline runCsvBacktest) lives
// in ./run-core — isomorphic, so the BROWSER can execute uploaded-CSV
// backtests locally. The Worker kills oversized single requests (25 MB CSV
// uploads parse ~480k rows + run 25k candles → HTTP 503), so CSV runs no
// longer round-trip through here at all; this module keeps the fetch-driven
// TwelveData paths and re-exports the core for every existing consumer.
import "server-only";
import { getCandles, getCandlesDeep, dropWeekendCandles, getCompanionCandles } from "@/lib/market";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import { DEFAULT_CONFIG, STRICTNESS_PRESETS, presetFor, type EngineConfig, type Strictness } from "./sequence";
import { smtSeries, type SmtEvent } from "./smtseries";
import { DEFAULT_COSTS } from "./costs";
import type { Candle } from "@/lib/market/types";
import type { CsvParseSummary } from "@/lib/market/csv";
import { intervalLabelOfKey, granularityLabel } from "@/lib/market/csv";
import {
  runBacktestCore,
  auditDataQuality,
  intervalSecondsOfCore,
  toDimensionRow,
  type BacktestResult,
  type BacktestOptions,
  type StrictnessComparisonRow,
  type DimensionRow,
  type DimensionComparison,
  type CompareDimension,
} from "./run-core";

// Re-export the whole pure core (types + functions + the CSV pipeline) so
// validate.ts, the API routes and any other server consumer keep importing
// from "@/lib/ict/backtest" unchanged.
export * from "./run-core";

/** Public entry — fetches data then runs the pure core. */
export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  const { symbol, interval } = opts;
  const bars = Math.min(Math.max(opts.bars ?? 1500, 400), 25000);
  const strictness = opts.strictness ?? "balanced";
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...presetFor(strictness), ...opts.config };
  if (!cfg.costs.XAUUSD) cfg.costs = { ...DEFAULT_COSTS };

  // CSV mode: the run is driven by an uploaded candle file — no upstream
  // fetch at all. The parser's report rides along for the response.
  const csvMode = !!opts.csvCandles && opts.csvCandles.length > 0;
  let rawCandles: Candle[];
  let sourceLabel: string;
  let upstreamRequests = 0;
  if (csvMode) {
    rawCandles = opts.csvCandles!;
    sourceLabel = "CSV";
  } else {
    // Deep windows (sample-size starvation is the #1 honest blocker) are
    // assembled from paginated ≤5000-bar chunks; standard windows use the
    // single-request path.
    const fetchRes = bars > 5000
      ? await getCandlesDeep(symbol, interval, bars)
      : await getCandles(symbol, interval, bars);
    rawCandles = fetchRes.candles;
    sourceLabel = fetchRes.source;
    upstreamRequests = (fetchRes as { requests?: number }).requests ?? 0;
  }
  // fetch accounting: deep windows can silently fall short (upstream runs
  // dry / request budget) — surface requested vs received so two runs of
  // the same selector are comparable and shortfalls are never hidden.
  // CSV runs deliver exactly the file's candles: no shortfall is possible.
  const fetch = {
    requested: csvMode ? rawCandles.length : bars,
    receivedRaw: rawCandles.length,
    requests: upstreamRequests,
    shortfallPct: csvMode || bars === 0 ? 0 : Math.max(0, Math.round(((bars - rawCandles.length) / bars) * 1000) / 10),
    deep: !csvMode && bars > 5000,
  };
  // Spot metals feeds quote ~24/7 — drop dead weekend hours so ICT session
  // logic never fires in a closed market. Counted in the data-quality audit.
  const { candles, dropped: weekendDropped } = dropWeekendCandles(rawCandles);
  if (candles.length < 150) {
    if (csvMode && opts.csvSummary) {
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
    throw new Error("Not enough historical candles for a backtest");
  }
  const dataQuality = auditDataQuality(candles, intervalSecondsOfCore(interval), weekendDropped);
  dataQuality.requestedBars = fetch.requested;
  dataQuality.rawFetched = fetch.receivedRaw;
  dataQuality.fetchRequests = fetch.requests;
  dataQuality.fetchShortfallPct = fetch.shortfallPct;
  if (csvMode && opts.csvSummary) {
    const s = opts.csvSummary;
    dataQuality.note = `Data source: uploaded CSV (${s.format}) — ${s.parsed} candles${s.detectedInterval ? ` @ ${intervalLabelOfKey(s.detectedInterval)}` : ""}, ${new Date((s.from ?? 0) * 1000).toISOString().slice(0, 10)} → ${new Date((s.to ?? 0) * 1000).toISOString().slice(0, 10)}; ${s.skipped} row${s.skipped === 1 ? "" : "s"} skipped, ${s.duplicatesRemoved} duplicate${s.duplicatesRemoved === 1 ? "" : "s"} removed. ${dataQuality.note}`;
    if (s.detectedSeconds !== null && s.detectedSeconds >= 86400) {
      dataQuality.note += ` WARNING: daily (or coarser) candles — kill zones, session liquidity and intraday FVG/OB precision cannot be observed on daily bars; treat results as a coarse approximation.`;
    }
  }
  if (fetch.deep && fetch.shortfallPct > 10) {
    dataQuality.note += ` WARNING: requested ${fetch.requested} bars but the upstream delivered only ${fetch.receivedRaw} raw (${fetch.shortfallPct}% shortfall over ${fetch.requests} chunk requests) — this window is SMALLER than the selector promises; runs are only comparable at equal received bars.`;
  }

  // SMT companion (optional): the correlated second series SMT compares
  // against. Live companion → real divergence confluence; unavailable → SMT
  // score bonus is silently absent, which the run now states explicitly.
  // CSV runs deliberately go WITHOUT a companion: mixing an uploaded series
  // with a live API feed would fabricate divergences across different sources.
  const companion = opts.includeCompanion === false || sourceLabel !== "LIVE"
    ? null
    : await getCompanionCandles(symbol, interval, bars);
  const companionFailed = !!companion?.error;
  const companionCandles = companion && !companion.error ? dropWeekendCandles(companion.candles).candles : [];
  const smtEvents: SmtEvent[] = companionCandles.length > 40 ? smtSeries(candles, companionCandles) : [];
  const companionTimeSet = new Set(companionCandles.map((c) => c.time));
  const smtCoveragePct = companion && !companion.error
    ? Math.round((candles.filter((c) => companionTimeSet.has(c.time)).length / Math.max(1, candles.length)) * 1000) / 10
    : null;
  const smt = {
    companion: companion && !companion.error ? companion.label : null,
    source: companion && !companion.error ? companion.source : (csvMode ? "disabled (uploaded CSV)" : sourceLabel !== "LIVE" ? "unavailable (simulated base series)" : "unavailable"),
    events: smtEvents.length,
    coveragePct: smtCoveragePct,
    note: companionFailed
      ? `SMT companion fetch failed (${companion!.error}) — SMT confluence contributes nothing on this run. This is often a transient credit/rate limit; retry shortly.`
      : csvMode
        ? "Data source is an uploaded CSV — SMT confluence is disabled. Pairing an uploaded series with a live API companion would fabricate divergences across different feeds."
        : companion?.note ?? (sourceLabel !== "LIVE"
          ? "The traded series is simulated — pairing it with a live companion would fabricate divergences, so SMT is disabled on this run."
          : "No SMT companion was fetchable — SMT confluence contributes nothing on this run."),
  };
  if (smtCoveragePct !== null && smtCoveragePct < 60) {
    smt.note += ` WARNING: companion data covers only ${smtCoveragePct}% of the traded window (upstream returned a partial series) — divergence confluence was judged on the covered part only; runs at different coverage are not comparable.`;
  }

  // lower-timeframe data for the "ltf" candle-ambiguity model (spec #29)
  let ltfCandles: Candle[] | undefined;
  let ltfSeconds: number | undefined;
  if (cfg.ambiguity === "ltf" && interval === "15min" && !csvMode) {
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
  const result = runBacktestCore(symbol, interval, candles, smtEvents, cfg, sourceLabel, silverSource, ltfCandles, ltfSeconds, strictness, dataQuality);
  result.fetch = fetch; // caller-side accounting overrides the core default
  result.smt = smt;
  if (csvMode) result.csvSummary = opts.csvSummary;
  return result;
}

// ---------------------------------------------------------------------------
// Strictness comparison (spec §16, §17) — run the SAME data through the three
// presets and report all three objectively. Never auto-select a winner.
// ---------------------------------------------------------------------------

export async function compareStrictness(
  opts: {
    symbol: SymbolKey;
    interval: IntervalKey;
    bars?: number;
    config?: Partial<EngineConfig>;
    includeSilverForSmt?: boolean;
    csvCandles?: Candle[];
    csvSummary?: CsvParseSummary;
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

export async function compareDimension(
  opts: {
    symbol: SymbolKey;
    interval: IntervalKey;
    bars?: number;
    config?: Partial<EngineConfig>;
    includeSilverForSmt?: boolean;
    csvCandles?: Candle[];
    csvSummary?: CsvParseSummary;
  },
  dimension: CompareDimension
): Promise<DimensionComparison> {
  const run = (label: string, description: string, over: Partial<EngineConfig>) =>
    runBacktest({ ...opts, config: { ...opts.config, ...over } }).then((r) => toDimensionRow(label, description, r));

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
