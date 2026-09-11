import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "ICT trading strategy guide — the sweep, MSS and retrace model";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "The ICT trading strategy, explained for humans",
  subtitle:
    "Liquidity sweeps, market structure shifts, FVG entries and Kill Zones — the practical core.",
  tag: "ICT STRATEGY",
});
