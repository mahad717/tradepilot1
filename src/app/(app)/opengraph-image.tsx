import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

/** Social preview for the front page (the live terminal). */
export const alt = "TradePilot live terminal — real-time XAUUSD ICT signals";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

export default createOGImage({
  title: "Live ICT trading terminal",
  subtitle:
    "Real-time XAUUSD signals, liquidity maps and SMT divergence — on every closed candle.",
  tag: "LIVE TERMINAL",
});
