import { NextResponse } from "next/server";
import { runBacktest, compareStrictness, compareDimension, type StrictnessComparisonRow, type CompareDimension } from "@/lib/ict/backtest";
import { parseCsvCandles, intervalSecondsOfKey, type CsvParseSummary } from "@/lib/market/csv";
import { isIntervalKey } from "@/lib/market";
import { parseBacktestParams } from "../params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/backtest/csv — engine v3 on UPLOADED history.
 *
 * The candle file is sent as JSON body `{ csv: "..." }` (plus optional
 * `tradeDetail` for on-demand deep trade payloads); every engine knob rides
 * in the query string exactly like GET /api/backtest, except:
 *   - `interval`   — optional; defaults to AUTO-DETECTED candle spacing
 *   - `bars`       — optional; defaults to the FULL uploaded window
 *
 * Data provenance is first-class: the response echoes the parser report
 * (rows parsed/skipped, detected timeframe, coverage range, warnings) and
 * the result's `source` reads "CSV". SMT confluence is deliberately disabled
 * — pairing an uploaded series with a live API companion would fabricate
 * divergences across different feeds.
 *
 * The client pre-parses the same file for an upload preview, but the server
 * re-parses authoritatively so the UI can never claim more history than the
 * file actually contains.
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = parseBacktestParams(searchParams, { requireBars: false, requireInterval: false });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const {
    symbol, strictness, compare, compareDim, sensitivity: sensitivityParam,
    smtOff: smtOffParam, tradeDetail: tradeDetailParam, buildConfig,
  } = parsed.params;

  let body: { csv?: unknown; tradeDetail?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body — expected { csv: string }" }, { status: 400 });
  }
  if (typeof body.csv !== "string" || body.csv.trim().length === 0) {
    return NextResponse.json({ error: "Missing CSV content — send { csv: string }" }, { status: 400 });
  }
  // ~40 MB guard: beyond any sane candle file (25k bars ≈ 2 MB)
  if (body.csv.length > 40_000_000) {
    return NextResponse.json({ error: "CSV too large (40 MB limit)" }, { status: 413 });
  }

  try {
    const { candles: allCandles, summary } = parseCsvCandles(body.csv);
    if (allCandles.length === 0) {
      return NextResponse.json(
        { error: "No parseable candles in the uploaded file", csvSummary: summary },
        { status: 400 }
      );
    }

    // engine cap: keep the most recent 25,000 candles of a longer file
    const CAP = 25000;
    let candles = allCandles;
    if (allCandles.length > CAP) {
      candles = allCandles.slice(-CAP);
      summary.warnings.push(`Using the most recent ${CAP} of ${allCandles.length} candles.`);
    }

    // interval: explicit param wins, otherwise the detected spacing
    let interval = parsed.params.interval;
    if (!isIntervalKey(interval)) {
      interval = summary.detectedInterval ?? "15min";
    }
    // guard: a manual interval wildly off the file's spacing mislabels every
    // session/gap diagnostic — snap back to the detected one
    if (
      summary.detectedSeconds !== null &&
      Math.abs(Math.log(intervalSecondsOfKey(interval) / summary.detectedSeconds)) > 0.4
    ) {
      summary.warnings.push(
        `Requested timeframe ignored — candles are spaced ~${Math.round(summary.detectedSeconds / 60)} min apart; running at the detected ${interval} timeframe.`
      );
      interval = summary.detectedInterval ?? interval;
    }

    const bars = candles.length;
    const runOpts = {
      symbol, interval, bars, strictness,
      config: buildConfig(),
      includeCompanion: !smtOffParam,
      csvCandles: candles,
      csvSummary: summary as CsvParseSummary,
    };

    const result = await runBacktest(runOpts);

    if (typeof tradeDetailParam === "string" && tradeDetailParam) {
      const trade = result.trades.find((t) => t.id === tradeDetailParam) ?? null;
      return NextResponse.json({ trade }, { headers: { "Cache-Control": "private, max-age=300" } });
    }

    // same compact ceiling as the GET route: deep windows ship without
    // audit/confluence text; a trade's detail loads on demand via tradeDetail
    let payload: object = result;
    const compact = !parsed.params.trim && bars > 5000;
    if (parsed.params.trim) {
      const { trades, rejectedSamples, ...rest } = result;
      payload = { ...rest, tradeCount: trades.length, rejectedSamples: [], trimmed: true };
    } else if (compact) {
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
          rr === parsed.params.minRR
            ? result
            : await runBacktest({ ...runOpts, config: buildConfig({ minRR: rr, targetHorizonR: parsed.params.horizon }) });
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

    // one-dimension comparison on the uploaded window
    let comparison: StrictnessComparisonRow[] | undefined;
    let dimensionComparison: Awaited<ReturnType<typeof compareDimension>> | undefined;
    if (compare) {
      const dim = compareDim as CompareDimension;
      dimensionComparison = await compareDimension(
        { symbol, interval, bars, config: buildConfig(), csvCandles: candles },
        dim
      );
      if (dim === "strictness") {
        comparison = await compareStrictness({ symbol, interval, bars, config: buildConfig(), csvCandles: candles });
      }
    }

    return NextResponse.json(
      { ...payload, csvSummary: summary, sensitivity, comparison, dimensionComparison },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "CSV backtest failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
