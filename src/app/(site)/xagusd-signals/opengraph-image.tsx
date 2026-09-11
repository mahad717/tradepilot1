import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "XAGUSD signals with rule-based ICT setups and quality scores";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "XAGUSD signals: silver setups, silver-sized risk",
  subtitle: "Sweep verification, MSS gates and gold cross-validation for silver.",
  tag: "SIGNALS · SILVER",
});
