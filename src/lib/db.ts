import { PrismaClient } from "@prisma/client";

/**
 * Environment-aware Prisma access for TradePilot.
 *
 * - Local dev / Node hosting  → SQLite file via DATABASE_URL (`bun run db:push`).
 * - Cloudflare Workers        → Cloudflare D1 via the "DB" binding
 *                               (@prisma/adapter-d1). See wrangler.jsonc and
 *                               d1/schema.sql for the one-time setup.
 *
 * The client is created lazily on first request (never at module import time)
 * so that `next build` / the OpenNext bundle never touches a database engine —
 * Workers have no filesystem and cannot load Prisma's native engines.
 */

export class DbUnavailableError extends Error {
  constructor(reason: string) {
    super(`Database unavailable: ${reason}`);
    this.name = "DbUnavailableError";
  }
}

type TradepilotPrisma = PrismaClient;

const globalForPrisma = globalThis as unknown as {
  __tradepilotPrisma?: Promise<TradepilotPrisma>;
};

async function createClient(): Promise<TradepilotPrisma> {
  // ---------------------------------------------------------------------------
  // 1) Cloudflare Workers / `wrangler dev` — use the D1 binding.
  // ---------------------------------------------------------------------------
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const binding = (ctx?.env as { DB?: unknown } | undefined)?.DB;

    if (binding) {
      const { PrismaD1 } = await import("@prisma/adapter-d1");
      const adapter = new PrismaD1(
        binding as ConstructorParameters<typeof PrismaD1>[0]
      );
      return new PrismaClient({ adapter });
    }

    // Running under workerd but the D1 binding was never wired up — fail with
    // an actionable message instead of Prisma's native-engine crash.
    throw new DbUnavailableError(
      'Cloudflare D1 binding "DB" is not configured. Create a D1 database, '
        + 'bind it as DB (see the d1_databases block in wrangler.jsonc), run '
        + "`wrangler d1 execute tradepilot-db --remote --file=d1/schema.sql`, then redeploy."
    );
  } catch (err) {
    if (err instanceof DbUnavailableError) throw err;
    // Not running inside Cloudflare — fall through to the Node client.
  }

  // ---------------------------------------------------------------------------
  // 2) Node.js (local dev & traditional hosting) — classic SQLite file.
  // ---------------------------------------------------------------------------
  try {
    return new PrismaClient({ log: ["warn", "error"] });
  } catch (err) {
    throw new DbUnavailableError(
      err instanceof Error ? err.message : "could not initialise PrismaClient"
    );
  }
}

/**
 * Resolve the shared Prisma client. Throws {@link DbUnavailableError} when no
 * usable database is configured — API routes map that to a clean HTTP 503.
 */
export async function getDb(): Promise<TradepilotPrisma> {
  if (!globalForPrisma.__tradepilotPrisma) {
    globalForPrisma.__tradepilotPrisma = createClient().catch((err) => {
      globalForPrisma.__tradepilotPrisma = undefined;
      throw err;
    });
  }
  return globalForPrisma.__tradepilotPrisma;
}
