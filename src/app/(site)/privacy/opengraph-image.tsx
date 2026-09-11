import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "TradePilot privacy policy";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default createOGImage({
  title: "Privacy policy",
  subtitle: "Analytics with privacy in mind. No sale of personal data, ever.",
  tag: "LEGAL",
});
