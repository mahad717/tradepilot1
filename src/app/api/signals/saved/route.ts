import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getDb, DbUnavailableError } from "@/lib/db";

export const dynamic = "force-dynamic";

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

/** GET /api/signals/saved — list the authenticated user's saved signals. */
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db, unavailable } = await resolveDb();
  if (!db) return NextResponse.json({ error: unavailable!.message }, { status: 503 });

  const saved = await db.savedSignal.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ signals: saved });
}

/** POST /api/signals/saved — save a signal candidate for the signed-in user. */
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

  const { symbol, interval, side, entry, stopLoss, targets, confidence, grade, rationale } =
    body as Record<string, string | number | string[]>;

  if (
    typeof symbol !== "string" ||
    typeof interval !== "string" ||
    (side !== "LONG" && side !== "SHORT") ||
    typeof entry !== "number" ||
    typeof stopLoss !== "number" ||
    !Array.isArray(targets)
  ) {
    return NextResponse.json({ error: "Invalid signal payload" }, { status: 400 });
  }

  const created = await db.savedSignal.create({
    data: {
      userId: user.id,
      email: user.email ?? null,
      symbol,
      interval,
      side,
      entry,
      stopLoss,
      targets: JSON.stringify(targets),
      confidence: typeof confidence === "number" ? confidence : 0,
      grade: typeof grade === "string" ? grade : "C",
      rationale: JSON.stringify(Array.isArray(rationale) ? rationale : []),
    },
  });

  return NextResponse.json({ signal: created }, { status: 201 });
}

/** DELETE /api/signals/saved?id=... — remove a saved signal. */
export async function DELETE(req: Request) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db, unavailable } = await resolveDb();
  if (!db) return NextResponse.json({ error: unavailable!.message }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existing = await db.savedSignal.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.savedSignal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
