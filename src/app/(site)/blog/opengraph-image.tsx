import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "TradePilot blog — ICT, SMC, gold and silver trading education";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "ICT, gold & silver education",
  subtitle: "Practical guides on the concepts the engine uses — written for humans first.",
  tag: "KNOWLEDGE BASE",
});
