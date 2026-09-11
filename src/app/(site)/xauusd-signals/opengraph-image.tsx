import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "XAUUSD signals with rule-based ICT setups and quality scores";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "XAUUSD signals: every setup shows its rules",
  subtitle: "Liquidity context, MSS confirmation, entry zones and a transparent quality score.",
  tag: "SIGNALS · GOLD",
});
