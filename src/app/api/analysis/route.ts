import { NextResponse } from "next/server";
import { analyze } from "@/lib/ict/engine";
import { isIntervalKey, isSymbolKey } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * GET /api/analysis?symbol=XAUUSD&interval=15min
 * Full ICT analysis snapshot: structure, FVGs, order blocks, sweeps,
 * liquidity pools, dealing range and kill zone status.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "XAUUSD";
  const interval = searchParams.get("interval") ?? "15min";

  if (!isSymbolKey(symbol)) {
    return NextResponse.json({ error: "Unknown symbol" }, { status: 400 });
  }
  if (!isIntervalKey(interval)) {
    return NextResponse.json({ error: "Unknown interval" }, { status: 400 });
  }

  try {
    const { snapshot, htfTrend } = await analyze(symbol, interval);
    return NextResponse.json(
      { ...snapshot, htfTrend },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis unavailable";
    const status = /rate limit/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
