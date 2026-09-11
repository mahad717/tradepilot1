import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "TradePilot pricing — free and Pro plans for ICT signal analysis";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "Simple, honest pricing",
  subtitle: "Education free forever. Pay only for the live engine.",
  tag: "PRICING",
});
