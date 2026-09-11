import { NextResponse } from "next/server";
import { runAllTests, summarize, debugSynthetic } from "@/lib/ict/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/backtest/selftest — engine v2 validation suite (spec #36).
 * Deterministic synthetic-candle tests: partial TP accounting, breakeven
 * accounting, cost calculation, position sizing, MFE/MAE, timeout,
 * ambiguity models, truncation invariance (no look-ahead), minimum-RR gate.
 * `?debug=1` returns the per-bar rejection trace of the synthetic series.
 */
export async function GET(req: Request) {
  try {
    const debug = new URL(req.url).searchParams.get("debug");
    if (debug) {
      return NextResponse.json({ debug: debugSynthetic() }, { headers: { "Cache-Control": "no-store" } });
    }
    const results = runAllTests();
    const summary = summarize(results);
    return NextResponse.json(
      { ...summary, results },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Self-test crashed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
