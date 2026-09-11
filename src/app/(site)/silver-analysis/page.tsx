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

export const metadata: Metadata = buildMetadata({
  title: "Silver Price Analysis: Structure, Ratio & SMT | TradePilot",
  description:
    "A structured framework for silver price analysis: silver's own structure, the gold/silver ratio, SMT divergence and volatility-aware position sizing for XAGUSD.",
  path: "/silver-analysis",
  keywords: [
    "silver price analysis",
    "XAGUSD analysis",
    "silver technical analysis",
    "gold silver ratio",
  ],
});

export default function SilverAnalysisPage() {
  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs
          items={[{ name: "Silver analysis", path: "/silver-analysis" }]}
        />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Analysis · Silver</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Silver price analysis:{" "}
            <span className="text-gold">structure, ratio and the metals pair</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            Silver analysis done properly is a two-chart discipline: silver&apos;s
            own structure tells you what it is doing, and gold tells you whether
            the story adds up. This page lays out both halves of that framework.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/xagusd-signals", label: "See silver signals" }}
            secondary={{ href: "/blog/smt-divergence-between-gold-and-silver", label: "SMT divergence guide" }}
          />
        </div>
      </Container>

      {/* Silver's own structure */}
      <Section ariaLabel="Silver's own structure">
        <SectionHeading
          eyebrow="Framework · part one"
          title="Read silver on its own terms first"
          lede="Correlation is not identity. Before comparing metals, the framework requires silver's independent read — its dealing ranges, its pools, its structure events."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {[
            {
              t: "Volatility-aware ranges",
              b: "Silver's ranges run wider per unit of price than gold's. Dealing ranges and their premium/discount halves are computed on silver's own swing structure — never scaled from gold's.",
            },
            {
              t: "Round-number pools",
              b: "At silver's price scale, round numbers and their quarters behave like major levels. They accumulate stops and breakouts, and the engine tracks them as first-class pools.",
            },
            {
              t: "Displacement discipline",
              b: "Silver's thin book produces false wicks constantly. The framework requires close-based confirmation for every sweep and every structure break on XAGUSD.",
            },
            {
              t: "Trend persistence",
              b: "Once silver confirms a structural shift, moves extend further than gold's equivalents. The framework therefore prefers letting winners reach the range boundary rather than trimming early.",
            },
          ].map((item) => (
            <Card key={item.t} className="h-full">
              <h3 className="font-semibold text-foreground">{item.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* Ratio & SMT */}
      <Section
        ariaLabel="The gold/silver ratio and SMT"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Framework · part two"
              title="The gold/silver ratio and SMT divergence"
              lede="The XAU/XAG ratio measures how many silver ounces one gold ounce buys. For structural traders the ratio itself is secondary — what matters is the behavior at extremes: do both metals confirm each other's tests of key levels, or do they diverge?"
            />
            <ul className="mt-6 space-y-2.5">
              <CheckItem>Gold confirming silver's sweep: setup context is cleaner</CheckItem>
              <CheckItem>Silver refusing a gold extreme: bearish SMT for gold, and vice versa</CheckItem>
              <CheckItem>Divergence persisting: momentum regime, stand aside on reversal attempts</CheckItem>
              <CheckItem>Divergence resolving: the catch-up leg is often the sharpest move of the session</CheckItem>
            </ul>
            <p className="mt-6 text-[15.5px] leading-7 text-muted-foreground">
              Full workflow in{" "}
              <Link href="/blog/smt-divergence-between-gold-and-silver" className="text-gold hover:underline">
                SMT divergence between gold and silver
              </Link>
              .
            </p>
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">
              What our silver analysis publishes
            </h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Silver dealing range with equilibrium and OTE zones</CheckItem>
              <CheckItem>Session-tagged pool map including round numbers</CheckItem>
              <CheckItem>Structural events log with close-based verification</CheckItem>
              <CheckItem>Joint metals read: confirmation / divergence status</CheckItem>
              <CheckItem>Scenario framing with named invalidation levels</CheckItem>
            </ul>
          </Card>
        </div>
      </Section>

      {/* Risk */}
      <Section ariaLabel="Silver risk considerations">
        <SectionHeading
          eyebrow="Risk"
          title="Silver-specific risk considerations"
          lede="Silver rewards conviction and punishes overconfidence more than almost any liquid market. The framework bakes three silver-specific risk rules into every published scenario."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            {
              t: "Wider stops, smaller size",
              b: "Stops belong beyond structural invalidation — which in silver means more room. Fixed-fractional sizing adjusts downward to keep the risk constant.",
            },
            {
              t: "News spread discipline",
              b: "Silver's spreads blow out harder around U.S. data. The engine suppresses setup generation in the minutes around releases instead of pretending levels still mean something.",
            },
            {
              t: "Correlation breaks",
              b: "Occasionally the metals decouple for days. The engine detects the regime via rolling correlation and downgrades all silver setup scores until synchronization returns.",
            },
          ].map((item) => (
            <Card key={item.t} className="h-full">
              <h3 className="font-semibold text-foreground">{item.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Analyze both metals as one system"
          body="The terminal tracks silver and gold jointly — structure, pools and divergence — and publishes every setup with the full metals context attached."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/xagusd", label: "Back to XAGUSD guide" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
