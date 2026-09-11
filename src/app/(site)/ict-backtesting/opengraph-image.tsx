import { createOGImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "ICT backtesting for gold and silver — bar replay without look-ahead bias";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default createOGImage({
  title: "ICT backtesting without look-ahead bias",
  subtitle:
    "Bar-replay evaluation, realistic costs and expectancy-based results for XAUUSD & XAGUSD.",
  tag: "BACKTESTING",
});
