import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Silver price analysis framework — structure, ratio and SMT";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "Silver price analysis: structure, ratio and the metals pair",
  subtitle: "Silver's own structure plus the XAU/XAG relationship, in one framework.",
  tag: "ANALYSIS · SILVER",
});
