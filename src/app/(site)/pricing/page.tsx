import Link from "next/link";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import {
  Container,
  Section,
  SectionHeading,
  Pill,
  CtaBanner,
  CheckItem,
} from "@/components/site/ui";
import { RiskDisclaimer } from "@/components/site/risk-disclaimer";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { Card } from "@/components/site/ui";
import { JsonLd } from "@/components/seo/json-ld";

export const metadata: Metadata = buildMetadata({
  title: "Pricing: Free & Pro Plans for ICT Signal Analysis | TradePilot",
  description:
    "TradePilot pricing: start free with XAUUSD and XAGUSD analysis and education, upgrade to Pro for live signals, quality scores and the full backtesting engine.",
  path: "/pricing",
  keywords: ["TradePilot pricing", "ICT signals pricing", "gold signals plan"],
});

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    blurb: "Learn the model and follow the analysis. No card required.",
    features: [
      "Full access to guides & glossary",
      "Daily XAUUSD / XAGUSD analysis overview",
      "Delayed signals (end of session)",
      "Basic charting workspace",
      "Community FAQ support",
    ],
    cta: { href: "/dashboard", label: "Start free" },
    highlight: false,
  },
  {
    name: "Pro",
    price: "$29",
    period: "per month",
    blurb: "The complete engine: live signals, scores and backtesting.",
    features: [
      "Live XAUUSD & XAGUSD signals",
      "Full quality-score breakdowns",
      "XAU/XAG SMT divergence monitoring",
      "Unlimited bar-replay backtests",
      "Session & regime analytics",
      "Email + priority support",
    ],
    cta: { href: "/dashboard", label: "Start Pro trial" },
    highlight: true,
  },
  {
    name: "Team",
    price: "$79",
    period: "per month",
    blurb: "For small trading teams that need shared workspaces.",
    features: [
      "Everything in Pro, 5 seats",
      "Shared signal journal & annotations",
      "Team backtest archives",
      "Role-based access",
      "Priority onboarding",
    ],
    cta: { href: "/dashboard", label: "Contact us" },
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={{
          "@type": "SoftwareApplication",
          name: "TradePilot",
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web browser",
          offers: PLANS.map((p) => ({
            "@type": "Offer",
            name: p.name,
            price: p.price.replace("$", ""),
            priceCurrency: "USD",
            description: p.blurb,
          })),
        }}
      />

      <Container className="pt-8">
        <Breadcrumbs items={[{ name: "Pricing", path: "/pricing" }]} />
      </Container>

      <Container className="pt-6">
        <div className="mx-auto max-w-2xl text-center">
          <Pill>Pricing</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Simple pricing for <span className="text-gold">systematic metals analysis</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">
            Education is free forever. You only pay when you want the live
            engine — and you can cancel in two clicks.
          </p>
        </div>
      </Container>

      <Section ariaLabel="Plans">
        <div className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Card
              key={plan.name}
              className={
                plan.highlight
                  ? "relative border-gold/60 shadow-[0_0_40px_rgba(232,181,77,0.12)]"
                  : ""
              }
            >
              {plan.highlight ? (
                <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  Most popular
                </span>
              ) : null}
              <h2 className="text-lg font-semibold text-foreground">{plan.name}</h2>
              <p className="mt-3">
                <span className="text-3xl font-bold text-foreground">{plan.price}</span>{" "}
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{plan.blurb}</p>
              <ul className="mt-5 space-y-2.5">
                {plan.features.map((f) => (
                  <CheckItem key={f}>{f}</CheckItem>
                ))}
              </ul>
              <Link
                href={plan.cta.href}
                className={
                  plan.highlight
                    ? "mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-gold-soft"
                    : "mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-6 py-2.5 text-sm font-semibold text-foreground hover:border-gold/50"
                }
              >
                {plan.cta.label}
              </Link>
            </Card>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          All plans include the full risk tooling and our{" "}
          <Link href="/terms" className="text-gold hover:underline">
            terms of use
          </Link>
          . Trading involves risk; TradePilot is analysis software, not advice.
        </p>
      </Section>

      <Section
        ariaLabel="Pricing FAQ"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <SectionHeading eyebrow="Questions" title="Pricing questions" />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {[
            {
              q: "Is the free plan really free?",
              a: "Yes — the guides, glossary and delayed analysis are free forever. Pro adds live signals, quality scores and the backtesting engine.",
            },
            {
              q: "Can I cancel anytime?",
              a: "Yes, from your settings page in two clicks. No retention flows, no phone calls.",
            },
            {
              q: "Do you offer refunds?",
              a: "If Pro is not for you, email us within 7 days of your first payment for a full refund.",
            },
            {
              q: "Why isn't there a signals-only tier?",
              a: "Signals without the model behind them is how signal services hide their logic. We deliberately sell the full system — rules, scores, backtests — as one product.",
            },
          ].map((f) => (
            <Card key={f.q}>
              <h3 className="font-semibold text-foreground">{f.q}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.a}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Try the engine before you decide"
          body="The free plan includes delayed signals and the full knowledge base — enough to judge the transparency before paying for anything."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/faq", label: "Read the FAQ" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
