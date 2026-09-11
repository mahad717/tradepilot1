import type { Metadata } from "next";
import Link from "next/link";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { LogoMark } from "@/components/site/header";
import { AuthProvider } from "@/components/terminal/auth-provider";
import { TerminalHeaderRight } from "@/components/terminal/terminal-header-right";

export const metadata: Metadata = {
  title: "TradePilot Terminal",
  robots: PRIVATE_ROBOTS,
};

/**
 * Private authenticated area (noindex). All routes below this layout
 * are blocked to crawlers in robots.txt and marked noindex in metadata.
 * The SEO public site lives under (site) and never imports these modules.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="TradePilot terminal home">
              <LogoMark className="h-6 w-6" />
              <span className="font-bold tracking-tight text-foreground">
                Trade<span className="text-gold">Pilot</span>
              </span>
              <span className="ml-2 rounded-full border border-gold/40 px-2 py-0.5 text-[11px] font-semibold text-gold">
                TERMINAL
              </span>
            </Link>
            <TerminalHeaderRight />
          </div>
        </header>
        {children}
      </div>
    </AuthProvider>
  );
}
