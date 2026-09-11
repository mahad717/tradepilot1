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
  title: "Gold Price Analysis: Multi-Timeframe Structure & Sessions | TradePilot",
  description:
    "A structured framework for gold price analysis: higher-timeframe bias, dealing ranges, session behavior and liquidity — the same layers the TradePilot engine applies to XAUUSD.",
  path: "/gold-analysis",
  keywords: [
    "gold price analysis",
    "XAUUSD analysis",
    "gold forecast framework",
    "gold technical analysis",
  ],
});

const LAYERS = [
  {
    t: "Weekly — the map",
    b: "Where does gold sit inside the multi-week dealing range? Is price in premium or discount of the weekly swing? Weekly structure defines the directional backdrop every lower timeframe must respect.",
  },
  {
    t: "Daily — the range",
    b: "The daily leg from the last significant low to high (or mirror) defines the working dealing range and its equilibrium. Daily levels — prior day high/low, weekly open — are the pools the intraday model orbits.",
  },
  {
    t: "1-hour — the narrative",
    b: "The 1-hour chart tells you which session is in control and where the day's narrative is executing: sweep of Asian lows into London MSS, or continuation into a New York FVG retrace.",
  },
  {
    t: "5–15 minute — the timing",
    b: "Entry timing lives here: sweep verification candles, MSS displacement, and the FVG or order block retracements the engine seeks. Lower-timeframe structure never overrides the narrative above it.",
  },
];

export default function GoldAnalysisPage() {
  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs
          items={[{ name: "Gold analysis", path: "/gold-analysis" }]}
        />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Analysis · Gold</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Gold price analysis:{" "}
            <span className="text-gold">a layered, structural framework</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            &quot;Where is gold headed?&quot; is the wrong question without a
            timeframe attached. This page lays out the layered framework we use
            to analyze XAUUSD — from weekly dealing ranges down to entry-timing
            structure — the same layers the signal engine computes
            automatically.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/xauusd-signals", label: "See gold signals" }}
            secondary={{ href: "/blog/gold-session-behavior-asia-london-new-york", label: "Session behavior guide" }}
          />
        </div>
      </Container>

      {/* Layers */}
      <Section ariaLabel="Analysis layers">
        <SectionHeading
          eyebrow="Framework"
          title="Four layers, top-down"
          lede="Each layer answers one question and hands its conclusion to the layer below. Conflicts resolve downward: the higher timeframe always wins on bias."
        />
        <div className="mt-8 space-y-4">
          {LAYERS.map((l, i) => (
            <div key={l.t} className="grid gap-3 border-b border-border pb-6 md:grid-cols-[auto_1fr_2fr] md:items-baseline md:gap-8">
              <span className="font-mono text-sm text-gold">0{i + 1}</span>
              <h3 className="text-lg font-semibold text-foreground">{l.t}</h3>
              <p className="text-[15px] leading-7 text-muted-foreground">{l.b}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-[15.5px] leading-7 text-muted-foreground">
          The dealing-range concept that powers layers one and two is explained
          in{" "}
          <Link href="/blog/premium-and-discount-explained" className="text-gold hover:underline">
            premium and discount explained
          </Link>
          .
        </p>
      </Section>

      {/* What we publish */}
      <Section
        ariaLabel="What our gold analysis includes"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Content"
              title="What our gold analysis includes"
              lede="Analysis only earns attention if it is specific, testable and honest about uncertainty. Ours is generated from the same computed layers the engine uses — not from commentary written to sound confident."
            />
            <ul className="mt-6 space-y-2.5">
              <CheckItem>Current dealing range with equilibrium and OTE zones marked</CheckItem>
              <CheckItem>Session map: which pools matter today and when they are likely tested</CheckItem>
              <CheckItem>Structural events log: sweeps, MSS/BOS breaks with timestamps</CheckItem>
              <CheckItem>XAU/XAG relationship read: confirmation or SMT divergence</CheckItem>
              <CheckItem>Scenario framing: what confirms the bull case, what confirms the bear case</CheckItem>
            </ul>
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">
              What it deliberately is not
            </h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>No price targets with confidence intervals we cannot support</CheckItem>
              <CheckItem>No &quot;gold to $X&quot; headlines engineered for clicks</CheckItem>
              <CheckItem>No predictions about central bank policy dressed up as analysis</CheckItem>
              <CheckItem>No guarantee language — ever</CheckItem>
            </ul>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              This discipline is part of our{" "}
              <Link href="/about" className="text-gold hover:underline">
                methodology commitments
              </Link>
              .
            </p>
          </Card>
        </div>
      </Section>

      {/* Scenarios */}
      <Section ariaLabel="Scenario-based analysis">
        <SectionHeading
          eyebrow="Method"
          title="Scenarios over predictions"
          lede="Structural analysis produces if/then scenarios, not prophecies. That framing keeps the analysis honest and immediately actionable: each scenario names the structural evidence that would confirm it."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            {
              t: "Bullish continuation scenario",
              b: "Daily range expanding, price holding discount retracements, New York sessions absorbing dips into FVGs. Confirmation: fresh daily BOS above the last higher high with displacement.",
            },
            {
              t: "Reversal scenario",
              b: "A sweep of the daily high (or low) followed by a 1-hour MSS, ideally with silver refusing to confirm (SMT). Confirmation: close-based structure break plus retrace into the displacement zone.",
            },
            {
              t: "Balance scenario",
              b: "Price orbiting equilibrium with matched highs and lows on the 1-hour. Response: no forced trades — mark the accumulating pools and wait for the raid.",
            },
          ].map((s) => (
            <Card key={s.t} className="h-full">
              <h3 className="font-semibold text-foreground">{s.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Let the engine run this framework for you"
          body="The terminal computes every layer above in real time and logs structural events automatically — so you spend your attention on decisions, not on drawing boxes."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/xauusd", label: "Back to XAUUSD guide" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
