/**
 * Central site configuration for TradePilot.
 * Every SEO surface (canonical URLs, sitemap, robots, JSON-LD, OG tags)
 * derives from this single source of truth.
 */
export const siteConfig = {
  name: "TradePilot",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradepilot.app").replace(/\/$/, ""),
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
