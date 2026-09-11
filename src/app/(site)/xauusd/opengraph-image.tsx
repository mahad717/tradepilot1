import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "XAUUSD analysis — gold liquidity and ICT structure on TradePilot";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "XAUUSD: gold liquidity, structure & ICT setups",
  subtitle:
    "Session behavior, sweeps, FVGs and order blocks — applied to gold with rules.",
  tag: "GOLD · XAUUSD",
});
