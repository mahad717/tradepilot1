import { NextResponse } from "next/server";
import { runBacktest, compareStrictness, compareDimension, debugCorePhases, type StrictnessComparisonRow, type CompareDimension } from "@/lib/ict/backtest";
import { getDb, DbUnavailableError } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { getCandles, getCandlesDeep, getCompanionCandles, dropWeekendCandles } from "@/lib/market";
import { smtSeries } from "@/lib/ict/smtseries";
import { parseBacktestParams, DEBUG_STAGES } from "./params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
 * GET /api/backtest — engine v3 on TwelveData/simulated market history.
 * Params: symbol, interval, bars, minRR, beMode (off|tp1|tp1cost|risk1|structural), ambiguity, sessions,
 *         strictness (conservative|balanced|aggressive), compare (0|1),
 *         compareDim, entryAnchor, entryTolerance, costGate, horizon,
 *         obInvalidation, obDisp, tierB,
 *         spread/slip/commBp (optional per-run cost-model overrides),
 *         sensitivity (comma list of minRR variants for stability comparison)
 * Uploaded-CSV runs use POST /api/backtest/csv instead — same params, no
 * interval/bars (detected from the file), CSV content in the POST body.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = parseBacktestParams(searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const {
    symbol, interval, bars, minRR, strictness, compare, compareDim, sensitivity: sensitivityParam,
    stage: stageParam, trim: trimParam, smtOff: smtOffParam, compact: compactParam,
    tradeDetail: tradeDetailParam, buildConfig,
  } = parsed.params;

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
      const ct0 = performance.now();
      const companion = fetchRes.source === "LIVE" ? await getCompanionCandles(symbol, interval, bars) : null;
      const cc = companion && !companion.error ? dropWeekendCandles(companion.candles).candles : [];
      const st0 = performance.now();
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
      const t0 = performance.now();
      if (searchParams.get("dbg") === "1") {
        // phase-by-phase timings on the real window (small payload) — used to
        // localize deep-window Worker CPU exhaustion
        const fetchRes2 = bars > 5000
          ? await getCandlesDeep(symbol, interval, bars)
          : await getCandles(symbol, interval, bars);
        const candles2 = dropWeekendCandles(fetchRes2.candles).candles;
        const phase = searchParams.get("phase");
        const stopAfter = phase === "ctx" || phase === "scan" ? phase : undefined;
        const timings = debugCorePhases(symbol, interval, candles2, [], buildConfig(), strictness, stopAfter);
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

    const result = await runBacktest({ symbol, interval, bars, strictness, config: buildConfig(), includeCompanion: !smtOffParam });

    let payload: object = result;
    if (tradeDetailParam) {
      const trade = result.trades.find((t) => t.id === tradeDetailParam) ?? null;
      return NextResponse.json({ trade }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    if (trimParam) {
      const { trades, rejectedSamples, ...rest } = result;
      payload = {
        ...rest,
        tradeCount: trades.length,
        rejectedSamples: [],
        trimmed: true,
      };
    } else if (compactParam) {
      const trades = result.trades.map((t) => ({
        ...t,
        audit: [],
        confluence: undefined,
        rationale: [],
      }));
      payload = { ...result, trades, rejectedSamples: [], compact: true };
    }

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
            : await runBacktest({ symbol, interval, bars, strictness, config: buildConfig({ minRR: rr, targetHorizonR: parsed.params.horizon }) });
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
      const dim = compareDim as CompareDimension;
      dimensionComparison = await compareDimension(
        { symbol, interval, bars, config: buildConfig() },
        dim
      );
      if (dim === "strictness") {
        comparison = await compareStrictness({ symbol, interval, bars, config: buildConfig() });
      }
    }

    return NextResponse.json(
      trimParam ? payload : { ...payload, sensitivity, comparison, dimensionComparison },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
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
