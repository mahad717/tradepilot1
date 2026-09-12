import { NextResponse } from "next/server";
import { runBacktest, compareStrictness, compareDimension, debugCorePhases, type StrictnessComparisonRow, type CompareDimension } from "@/lib/ict/backtest";
import type { Strictness } from "@/lib/ict/sequence";
import type { EngineConfig } from "@/lib/ict/sequence";
import { DEFAULT_COSTS } from "@/lib/ict/costs";
import { getAuthUser } from "@/lib/auth";
import { getDb, DbUnavailableError } from "@/lib/db";
import { isIntervalKey, isSymbolKey, getCandles, getCandlesDeep, getCompanionCandles, dropWeekendCandles } from "@/lib/market";
import { smtSeries } from "@/lib/ict/smtseries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BE_MODES = ["off", "tp1", "tp1cost", "risk1", "structural"];
const AMBIGUITY_MODES = ["pessimistic", "optimistic", "randomized", "ltf"];
const SESSION_KEYS = ["asia", "london", "ny-am", "ny-pm", "london-close"];
const STRICTNESS_LEVELS = ["conservative", "balanced", "aggressive"];
const COMPARE_DIMENSIONS = ["strictness", "expiry", "sessions", "entry", "be", "obInvalidation", "obDisplacement"];
const OB_INVALIDATION_MODES = ["close-mid", "wick-mid", "close-distal", "wick-distal"];
const DEBUG_STAGES = ["fetch", "smt", "core"];

/**
 * Persistence features need a database (D1 on Cloudflare, SQLite locally).
 */
async function resolveDb() {
  try {
    return { db: await getDb(), unavailable: null as DbUnavailableError | null };
  } catch (err) {
    if (err instanceof DbUnavailableError) return { db: null, unavailable: err };
    throw err;
  }
}

/**
 * GET /api/backtest — engine v3.
 * Params: symbol, interval, bars, minRR, beMode (off|tp1|tp1cost|risk1|structural), ambiguity, sessions,
 *         strictness (conservative|balanced|aggressive), compare (0|1),
 *         compareDim, entryAnchor, entryTolerance, costGate, horizon,
 *         obInvalidation, obDisp, tierB,
 *         spread/slip/commBp (optional per-run cost-model overrides),
 *         sensitivity (comma list of minRR variants for stability comparison)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "XAUUSD";
  const interval = searchParams.get("interval") ?? "15min";
  const bars = Number(searchParams.get("bars") ?? 1500);
  const minRR = Number(searchParams.get("minRR") ?? 2.0);
  const beMode = searchParams.get("beMode") ?? "tp1";
  const ambiguity = searchParams.get("ambiguity") ?? "pessimistic";
  const seed = Number(searchParams.get("seed") ?? 42);
  const sessionsParam = searchParams.get("sessions") ?? "";
  const strictnessParam = searchParams.get("strictness") ?? "balanced";
  const entryAnchorParam = searchParams.get("entryAnchor") ?? "edge";
  const entryToleranceParam = Number(searchParams.get("entryTolerance") ?? "0.05");
  const costGateParam = Number(searchParams.get("costGate") ?? "0.35");
  const horizonParam = Number(searchParams.get("horizon") ?? "8");
  const obInvalidationParam = searchParams.get("obInvalidation") ?? "close-mid";
  const obDispParam = Number(searchParams.get("obDisp") ?? "1.2");
  const tierBParam = Number(searchParams.get("tierB") ?? "70");
  // editable cost model (per run): empty/absent params keep the symbol defaults
  const spreadParam = searchParams.get("spread");
  const slipParam = searchParams.get("slip");
  const commBpParam = searchParams.get("commBp");
  const compare = searchParams.get("compare") === "1";
  const compareDimParam = searchParams.get("compareDim") ?? "strictness";
  const sensitivityParam = searchParams.get("sensitivity") ?? "";
  // debug: run the deep pipeline stage by stage (fetch → smt → core) so a
  // resource-limit failure can be localized from the outside
  const stageParam = searchParams.get("stage") ?? "";

  if (!isSymbolKey(symbol)) {
    return NextResponse.json({ error: "Unknown symbol" }, { status: 400 });
  }
  if (!isIntervalKey(interval)) {
    return NextResponse.json({ error: "Unknown interval" }, { status: 400 });
  }
  if (!Number.isFinite(bars) || bars < 400 || bars > 25000) {
    return NextResponse.json({ error: "bars must be between 400 and 25000 (windows above 5000 are assembled from paginated chunks)" }, { status: 400 });
  }
  if (!Number.isFinite(minRR) || minRR < 0.5 || minRR > 10) {
    return NextResponse.json({ error: "minRR must be between 0.5 and 10" }, { status: 400 });
  }
  if (!BE_MODES.includes(beMode)) {
    return NextResponse.json({ error: "Unknown beMode" }, { status: 400 });
  }
  if (!AMBIGUITY_MODES.includes(ambiguity)) {
    return NextResponse.json({ error: "Unknown ambiguity model" }, { status: 400 });
  }
  if (!STRICTNESS_LEVELS.includes(strictnessParam)) {
    return NextResponse.json({ error: "Unknown strictness preset" }, { status: 400 });
  }
  if (!COMPARE_DIMENSIONS.includes(compareDimParam)) {
    return NextResponse.json({ error: "Unknown compareDim (strictness|expiry|sessions|entry|be|obInvalidation)" }, { status: 400 });
  }
  if (!OB_INVALIDATION_MODES.includes(obInvalidationParam)) {
    return NextResponse.json({ error: "obInvalidation must be close-mid|wick-mid|close-distal|wick-distal" }, { status: 400 });
  }
  if (!Number.isFinite(obDispParam) || obDispParam < 0.5 || obDispParam > 3) {
    return NextResponse.json({ error: "obDisp must be between 0.5 and 3 (ATR multiples for OB creation)" }, { status: 400 });
  }
  if (spreadParam !== null && (!Number.isFinite(Number(spreadParam)) || Number(spreadParam) < 0 || Number(spreadParam) > 10)) {
    return NextResponse.json({ error: "spread must be between 0 and 10 (price units)" }, { status: 400 });
  }
  if (slipParam !== null && (!Number.isFinite(Number(slipParam)) || Number(slipParam) < 0 || Number(slipParam) > 5)) {
    return NextResponse.json({ error: "slip must be between 0 and 5 (price units per side)" }, { status: 400 });
  }
  if (commBpParam !== null && (!Number.isFinite(Number(commBpParam)) || Number(commBpParam) < 0 || Number(commBpParam) > 20)) {
    return NextResponse.json({ error: "commBp must be between 0 and 20 (basis points per side)" }, { status: 400 });
  }
  if (!Number.isFinite(tierBParam) || tierBParam < 60 || tierBParam > 90) {
    return NextResponse.json({ error: "tierB must be between 60 and 90" }, { status: 400 });
  }
  if (entryAnchorParam !== "edge" && entryAnchorParam !== "midpoint") {
    return NextResponse.json({ error: "entryAnchor must be edge|midpoint" }, { status: 400 });
  }
  if (!Number.isFinite(entryToleranceParam) || entryToleranceParam < 0 || entryToleranceParam > 0.5) {
    return NextResponse.json({ error: "entryTolerance must be between 0 and 0.5" }, { status: 400 });
  }
  if (!Number.isFinite(costGateParam) || costGateParam < 0 || costGateParam > 2) {
    return NextResponse.json({ error: "costGate must be between 0 (off) and 2" }, { status: 400 });
  }
  if (!Number.isFinite(horizonParam) || horizonParam < 0 || horizonParam > 50) {
    return NextResponse.json({ error: "horizon must be between 0 (off) and 50" }, { status: 400 });
  }
  const strictness = strictnessParam as Strictness;
  const sessions = sessionsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "any" && SESSION_KEYS.includes(s));

  // one config builder — every run in this request (main, sensitivity,
  // comparisons) MUST share identical knobs so rows are comparable
  const buildConfig = (over: Partial<EngineConfig> = {}): Partial<EngineConfig> => {
    const cfg: Partial<EngineConfig> = {
      minRR,
      beMode: beMode as never,
      ambiguity: ambiguity as never,
      randomSeed: Number.isFinite(seed) ? seed : 42,
      sessions,
      entryAnchor: entryAnchorParam as never,
      entryToleranceR: entryToleranceParam,
      maxCostPctOfR: costGateParam,
      targetHorizonR: horizonParam,
      obInvalidation: obInvalidationParam as never,
      obDisplacementFactor: obDispParam,
      tierB: tierBParam,
      ...over,
    };
    if (spreadParam !== null || slipParam !== null || commBpParam !== null) {
      const base = DEFAULT_COSTS[symbol as keyof typeof DEFAULT_COSTS];
      cfg.costs = {
        ...DEFAULT_COSTS,
        [symbol]: {
          spread: spreadParam !== null ? Number(spreadParam) : base?.spread ?? 0,
          slippagePerSide: slipParam !== null ? Number(slipParam) : base?.slippagePerSide ?? 0,
          commissionPctPerSide: commBpParam !== null ? Number(commBpParam) / 1e4 : base?.commissionPctPerSide ?? 0,
        },
      } as never;
    }
    return cfg;
  };

  try {
    if (DEBUG_STAGES.includes(stageParam)) {
      const t0 = Date.now();
      const fetchRes = bars > 5000
        ? await getCandlesDeep(symbol, interval, bars)
        : await getCandles(symbol, interval, bars);
      const { candles } = dropWeekendCandles(fetchRes.candles);
      if (stageParam === "fetch") {
        return NextResponse.json({
          stage: "fetch", bars: candles.length, raw: fetchRes.candles.length,
          requests: (fetchRes as { requests?: number }).requests ?? 0,
          source: fetchRes.source, timings: { fetchMs: Date.now() - t0 },
        });
      }
      const ct0 = Date.now();
      const companion = fetchRes.source === "LIVE" ? await getCompanionCandles(symbol, interval, bars) : null;
      const cc = companion && !companion.error ? dropWeekendCandles(companion.candles).candles : [];
      const st0 = Date.now();
      const events = cc.length > 40 ? smtSeries(candles, cc) : [];
      if (stageParam === "smt") {
        return NextResponse.json({
          stage: "smt", bars: candles.length, companionBars: cc.length, events: events.length,
          companionError: companion?.error ?? null,
          timings: { fetchMs: Date.now() - t0, companionMs: Date.now() - ct0, smtSeriesMs: Date.now() - st0 },
        });
      }
    }
    if (stageParam === "core") {
      const t0 = Date.now();
      if (searchParams.get("dbg") === "1") {
        // phase-by-phase timings on the real window (small payload) — used to
        // localize deep-window Worker CPU exhaustion
        const fetchRes2 = bars > 5000
          ? await getCandlesDeep(symbol, interval, bars)
          : await getCandles(symbol, interval, bars);
        const candles2 = dropWeekendCandles(fetchRes2.candles).candles;
        const timings = debugCorePhases(symbol, interval, candles2, [], buildConfig(), strictness);
        return NextResponse.json({ stage: "core-dbg", bars: candles2.length, timings });
      }
      const result = await runBacktest({ symbol, interval, bars, strictness, config: buildConfig() });
      const c0 = Date.now();
      const payload = JSON.stringify(result);
      const stringifyMs = Date.now() - c0;
      return NextResponse.json({
        stage: "core", metrics: result.metrics, fetch: result.fetch,
        counts: { trades: result.trades.length, rejectedSamples: result.rejectedSamples.length, rejections: result.rejections.length },
        payloadBytes: payload.length,
        timings: { totalMs: Date.now() - t0, stringifyMs },
      });
    }

    const result = await runBacktest({
      symbol,
      interval,
      bars,
      strictness,
      config: buildConfig(),
    });

    // minRR sensitivity across periods (stability view — NOT for cherry-picking)
    let sensitivity: { minRR: number; trades: number; winRate: number | null; expectancyR: number | null; profitFactor: number | null; netR: number }[] | undefined;
    const minRRs = sensitivityParam
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x >= 0.5 && x <= 10);
    if (minRRs.length > 1 && minRRs.length <= 6) {
      sensitivity = [];
      for (const rr of minRRs) {
        const r =
          rr === minRR
            ? result
            : await runBacktest({ symbol, interval, bars, strictness, config: buildConfig({ minRR: rr, targetHorizonR: horizonParam }) });
        sensitivity.push({
          minRR: rr,
          trades: r.metrics.trades,
          winRate: r.metrics.winRate,
          expectancyR: r.metrics.expectancyR,
          profitFactor: r.metrics.profitFactor,
          netR: r.metrics.netR,
        });
      }
    }

    // Comparison across ONE dimension (spec §16, §17 extended): strictness
    // presets, pending-order expiry, session filter, entry placement, or the
    // two sides of the OB definition (invalidation rule / creation threshold).
    let comparison: StrictnessComparisonRow[] | undefined;
    let dimensionComparison: Awaited<ReturnType<typeof compareDimension>> | undefined;
    if (compare) {
      const dim = compareDimParam as CompareDimension;
      dimensionComparison = await compareDimension(
        { symbol, interval, bars, config: buildConfig() },
        dim
      );
      if (dim === "strictness") {
        comparison = await compareStrictness({ symbol, interval, bars, config: buildConfig() });
      }
    }

    return NextResponse.json({ ...result, sensitivity, comparison, dimensionComparison }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backtest failed";
    const status = /rate limit/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

/** POST /api/backtest — persist a completed backtest run for the signed-in user. */
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db, unavailable } = await resolveDb();
  if (!db) return NextResponse.json({ error: unavailable!.message }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { symbol, interval, bars, from, to, metrics, params } = body as Record<string, unknown>;
  if (
    typeof symbol !== "string" ||
    typeof interval !== "string" ||
    typeof metrics !== "object" ||
    metrics === null
  ) {
    return NextResponse.json({ error: "Invalid backtest payload" }, { status: 400 });
  }

  const created = await db.backtestRun.create({
    data: {
      userId: user.id,
      email: user.email ?? null,
      symbol,
      interval,
      bars: typeof bars === "number" ? bars : 0,
      fromAt: typeof from === "number" ? new Date(from * 1000) : null,
      toAt: typeof to === "number" ? new Date(to * 1000) : null,
      params: JSON.stringify(params ?? {}),
      metrics: JSON.stringify(metrics),
    },
  });

  return NextResponse.json({ run: created }, { status: 201 });
}
