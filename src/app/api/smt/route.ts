import { NextResponse } from "next/server";
import { computeSmt } from "@/lib/ict/smt";
import { isIntervalKey } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * GET /api/smt?interval=15min
 * XAU/XAG Smart Money Technique divergence scan.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const interval = searchParams.get("interval") ?? "15min";

  if (!isIntervalKey(interval)) {
    return NextResponse.json({ error: "Unknown interval" }, { status: 400 });
  }

  try {
    const result = await computeSmt(interval);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=120" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMT scan unavailable";
    const status = /rate limit/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
