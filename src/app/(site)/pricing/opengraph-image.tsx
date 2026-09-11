import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "TradePilot pricing — free and Pro plans for ICT signal analysis";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default createOGImage({
  title: "Simple, honest pricing",
  subtitle: "Education free forever. Pay only for the live engine.",
  tag: "PRICING",
});
