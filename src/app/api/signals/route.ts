import { NextResponse } from "next/server";
import { generateSignals } from "@/lib/ict/signal";
import { isIntervalKey, isSymbolKey } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * GET /api/signals?symbol=XAUUSD&interval=15min
 * Rule-based live signal candidates with transparent confidence scoring.
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
    const result = await generateSignals({ symbol, interval });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signal generation unavailable";
    const status = /rate limit/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
