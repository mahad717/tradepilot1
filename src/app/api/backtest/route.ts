import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/ict/backtest";
import { getAuthUser } from "@/lib/auth";
import { getDb, DbUnavailableError } from "@/lib/db";
import { isIntervalKey, isSymbolKey } from "@/lib/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Persistence features need a database (D1 on Cloudflare, SQLite locally).
 * Resolves to a ready-to-use 503 response when no database is configured.
 */
async function resolveDb() {
  try {
    return { db: await getDb(), unavailable: null as DbUnavailableError | null };
  } catch (err) {
    if (err instanceof DbUnavailableError) return { db: null, unavailable: err };
    throw err;
  }
}

/** GET /api/backtest?symbol=XAUUSD&interval=1h&bars=1500 — run a walk-forward backtest. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "XAUUSD";
  const interval = searchParams.get("interval") ?? "1h";
  const bars = Number(searchParams.get("bars") ?? 1500);

  if (!isSymbolKey(symbol)) {
    return NextResponse.json({ error: "Unknown symbol" }, { status: 400 });
  }
  if (!isIntervalKey(interval)) {
    return NextResponse.json({ error: "Unknown interval" }, { status: 400 });
  }
  if (!Number.isFinite(bars) || bars < 400 || bars > 5000) {
    return NextResponse.json({ error: "bars must be between 400 and 5000" }, { status: 400 });
  }

  try {
    const result = await runBacktest({ symbol, interval, bars });
    return NextResponse.json(result, {
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
