import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/ict/backtest";
import { getAuthUser } from "@/lib/auth";
import { getDb, DbUnavailableError } from "@/lib/db";
import { isIntervalKey, isSymbolKey } from "@/lib/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BE_MODES = ["off", "tp1", "risk1", "structural"];
const AMBIGUITY_MODES = ["pessimistic", "optimistic", "randomized", "ltf"];
const SESSION_KEYS = ["asia", "london", "ny-am", "ny-pm", "london-close"];

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
 * GET /api/backtest — engine v2.
 * Params: symbol, interval, bars, minRR, beMode, ambiguity, sessions, seed,
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
  const sessionsParam = searchParams.get("sessions") ?? "london,ny-am,ny-pm";
  const sensitivityParam = searchParams.get("sensitivity") ?? "";

  if (!isSymbolKey(symbol)) {
    return NextResponse.json({ error: "Unknown symbol" }, { status: 400 });
  }
  if (!isIntervalKey(interval)) {
    return NextResponse.json({ error: "Unknown interval" }, { status: 400 });
  }
  if (!Number.isFinite(bars) || bars < 400 || bars > 5000) {
    return NextResponse.json({ error: "bars must be between 400 and 5000" }, { status: 400 });
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
  const sessions = sessionsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "any" && SESSION_KEYS.includes(s));

  try {
    const result = await runBacktest({
      symbol,
      interval,
      bars,
      config: {
        minRR,
        beMode: beMode as never,
        ambiguity: ambiguity as never,
        randomSeed: Number.isFinite(seed) ? seed : 42,
        sessions,
      },
    });

    // minRR sensitivity across periods (stability view — NOT for cherry-picking)
    let sensitivity: { minRR: number; trades: number; winRate: number; expectancyR: number; profitFactor: number; netR: number }[] | undefined;
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
            : await runBacktest({ symbol, interval, bars, config: { minRR: rr, beMode: beMode as never, ambiguity: ambiguity as never, randomSeed: Number.isFinite(seed) ? seed : 42, sessions } });
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

    return NextResponse.json({ ...result, sensitivity }, {
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
