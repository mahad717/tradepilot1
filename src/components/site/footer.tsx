import Link from "next/link";
import { Container } from "./ui";
import { LogoMark } from "./header";

const FOOTER_COLUMNS: {
  title: string;
  links: { href: string; label: string }[];
}[] = [
  {
    title: "Markets",
    links: [
      { href: "/xauusd", label: "XAUUSD analysis" },
      { href: "/xagusd", label: "XAGUSD analysis" },
      { href: "/gold-analysis", label: "Gold price analysis" },
      { href: "/silver-analysis", label: "Silver price analysis" },
    ],
  },
  {
    title: "Platform",
    links: [
      { href: "/xauusd-signals", label: "XAUUSD signals" },
      { href: "/xagusd-signals", label: "XAGUSD signals" },
      { href: "/ict-backtesting", label: "ICT backtesting" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/ict-strategy", label: "ICT trading strategy" },
      { href: "/ict-concepts", label: "ICT concepts glossary" },
      { href: "/blog", label: "Blog & guides" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About TradePilot" },
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of use" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-[oklch(0.14_0.008_260)]">
      <Container className="py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark />
              <span className="text-lg font-bold tracking-tight text-foreground">
                Trade<span className="text-gold">Pilot</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
              Rule-based XAUUSD and XAGUSD analysis built on ICT and Smart
              Money Concepts, with transparent backtesting.
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="text-sm font-semibold text-foreground">
                {col.title}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-gold"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-gold/25 bg-gold/5 p-5">
          <h2 className="text-sm font-semibold text-gold">Risk disclaimer</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            TradePilot provides educational, rule-based market analysis and
            backtesting tools. Nothing on this site is financial advice or a
            recommendation to buy or sell any instrument. Trading gold, silver
            and other markets involves substantial risk of loss. Past
            performance, including historical backtest results, does not
            guarantee future results.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} TradePilot. All rights reserved.</p>
          <p>Rule-based ICT analysis · Historically backtested · No profit guarantees</p>
        </div>
      </Container>
    </footer>
  );
}
