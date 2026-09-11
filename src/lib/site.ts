/**
 * Central site configuration for TradePilot.
 * Every SEO surface (canonical URLs, sitemap, robots, JSON-LD, OG tags)
 * derives from this single source of truth.
 */
/**
 * Default canonical origin. Must include the protocol.
 * Used when NEXT_PUBLIC_SITE_URL is unset or unparseable, so a bad env
 * value can never crash the build (e.g. `new URL()` for metadataBase).
 */
const FALLBACK_SITE_URL = "https://tradepilot1.gabeyre80.workers.dev";

/**
 * Normalizes NEXT_PUBLIC_SITE_URL into a valid absolute origin.
 * - Trims whitespace and treats empty strings as unset
 * - Auto-prepends `https://` when the scheme is missing
 *   (e.g. `tradepilot1.gabeyre80.workers.dev` -> `https://tradepilot1.gabeyre80.workers.dev`)
 * - Strips any path/trailing slash (site URL is always an origin)
 * - Falls back to FALLBACK_SITE_URL if the value is unusable
 */
function resolveSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (!raw) return FALLBACK_SITE_URL;

  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.origin;
      }
    } catch {
      // invalid — try the next candidate
    }
  }
  return FALLBACK_SITE_URL;
}

export const siteConfig = {
  name: "TradePilot",
  url: resolveSiteUrl(),
  locale: "en_US",
  description:
    "Rule-based XAUUSD and XAGUSD analysis and signals built on ICT and Smart Money Concepts — liquidity sweeps, market structure, FVGs, order blocks — with honest backtesting.",
  twitterHandle: process.env.NEXT_PUBLIC_TWITTER_HANDLE || undefined,
} as const;

export const INSTRUMENTS = {
  xauusd: {
    symbol: "XAUUSD",
    label: "Gold / U.S. Dollar",
    path: "/xauusd",
  },
  xagusd: {
    symbol: "XAGUSD",
    label: "Silver / U.S. Dollar",
    path: "/xagusd",
  },
} as const;

export type SiteConfig = typeof siteConfig;
