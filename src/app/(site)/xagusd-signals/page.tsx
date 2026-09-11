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
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageSchema } from "@/lib/schema";

export const metadata: Metadata = buildMetadata({
  title: "XAGUSD Signals: Rule-Based ICT Silver Setups & Quality Scores | TradePilot",
  description:
    "TradePilot XAGUSD signals document silver's sweep, MSS confirmation, entry zone and invalidation — cross-validated against gold with a transparent quality score.",
  path: "/xagusd-signals",
  keywords: [
    "XAGUSD signals",
    "silver trading signals",
    "ICT silver",
    "silver signal quality score",
  ],
});

const SIGNAL_FAQS = [
  {
    question: "How are XAGUSD signals generated?",
    answer:
      "The same systematic pipeline as gold — liquidity pools, verified sweeps, MSS confirmation, refined entries — with parameters calibrated for silver's wider ranges and higher volatility.",
  },
  {
    question: "Why cross-check silver against gold?",
    answer:
      "Silver and gold are tightly correlated. A silver setup that agrees with gold's structure is cleaner; a divergence between the metals (SMT) at a key level raises the quality score of a reversal setup.",
  },
  {
    question: "Are silver signals riskier than gold signals?",
    answer:
      "Silver's thinner liquidity means wider stops and sharper moves. The engine accounts for this with silver-specific parameters, and every signal still carries an explicit invalidation level.",
  },
];

export default function XagusdSignalsPage() {
  return (
    <>
      <JsonLd data={faqPageSchema(SIGNAL_FAQS)} />

      <Container className="pt-8">
        <Breadcrumbs
          items={[{ name: "XAGUSD signals", path: "/xagusd-signals" }]}
        />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Signals · Silver</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            XAGUSD signals:{" "}
            <span className="text-gold">silver setups, silver-sized risk</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            Silver signals are not gold signals with a different ticker. The
            engine recalibrates every stage for silver&apos;s thinner book and
            wider ranges — and cross-validates setups against gold structure
            before publishing.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/dashboard", label: "Open the terminal" }}
            secondary={{ href: "/pricing", label: "View pricing" }}
          />
        </div>
      </Container>

      <Section ariaLabel="What a silver signal contains">
        <SectionHeading
          eyebrow="Transparency"
          title="What a XAGUSD signal contains"
          lede="Identical anatomy to gold, recalibrated for silver. Every element is published with the signal — nothing is hidden behind a score."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              t: "Directional bias",
              b: "Long or short, anchored to silver's own higher-timeframe structure and checked against gold's.",
            },
            {
              t: "Liquidity context",
              b: "The swept pool — session extreme, equal lows, round number — tagged by session and timestamp.",
            },
            {
              t: "MSS confirmation",
              b: "Silver's displacements are violent; the engine requires a full-body structure break, not a wick.",
            },
            {
              t: "Entry zone & invalidation",
              b: "FVG or order block entry with silver-sized stop distance and the exact invalidation level.",
            },
            {
              t: "XAU/XAG context",
              b: "Whether gold confirms or diverges (SMT) at the level — and how that factored into the score.",
            },
            {
              t: "Quality score & reasoning",
              b: "0–100 score with every contributing factor listed, plus a plain-language summary.",
            },
          ].map((item) => (
            <Card key={item.t} className="h-full">
              <h3 className="font-semibold text-foreground">{item.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        ariaLabel="Silver-specific calibration"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Calibration"
              title="How silver changes the model"
              lede="The rules stay the same; the parameters do not. This is where most copy-paste signal services fail on silver, and where ours is explicit."
            />
            <ul className="mt-6 space-y-2.5">
              <CheckItem>Wider stop distances and pool widths for silver's range profile</CheckItem>
              <CheckItem>Stricter close-based sweep confirmation (wicks mislead on thin books)</CheckItem>
              <CheckItem>Round-number pools weighted higher in silver's price region</CheckItem>
              <CheckItem>Volatility filters that stand aside when spreads blow out</CheckItem>
            </ul>
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">
              The gold cross-check
            </h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Before any silver setup is published, the engine evaluates the
              same level on gold: does gold&apos;s structure agree? Is there{" "}
              <Link href="/blog/smt-divergence-between-gold-and-silver" className="text-gold hover:underline">
                SMT divergence
              </Link>{" "}
              between the metals at the extreme? Agreement strengthens the
              signal; divergence at a reversal level can raise the score; and
              outright structural conflict suppresses it.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The relationship is explained in our{" "}
              <Link href="/xagusd" className="text-gold hover:underline">
                XAGUSD analysis guide
              </Link>
              .
            </p>
          </Card>
        </div>
      </Section>

      <Section ariaLabel="Get started">
        <CtaBanner
          title="See silver the way the engine sees it"
          body="Open the terminal to explore silver signals with full context, run bar-replay backtests on XAGUSD, and study the metals pair as one system."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/xagusd", label: "Learn the silver model" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
