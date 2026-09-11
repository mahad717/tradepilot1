import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

/** Default social preview for all public pages without a dedicated one. */
export const alt = "TradePilot — rule-based XAUUSD & XAGUSD ICT analysis";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default createOGImage({
  title: "Rule-based gold & silver analysis",
  subtitle:
    "XAUUSD and XAGUSD signals built on ICT and Smart Money Concepts — with honest backtesting.",
  tag: "ICT SIGNALS",
});
