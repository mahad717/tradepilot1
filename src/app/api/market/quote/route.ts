import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/quote — latest quotes for all tracked symbols.
 */
export async function GET() {
  try {
    const quotes = await getQuotes();
    return NextResponse.json({ quotes, timestamp: Date.now() }, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quotes unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
