import { NextResponse } from "next/server";
import { getCandles, isIntervalKey, isSymbolKey } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/candles?symbol=XAUUSD&interval=15min&outputsize=300
 * OHLC candles for the terminal chart. Private endpoint (robots-blocked).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "XAUUSD";
  const interval = searchParams.get("interval") ?? "15min";
  const outputsize = Number(searchParams.get("outputsize") ?? 300);

  if (!isSymbolKey(symbol)) {
    return NextResponse.json({ error: "Unknown symbol" }, { status: 400 });
  }
  if (!isIntervalKey(interval)) {
    return NextResponse.json({ error: "Unknown interval" }, { status: 400 });
  }
  if (!Number.isFinite(outputsize) || outputsize <= 0) {
    return NextResponse.json({ error: "outputsize must be a positive number" }, { status: 400 });
  }

  try {
    const result = await getCandles(symbol, interval, outputsize);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Market data unavailable";
    const status = /rate limit/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
