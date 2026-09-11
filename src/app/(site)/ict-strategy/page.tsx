import Link from "next/link";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import {
  Container,
  Section,
  SectionHeading,
  Card,
  Pill,
  CtaRow,
  CtaBanner,
  CheckItem,
} from "@/components/site/ui";
import { RiskDisclaimer } from "@/components/site/risk-disclaimer";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { MarketStructureDiagram } from "@/components/site/diagrams-structure";

export const metadata: Metadata = buildMetadata({
  title: "ICT Trading Strategy Explained: The Sweep–MSS–Retrace Model | TradePilot",
  description:
    "A practical guide to the ICT trading strategy and Smart Money Concepts: liquidity sweeps, market structure shifts, FVG entries, Kill Zones and risk rules — explained for humans.",
  path: "/ict-strategy",
  keywords: [
    "ICT trading strategy",
    "smart money concepts",
    "SMC trading",
    "ICT kill zones",
    "ICT model",
  ],
});

export default function IctStrategyPage() {
  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs
          items={[{ name: "ICT strategy", path: "/ict-strategy" }]}
        />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Strategy</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            The ICT trading strategy:{" "}
            <span className="text-gold">a practical guide to the model</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            ICT — Inner Circle Trader, the methodology developed by Michael
            Huddleston — and the broader Smart Money Concepts movement rest on
            one observation: markets move toward liquidity. This page explains
            the working model we implement, stripped of jargon and mysticism,
            with every concept linked to a full guide.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/ict-concepts", label: "Browse the concepts glossary" }}
            secondary={{ href: "/ict-backtesting", label: "How we backtest it" }}
          />
        </div>
      </Container>

      {/* What is ICT */}
      <Section ariaLabel="What is ICT trading">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Foundation"
              title="What is ICT trading?"
              lede="ICT is a framework that reads price through the behavior of large participants: where their orders likely rest (liquidity pools), how they fill size (sweeps and raids), and what their footprint looks like after the fact (displacement, structure shifts, inefficiencies)."
            />
            <p className="mt-4 text-[15.5px] leading-7 text-muted-foreground">
              Two honest disclaimers belong here. First, no retail trader can
              observe institutional order flow directly — the concepts are
              interpretations of price behavior, not leaked secrets. Second,
              the value of an interpretation is entirely in whether it can be
              written as rules and tested. That is the stance we take
              throughout: <strong className="text-foreground">use the concepts, demand the
              evidence</strong>. Smart Money Concepts (SMC) is the broader
              community term for the same style of analysis; we treat the two
              as one toolkit.
            </p>
          </div>
          <MarketStructureDiagram />
        </div>
      </Section>

      {/* The core model */}
      <Section
        ariaLabel="The core ICT model"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <SectionHeading
          eyebrow="The model"
          title="The sweep → MSS → retrace core"
          lede="Almost every ICT-style setup is a variation of one sequence. Learning to see these three beats — and to demand all three — is the entire skill."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            {
              t: "1 · Sweep",
              b: "Price raids an obvious pool — equal lows, session extremes, prior day high/low — triggering stops and breakout entries. The raid provides liquidity for the move that follows.",
              href: "/blog/what-is-a-liquidity-sweep",
              link: "Liquidity sweeps",
            },
            {
              t: "2 · MSS",
              b: "A displacement leg breaks the nearest opposing swing against the prior direction. This is the market demonstrating that control changed hands — the setup's confirmation gate.",
              href: "/blog/market-structure-shift-vs-break-of-structure",
              link: "MSS vs BOS",
            },
            {
              t: "3 · Retrace entry",
              b: "Price returns into the inefficiency the displacement created — a fair value gap or order block — where the entry is sought with the sweep extreme as invalidation.",
              href: "/blog/what-is-a-fair-value-gap",
              link: "Fair value gaps",
            },
          ].map((s) => (
            <Card key={s.t} className="h-full">
              <h3 className="font-semibold text-foreground">{s.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.b}</p>
              <Link href={s.href} className="mt-3 inline-block text-sm font-medium text-gold hover:underline">
                {s.link} →
              </Link>
            </Card>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-[15.5px] leading-7 text-muted-foreground">
          Location governs everything: the same sequence in{" "}
          <Link href="/blog/premium-and-discount-explained" className="text-gold hover:underline">
            discount of the dealing range
          </Link>{" "}
          is a long candidate; in premium it is usually a trap. And timing
          governs plausibility — setups resolve inside{" "}
          <Link href="/blog/gold-session-behavior-asia-london-new-york" className="text-gold hover:underline">
            Kill Zones
          </Link>
          , or they drift.
        </p>
      </Section>

      {/* Kill zones + risk */}
      <Section ariaLabel="Kill zones and risk management">
        <div className="grid gap-5 md:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-foreground">The Kill Zones</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              ICT&apos;s session windows concentrate the hours when setups
              actually resolve:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-mono text-gold">02:00–05:00 ET</span> London Open Kill Zone
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-gold">07:00–10:00 ET</span> New York Open Kill Zone
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-gold">15:00–16:00 ET</span> NY PM session (secondary)
              </li>
            </ul>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              On gold and silver, these windows map directly onto real
              institutional flow — European banking hours and U.S. data
              releases.
            </p>
          </Card>
          <Card>
            <h3 className="font-semibold text-foreground">Risk management rules</h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Invalidation is structural: beyond the sweep extreme, never a round number</CheckItem>
              <CheckItem>Fixed-fractional sizing: risk a small, constant fraction per trade</CheckItem>
              <CheckItem>One setup, one entry: no averaging into losers</CheckItem>
              <CheckItem>Expectancy is the scoreboard, not win rate</CheckItem>
              <CheckItem>Stand aside when the model&apos;s conditions are absent — flat is a position</CheckItem>
            </ul>
          </Card>
        </div>
      </Section>

      {/* How TradePilot applies it */}
      <Section
        ariaLabel="How TradePilot applies the ICT model"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Application"
              title="How TradePilot applies the model"
              lede="Everything above is encoded as explicit, testable rules in our engine — for XAUUSD and XAGUSD specifically. Every signal shows which rules fired, and every rule carries its backtest history."
            />
            <CtaRow
              className="mt-8"
              primary={{ href: "/xauusd-signals", label: "See it on gold" }}
              secondary={{ href: "/xagusd-signals", label: "See it on silver" }}
            />
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">Our additions to the base model</h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Close-based sweep verification to kill wick-based false positives</CheckItem>
              <CheckItem>XAU/XAG SMT divergence as a scored context factor</CheckItem>
              <CheckItem>Session and volatility filters around U.S. data releases</CheckItem>
              <CheckItem>Transparent quality score replacing subjective setup grades</CheckItem>
            </ul>
          </Card>
        </div>
      </Section>

      <Section ariaLabel="Continue learning" className="pt-0">
        <CtaBanner
          title="Learn the model, then watch it run"
          body="Start with the concepts glossary, study a couple of guides, then open the terminal and watch the same rules compute in real time."
          primary={{ href: "/ict-concepts", label: "Open the glossary" }}
          secondary={{ href: "/dashboard", label: "Open the terminal" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
