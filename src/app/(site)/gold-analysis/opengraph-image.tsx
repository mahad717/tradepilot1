import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Gold price analysis framework — multi-timeframe structure and sessions";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "Gold price analysis: a layered framework",
  subtitle: "Weekly dealing ranges, session behavior and liquidity — computed automatically.",
  tag: "ANALYSIS · GOLD",
});
