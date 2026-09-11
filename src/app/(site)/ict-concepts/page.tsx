import Link from "next/link";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import {
  Container,
  Section,
  SectionHeading,
  Card,
  Pill,
  CtaBanner,
} from "@/components/site/ui";
import { RiskDisclaimer } from "@/components/site/risk-disclaimer";
import { Breadcrumbs } from "@/components/site/breadcrumbs";

export const metadata: Metadata = buildMetadata({
  title: "ICT & Smart Money Concepts Glossary: FVG, Order Blocks, MSS | TradePilot",
  description:
    "Plain-language definitions of every ICT and Smart Money Concept: liquidity sweep, fair value gap, order block, MSS, BOS, premium and discount, SMT divergence and Kill Zones.",
  path: "/ict-concepts",
  keywords: [
    "ICT concepts",
    "smart money concepts glossary",
    "what is a liquidity sweep",
    "what is a fair value gap",
    "what is an order block",
    "what is MSS",
    "what is BOS",
  ],
});

const CONCEPTS: {
  term: string;
  definition: string;
  href: string;
  linkLabel: string;
}[] = [
  {
    term: "Liquidity sweep",
    definition:
      "A probe beyond an obvious high or low that triggers resting stops before price rejects the level and reverses. The raid provides the liquidity that large participants need to fill size.",
    href: "/blog/what-is-a-liquidity-sweep",
    linkLabel: "Full guide: liquidity sweeps",
  },
  {
    term: "Fair Value Gap (FVG)",
    definition:
      "A three-candle inefficiency: the gap between candle 1's high and candle 3's low left by a strong displacement candle. Price frequently retraces into the gap, making it an entry reference.",
    href: "/blog/what-is-a-fair-value-gap",
    linkLabel: "Full guide: fair value gaps",
  },
  {
    term: "Order block",
    definition:
      "The last opposing candle before a strong displacement in the new direction — a zone where institutional interest is presumed to have filled, often respected on retest.",
    href: "/blog/what-is-an-order-block",
    linkLabel: "Full guide: order blocks",
  },
  {
    term: "Market Structure Shift (MSS)",
    definition:
      "A close-based break of the most recent swing against the prevailing trend, usually after a sweep. It flips the working bias and confirms the reversal model.",
    href: "/blog/market-structure-shift-vs-break-of-structure",
    linkLabel: "Full guide: MSS vs BOS",
  },
  {
    term: "Break of Structure (BOS)",
    definition:
      "A close-based break of the most recent swing in the direction of the prevailing trend. It confirms continuation and typically precedes continuation entries into pullback inefficiencies.",
    href: "/blog/market-structure-shift-vs-break-of-structure",
    linkLabel: "Full guide: MSS vs BOS",
  },
  {
    term: "Premium and discount",
    definition:
      "A dealing range split at its 50% midpoint: the upper half is premium (expensive), the lower half is discount (cheap). Longs are sought in discount, shorts in premium.",
    href: "/blog/premium-and-discount-explained",
    linkLabel: "Full guide: premium & discount",
  },
  {
    term: "SMT divergence",
    definition:
      "Divergence between correlated markets — on this platform, gold and silver. When one sweeps an extreme and the other refuses to confirm, the complex is diverging and reversal odds improve.",
    href: "/blog/smt-divergence-between-gold-and-silver",
    linkLabel: "Full guide: SMT divergence",
  },
  {
    term: "Kill Zone",
    definition:
      "ICT's named session windows — London Open (02:00–05:00 ET) and New York Open (07:00–10:00 ET) — when institutional flow makes setups resolve rather than drift.",
    href: "/blog/gold-session-behavior-asia-london-new-york",
    linkLabel: "Full guide: session behavior",
  },
  {
    term: "Displacement",
    definition:
      "A strong, body-dominant impulsive move that breaks structure and leaves inefficiencies behind. Displacement quality is a filter: weak displacement produces unreliable zones.",
    href: "/blog/what-is-a-fair-value-gap",
    linkLabel: "Related: FVGs & displacement",
  },
  {
    term: "Optimal Trade Entry (OTE)",
    definition:
      "A refinement of the discount/premium filter: the 62%–79% retracement band of the dealing range, where reversal entries are sought when structure confirms.",
    href: "/blog/premium-and-discount-explained",
    linkLabel: "Full guide: premium & discount",
  },
];

export default function IctConceptsPage() {
  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs
          items={[{ name: "ICT concepts", path: "/ict-concepts" }]}
        />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Glossary</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            ICT &amp; Smart Money Concepts glossary
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            Every core concept, defined in plain language and linked to a full
            guide with rules and diagrams. No mysticism — if a definition
            cannot be turned into a testable rule, we say so.
          </p>
        </div>
      </Container>

      <Section ariaLabel="Concept definitions">
        <div className="grid gap-5 md:grid-cols-2">
          {CONCEPTS.map((c) => (
            <Card key={c.term} className="h-full">
              <h2 className="text-lg font-semibold text-foreground">{c.term}</h2>
              <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
                {c.definition}
              </p>
              <Link
                href={c.href}
                className="mt-3 inline-block text-sm font-medium text-gold hover:underline"
              >
                {c.linkLabel} →
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="See the concepts compute on live metals data"
          body="The terminal detects sweeps, FVGs, order blocks, MSS events and SMT divergence automatically on XAUUSD and XAGUSD — the glossary, brought to life."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/ict-strategy", label: "Read the strategy guide" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
