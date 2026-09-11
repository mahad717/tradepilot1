import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "TradePilot terms of use";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default createOGImage({
  title: "Terms of use",
  subtitle: "Analysis software provided as-is. Not financial advice. No profit guarantees.",
  tag: "LEGAL",
});
