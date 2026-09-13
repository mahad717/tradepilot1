import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { Terminal } from "@/components/terminal/terminal";

export const metadata: Metadata = {
  title: "Trading Terminal | TradePilot",
  robots: PRIVATE_ROBOTS,
};

/**
 * Front page = the live trading terminal, Signals tab active by default
 * (user directive). Renders the exact same component as /dashboard so
 * both URLs stay pixel-identical; the terminal chrome comes from the
 * (app) layout. Kept noindex like the rest of the (app) group — the
 * public marketing site lives under (site), landing now at /welcome.
 */
export default function TerminalHomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Terminal />
    </main>
  );
}
