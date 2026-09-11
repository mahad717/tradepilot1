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
  title: "XAUUSD Signals: Rule-Based ICT Gold Setups & Quality Scores | TradePilot",
  description:
    "See exactly what a TradePilot XAUUSD signal contains: directional bias, liquidity sweep context, MSS confirmation, entry zone, invalidation and a transparent quality score.",
  path: "/xauusd-signals",
  keywords: [
    "XAUUSD signals",
    "gold trading signals",
    "ICT signals",
    "gold signal quality score",
  ],
});

const SIGNAL_FAQS = [
  {
    question: "How are XAUUSD signals generated?",
    answer:
      "Systematically. The engine maps liquidity pools, detects sweeps verified by closes back inside range, requires an MSS with displacement, and only then grades the setup into an entry zone — no manual cherry-picking.",
  },
  {
    question: "Do XAUUSD signals guarantee profits?",
    answer:
      "No. Signals are rule-based analysis, not advice or promises. Every rule is backtested and published so you can evaluate the historical edge yourself — and past performance never guarantees future results.",
  },
  {
    question: "How often do gold signals appear?",
    answer:
      "When the model finds valid setups — typically around the London and New York Kill Zones. Quiet sessions can produce none; the engine stands aside rather than force trades.",
  },
];

export default function XauusdSignalsPage() {
  return (
    <>
      <JsonLd data={faqPageSchema(SIGNAL_FAQS)} />

      <Container className="pt-8">
        <Breadcrumbs
          items={[{ name: "XAUUSD signals", path: "/xauusd-signals" }]}
        />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Signals · Gold</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            XAUUSD signals: <span className="text-gold">every setup shows its rules</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            Most signal services ask for blind trust. TradePilot signals do the
            opposite: each one documents the liquidity context, the exact rules
            that fired, the invalidation level and a quality score derived from
            historical backtests.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/dashboard", label: "Open the terminal" }}
            secondary={{ href: "/pricing", label: "View pricing" }}
          />
        </div>
      </Container>

      {/* Anatomy of a signal */}
      <Section ariaLabel="Anatomy of a signal">
        <SectionHeading
          eyebrow="Transparency"
          title="What a XAUUSD signal contains"
          lede="Every published signal follows the same anatomy. If any element is missing, the setup is not published."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              t: "Directional bias",
              b: "Long or short, always anchored to the higher-timeframe structure and the current dealing range's premium/discount position.",
            },
            {
              t: "Liquidity context",
              b: "The pool that was swept — Asian low, equal highs, prior day extreme — with the session tag and a timestamp of the sweep.",
            },
            {
              t: "MSS confirmation",
              b: "The displacement leg that shifted structure, with the swing that was broken. No MSS, no signal — that rule is absolute.",
            },
            {
              t: "Entry zone & invalidation",
              b: "A refined entry inside the FVG or order block created by the displacement, with the exact level that voids the idea.",
            },
            {
              t: "Quality score",
              b: "0–100, derived from backtested context factors: session, SMT divergence, discount/premium positioning, displacement quality.",
            },
            {
              t: "Plain-language reasoning",
              b: "A written summary in human language, so you can verify the logic instead of trusting a black box.",
            },
          ].map((item) => (
            <Card key={item.t} className="h-full">
              <h3 className="font-semibold text-foreground">{item.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* Engine pipeline */}
      <Section
        ariaLabel="How the engine generates gold signals"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Pipeline"
              title="How the signal engine works"
              lede="The pipeline is the same for every gold signal, which is what makes the output auditable. Each stage is a pass/fail gate — the engine never relaxes a rule because a setup 'looks good'."
            />
            <ol className="mt-6 space-y-4">
              {[
                "Map liquidity: session extremes, equal highs/lows, prior day/week levels",
                "Detect sweep: pierce of a pool + close back inside range",
                "Require MSS: displacement breaking the nearest opposing swing",
                "Refine entry: FVG / order block retrace within the displacement leg",
                "Score & publish: context factors + backtest history → quality score",
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/50 font-mono text-xs text-gold">
                    {i + 1}
                  </span>
                  <span className="text-[15px] leading-6 text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">
              A worked example (hypothetical)
            </h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              03:12 ET — London open sweeps the Asian low, candle closes back
              above it. 03:40 — displacement candle breaks the last lower high
              (MSS confirmed, FVG left behind). 04:05 — price retraces into the
              FVG inside discount of the London range; SMT clean (silver swept
              its low too). Setup published: long, entry zone, invalidation
              below sweep low, score 78/100 with every factor listed.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              This is illustrative — live signals appear in the{" "}
              <Link href="/dashboard" className="text-gold hover:underline">
                terminal
              </Link>
              .
            </p>
          </Card>
        </div>
      </Section>

      {/* Risk management & honesty */}
      <Section ariaLabel="Risk management">
        <div className="grid gap-5 md:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-foreground">Risk management</h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Invalidation level is part of every signal, never optional</CheckItem>
              <CheckItem>Position sizing guidance: risk a fixed fraction, never more</CheckItem>
              <CheckItem>No averaging into losing setups — the invalidation is the exit</CheckItem>
              <CheckItem>Session-aware expectations: setups resolve inside Kill Zones</CheckItem>
            </ul>
          </Card>
          <Card>
            <h3 className="font-semibold text-foreground">What signals are not</h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Not financial advice or a managed service</CheckItem>
              <CheckItem>Not guaranteed — no signal service can guarantee profits</CheckItem>
              <CheckItem>Not auto-trading: you stay in control of execution</CheckItem>
              <CheckItem>Not infallible: rules get retested when markets change</CheckItem>
            </ul>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Read our full{" "}
              <Link href="/faq" className="text-gold hover:underline">
                FAQ
              </Link>{" "}
              and{" "}
              <Link href="/terms" className="text-gold hover:underline">
                terms of use
              </Link>
              .
            </p>
          </Card>
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Watch gold structure, not guesswork"
          body="Every gold signal in the terminal carries its full context and quality score. Start on the free plan and judge the transparency yourself."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/xauusd", label: "Learn the gold model" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
