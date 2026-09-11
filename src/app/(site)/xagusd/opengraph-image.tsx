import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "XAGUSD analysis — silver structure and SMT divergence on TradePilot";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "XAGUSD: silver structure & the metals pair",
  subtitle:
    "Silver liquidity, FVGs, order blocks and XAU/XAG SMT divergence — with rules.",
  tag: "SILVER · XAGUSD",
});
