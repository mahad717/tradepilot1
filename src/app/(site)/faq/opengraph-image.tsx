import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "TradePilot FAQ — XAUUSD signals, ICT concepts and backtesting";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "Frequently asked questions",
  subtitle: "XAUUSD & XAGUSD signals, ICT concepts, backtesting and risk — answered plainly.",
  tag: "FAQ",
});
