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
import { SmtDivergenceDiagram } from "@/components/site/diagrams-structure";

export const metadata: Metadata = buildMetadata({
  title: "XAGUSD Analysis: Silver Structure, Liquidity & ICT Setups | TradePilot",
  description:
    "Understand XAGUSD silver trading through ICT lenses: silver liquidity, market structure, FVGs, order blocks and the XAU/XAG SMT divergence between the metals.",
  path: "/xagusd",
  keywords: [
    "XAGUSD",
    "silver trading",
    "XAGUSD technical analysis",
    "silver liquidity",
    "SMT divergence",
  ],
});

export default function XagusdPage() {
  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs items={[{ name: "XAGUSD", path: "/xagusd" }]} />
      </Container>

      {/* Hero */}
      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Silver · XAGUSD</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            XAGUSD analysis: silver&apos;s amplified structure,{" "}
            <span className="text-gold">read with ICT rules</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            Silver is gold&apos;s louder, smaller sibling: thinner liquidity,
            sharper impulses and a habit of confirming — or refusing to confirm
            — everything gold does. This page explains silver on its own terms
            and as part of the metals pair.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/xagusd-signals", label: "See XAGUSD signals" }}
            secondary={{ href: "/silver-analysis", label: "Silver analysis framework" }}
          />
        </div>
      </Container>

      {/* What is XAGUSD */}
      <Section ariaLabel="What is XAGUSD">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="The instrument"
              title="What is XAGUSD?"
              lede="XAGUSD is the spot price of silver in U.S. dollars per troy ounce. It trades alongside gold around the clock but with a much smaller market, which produces wider ranges, faster displacements and more violent reactions at liquidity pools."
            />
            <p className="mt-4 text-[15.5px] leading-7 text-muted-foreground">
              Silver also carries a dual identity that gold does not: it is
              simultaneously a monetary metal and an industrial one, with
              meaningful demand from solar, electronics and manufacturing. That
              mix makes silver sentiment more cyclical — and its trends, once
              established, more persistent. For a rule-based model, the
              practical consequences are wider stops relative to gold and a
              stronger preference for setups confirmed by{" "}
              <strong className="text-foreground">both</strong> structure and
              the gold/silver relationship.
            </p>
          </div>
          <Card className="h-fit">
            <h3 className="font-semibold text-foreground">Silver at a glance</h3>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ["Ticker", "XAGUSD (spot silver, USD per ounce)"],
                ["Character", "Smaller market, higher volatility, sharper sweeps"],
                ["Key liquidity pools", "Session extremes, equal highs/lows, round numbers"],
                ["Unique edge", "XAU/XAG SMT divergence at metal-complex extremes"],
                ["Model fit", "Sweep → MSS → retrace, sized for wider ranges"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex flex-col gap-0.5 border-b border-border pb-3 sm:flex-row sm:justify-between sm:gap-6"
                >
                  <dt className="font-medium text-foreground">{k}</dt>
                  <dd className="text-muted-foreground sm:text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </Section>

      {/* Silver liquidity & structure */}
      <Section
        ariaLabel="Silver liquidity and market structure"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <SectionHeading
          eyebrow="Liquidity & structure"
          title="Silver liquidity and market structure"
          lede="The same pools that populate gold populate silver — but with less depth behind them. That changes how setups behave, not what the model looks for."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            {
              t: "Thinner book, sharper raids",
              b: "With fewer resting orders, silver sweeps tend to be quicker and more violent. The close-back-inside confirmation matters even more here — wick-based reads fail often on XAGUSD.",
            },
            {
              t: "Displacement is the tell",
              b: "Silver's genuine moves displace hard. When an MSS arrives on silver, it usually arrives with momentum, which makes the structure confirmation more reliable than on choppy sessions.",
            },
            {
              t: "Round numbers matter more",
              b: "Silver's smaller absolute price makes round-number levels ($1.00 and 25-cent increments) unusually visible, and they accumulate stops accordingly.",
            },
          ].map((item) => (
            <Card key={item.t} className="h-full">
              <h3 className="font-semibold text-foreground">{item.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* FVGs and order blocks on silver */}
      <Section ariaLabel="XAGUSD FVGs and order blocks">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Concepts on silver"
              title="XAGUSD fair value gaps and order blocks"
              lede="FVGs and order blocks form on silver exactly as they do on gold — three-candle inefficiencies and last-opposing-candle zones. What differs is validation: silver's wider ranges demand that zones be respected with genuine displacement, and the higher-timeframe [premium/discount](/blog/premium-and-discount-explained) filter carries extra weight because silver trends run harder once confirmed."
            />
            <p className="mt-4 text-[15.5px] leading-7 text-muted-foreground">
              Read the mechanics in detail:{" "}
              <Link href="/blog/what-is-a-fair-value-gap" className="text-gold hover:underline">
                what is a fair value gap
              </Link>{" "}
              and{" "}
              <Link href="/blog/what-is-an-order-block" className="text-gold hover:underline">
                what is an order block
              </Link>
              .
            </p>
          </div>
          <SmtDivergenceDiagram />
        </div>
      </Section>

      {/* SMT */}
      <Section
        ariaLabel="XAU/XAG SMT divergence"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="The metals pair"
              title="XAU/XAG SMT divergence"
              lede="The most valuable thing about trading the two metals together is what their disagreement tells you. When gold sweeps a major high and silver refuses to follow — or the reverse at lows — the complex is diverging, and one of the two is usually lying."
            />
            <p className="mt-4 text-[15.5px] leading-7 text-muted-foreground">
              SMT divergence is a context filter in the TradePilot engine: it
              never triggers a trade on its own, but a sweep-and-MSS setup that
              coincides with metals divergence scores higher than one without
              it. The full logic is explained in{" "}
              <Link href="/blog/smt-divergence-between-gold-and-silver" className="text-gold hover:underline">
                SMT divergence between gold and silver
              </Link>
              .
            </p>
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">
              How the engine uses the pair
            </h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Joint monitoring of XAUUSD and XAGUSD at key extremes</CheckItem>
              <CheckItem>Divergence flagged and displayed on every relevant signal</CheckItem>
              <CheckItem>Silver setups cross-checked against gold structure</CheckItem>
              <CheckItem>Divergence contribution visible in the quality score</CheckItem>
            </ul>
          </Card>
        </div>
      </Section>

      {/* Engine + CTA */}
      <Section ariaLabel="Silver signals and next steps">
        <SectionHeading
          eyebrow="From analysis to signals"
          title="From silver analysis to XAGUSD signals"
          lede="The silver engine mirrors the gold pipeline — pools, sweeps, MSS, refined entries — calibrated for silver's volatility, and cross-validated against gold."
        />
        <CtaRow
          className="mt-8"
          primary={{ href: "/xagusd-signals", label: "Explore XAGUSD signals" }}
          secondary={{ href: "/ict-backtesting", label: "See the backtests" }}
        />
        <div className="mt-12">
          <CtaBanner
            title="Trade the metals as a system"
            body="Open the terminal to study silver structure, monitor the gold/silver relationship and replay historical XAGUSD sessions with full bar-replay discipline."
            primary={{ href: "/dashboard", label: "Open the terminal" }}
            secondary={{ href: "/blog", label: "Read the guides" }}
          />
        </div>
      </Section>

      <RiskDisclaimer />
    </>
  );
}
