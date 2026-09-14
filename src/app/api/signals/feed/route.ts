import { NextResponse } from "next/server";
import { generateSignals } from "@/lib/ict/signal";
import { isIntervalKey, isSymbolKey } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * GET /api/signals/feed?symbol=XAUUSD&interval=15min
 *
 * Machine-readable signal feed for the TradePilot copier bots
 * (public/tradepilot-copier.mq5 for MT5, public/tradepilot-cbot.cs
 * for cTrader). Same engine, same data, same
 * no-repaint rule as /api/signals — but shaped for machines:
 * one `signal` object (or null) plus a STABLE fingerprint the EA
 * uses for dedupe (identical scheme to the browser alert bell:
 * side|entry|stopLoss|targets...).
 *
 * Cache-Control: no-store — the EA polls every ~30s and must always
 * see the newest evaluation.
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
    const c = result.candidates[0] ?? null;

    return NextResponse.json(
      {
        symbol,
        interval,
        evaluatedAt: result.evaluatedAt,
        signal: c
          ? {
              fingerprint: [c.side, c.entry, c.stopLoss, ...c.targets].join("|"),
              side: c.side,
              entry: c.entry,
              stopLoss: c.stopLoss,
              targets: c.targets,
              grade: c.grade,
              tier: c.tier,
              confidence: c.confidence,
              killzone: c.killzone,
            }
          : null,
        note: result.note,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signal generation unavailable";
    const status = /rate limit/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
