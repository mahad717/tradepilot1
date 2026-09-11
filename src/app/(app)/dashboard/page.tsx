import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { Terminal } from "@/components/terminal/terminal";

export const metadata: Metadata = {
  title: "Trading Terminal | TradePilot",
  robots: PRIVATE_ROBOTS,
};

/**
 * Private authenticated trading terminal (noindex).
 * Live ICT analysis, signals, backtesting and SMT divergence.
 */
export default function DashboardPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Terminal />
    </main>
  );
}
