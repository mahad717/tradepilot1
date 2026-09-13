import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { Terminal } from "@/components/terminal/terminal";

// Front page = the live terminal, Signals tab active by default (user
// directive). Indexable for SEO (user directive): full public metadata
// via buildMetadata — canonical "/", index/follow, OG + Twitter tags;
// the social card comes from the colocated opengraph-image.tsx.
// /dashboard keeps its private noindex metadata — only "/" is public.
export const metadata: Metadata = buildMetadata({
  title: "Live XAUUSD ICT Terminal — Signals & SMT | TradePilot",
  description:
    "The live ICT trading terminal for gold: model-verified XAUUSD signals on every closed candle, liquidity sweeps, market structure shifts and SMT divergence.",
  path: "/",
  keywords: [
    "live XAUUSD signals",
    "ICT trading terminal",
    "live gold signals",
    "smart money concepts terminal",
    "SMT divergence",
    "liquidity sweep",
  ],
});

export default function TerminalHomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Terminal />
    </main>
  );
}
