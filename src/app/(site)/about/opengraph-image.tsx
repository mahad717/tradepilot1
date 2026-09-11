import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "About TradePilot — transparent, rule-based market analysis";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "Rules in the open, evidence over promises",
  subtitle: "Systematic ICT analysis for gold and silver with published methodology.",
  tag: "ABOUT",
});
