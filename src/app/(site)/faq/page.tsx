import Link from "next/link";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { Container, Section, SectionHeading, Pill, CtaBanner } from "@/components/site/ui";
import { RiskDisclaimer } from "@/components/site/risk-disclaimer";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { FaqList } from "@/components/site/faq-list";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageSchema } from "@/lib/schema";

export const metadata: Metadata = buildMetadata({
  title: "FAQ: XAUUSD Signals, ICT Concepts & Backtesting | TradePilot",
  description:
    "Answers to common questions about XAUUSD and XAGUSD signals, ICT and Smart Money Concepts, liquidity sweeps, FVGs, order blocks, backtesting and risk.",
  path: "/faq",
  keywords: ["XAUUSD signals FAQ", "ICT FAQ", "smart money concepts questions"],
});

const FAQS = [
  {
    question: "What are XAUUSD signals?",
    answer:
      "XAUUSD signals are analysis updates for gold that include a directional bias, the liquidity context behind it (such as a swept session low), an entry zone, an invalidation level and a quality score. On TradePilot, signals are generated systematically from published ICT rules, and every element of the reasoning is shown.",
  },
  {
    question: "What are XAGUSD signals?",
    answer:
      "XAGUSD signals apply the same systematic model to silver, with parameters calibrated for silver's higher volatility and thinner liquidity, and cross-validated against gold's structure at key levels.",
  },
  {
    question: "What is ICT trading?",
    answer:
      "ICT (Inner Circle Trader) is a methodology that reads price through institutional behavior: where liquidity rests, how it gets swept, and what the market's displacement and structure reveal afterwards. Our guide explains the model without the jargon — see the ICT strategy page.",
  },
  {
    question: "What is Smart Money Concepts (SMC)?",
    answer:
      "SMC is the broader community term for liquidity-based analysis popularized by ICT: liquidity sweeps, order blocks, fair value gaps, market structure, premium/discount and related concepts. We treat ICT and SMC as one toolkit and hold both to the same testing standard.",
  },
  {
    question: "How does the signal engine work?",
    answer:
      "In four stages: (1) map liquidity pools on XAUUSD/XAGUSD, (2) detect sweeps verified by closes back inside the range, (3) require a market structure shift with displacement as confirmation, (4) grade the qualifying setup on context factors and publish it with full reasoning.",
  },
  {
    question: "What is a liquidity sweep?",
    answer:
      "A sweep is a probe beyond an obvious high or low that triggers resting stop orders before price rejects the level and reverses. It is the market harvesting liquidity, and it is the catalyst behind most ICT reversal setups.",
  },
  {
    question: "What is a Fair Value Gap (FVG)?",
    answer:
      "A fair value gap is the empty zone between candle one's high and candle three's low created by a strong displacement candle — an inefficiency to which price often returns. It is used for entry refinement inside a confirmed setup.",
  },
  {
    question: "What is an order block?",
    answer:
      "An order block is the last opposing candle before a strong move in the new direction. It marks the zone where institutional interest is presumed to have filled, and price often reacts when it revisits the zone.",
  },
  {
    question: "Can I backtest ICT strategies?",
    answer:
      "Yes. The TradePilot backtester runs the model bar-by-bar on historical gold and silver data under bar-replay discipline with realistic costs, and our free guide teaches you to run the same honest workflow manually.",
  },
  {
    question: "Does the platform guarantee profitable trades?",
    answer:
      "No. TradePilot provides rule-based analysis and testing tools — not advice, not guarantees. Trading gold, silver and other leveraged markets involves substantial risk of loss, and past performance does not guarantee future results.",
  },
  {
    question: "Do I need trading experience to use TradePilot?",
    answer:
      "No. Every signal carries plain-language reasoning, and the knowledge base teaches every concept the engine uses, from liquidity sweeps to SMT divergence, free of charge.",
  },
  {
    question: "Which markets does TradePilot cover?",
    answer:
      "XAUUSD (gold) and XAGUSD (silver) — deliberately focused, because both metals have well-defined session structure and their correlation produces the SMT divergence context that improves the model.",
  },
];

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqPageSchema(FAQS)} />

      <Container className="pt-8">
        <Breadcrumbs items={[{ name: "FAQ", path: "/faq" }]} />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>FAQ</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Frequently asked questions
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">
            Everything traders ask about XAUUSD and XAGUSD signals, the ICT
            model, backtesting and risk. If your question isn&apos;t answered
            here, the{" "}
            <Link href="/blog" className="text-gold hover:underline">
              blog
            </Link>{" "}
            probably covers it in depth.
          </p>
        </div>
      </Container>

      <Section ariaLabel="All questions">
        <SectionHeading eyebrow="Questions" title="All questions, answered plainly" />
        <div className="mx-auto mt-8 max-w-3xl">
          <FaqList items={FAQS} />
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Still curious? The guides go deeper"
          body="Every concept above has a full guide with rules and diagrams — free, no signup required."
          primary={{ href: "/ict-concepts", label: "Browse the glossary" }}
          secondary={{ href: "/dashboard", label: "Open the terminal" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
