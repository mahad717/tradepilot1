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
  title: "XAUUSD Analysis: Gold Liquidity, Structure & ICT Setups | TradePilot",
  description:
    "Learn how XAUUSD really moves: session behavior, gold liquidity pools, sweeps, FVGs and order blocks — and how rule-based ICT analysis is applied to gold.",
  path: "/xauusd",
  keywords: [
    "XAUUSD",
    "gold trading",
    "XAUUSD technical analysis",
    "gold liquidity",
    "ICT gold",
  ],
});

const GOLD_FAQS = [
  {
    question: "What is XAUUSD?",
    answer:
      "XAUUSD is the gold price quoted in U.S. dollars per troy ounce. It is one of the most liquid commodities in the world, traded around the clock five days a week through spot, futures and CFD markets.",
  },
  {
    question: "How is gold liquidity different from forex pairs?",
    answer:
      "Gold's liquidity is strongly session-driven: Asian hours build narrow ranges, the London open frequently raids those ranges for stops, and New York delivers the largest volume around U.S. data. This creates repeatable liquidity patterns at session extremes.",
  },
  {
    question: "Do ICT concepts really work on gold?",
    answer:
      "Gold's tendency to sweep obvious highs and lows before reversing makes it a natural fit for liquidity-based models. The honest answer is that concepts are only as good as their rules — which is why every rule in our engine is backtested and published, and why past performance never guarantees future results.",
  },
];

export default function XauusdPage() {
  return (
    <>
      <JsonLd data={faqPageSchema(GOLD_FAQS)} />

      <Container className="pt-8">
        <Breadcrumbs items={[{ name: "XAUUSD", path: "/xauusd" }]} />
      </Container>

      {/* Hero */}
      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Gold · XAUUSD</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            XAUUSD analysis through the lens of{" "}
            <span className="text-gold">gold liquidity and ICT structure</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            Gold rewards traders who understand where its liquidity rests and
            when that liquidity gets raided. This page explains how XAUUSD
            actually behaves — session by session — and how TradePilot turns
            that behavior into rule-based analysis and signals.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/xauusd-signals", label: "See XAUUSD signals" }}
            secondary={{ href: "/gold-analysis", label: "Gold analysis framework" }}
          />
        </div>
      </Container>

      {/* What is XAUUSD */}
      <Section ariaLabel="What is XAUUSD">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="The instrument"
              title="What is XAUUSD?"
              lede="XAUUSD is the spot price of gold quoted in U.S. dollars per troy ounce. It trades nearly 24 hours a day, five days a week, and is driven by real interest rates, the U.S. dollar, central bank demand, and safe-haven flows — which is why its character changes sharply between sessions."
            />
            <p className="mt-4 max-w-3xl text-[15.5px] leading-7 text-muted-foreground">
              For the intraday trader, two properties matter most. First,
              gold&apos;s deep liquidity makes its structure readable: swings,
              ranges and pools form cleanly. Second, its liquidity is{" "}
              <strong className="text-foreground">time-of-day dependent</strong>{" "}
              — the same technical level behaves very differently at 2 a.m. and
              at 9:30 a.m. New York time. Both properties are exactly what a
              liquidity-based ICT model needs.
            </p>
          </div>
          <Card className="h-fit">
            <h3 className="font-semibold text-foreground">Gold at a glance</h3>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ["Ticker", "XAUUSD (spot gold, USD per ounce)"],
                ["Active sessions", "Asia (build), London (raid), New York (decide)"],
                ["Key liquidity pools", "Equal highs/lows, session extremes, prior day high/low"],
                ["Volatility windows", "London open, NY open, U.S. data releases"],
                ["Model fit", "Sweep → MSS → retrace into FVG / order block"],
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

      {/* Gold liquidity */}
      <Section
        ariaLabel="How gold liquidity works"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <SectionHeading
          eyebrow="Liquidity"
          title="How gold liquidity works"
          lede="Large participants cannot fill size at a single price — they need clusters of resting orders. Gold's session rhythm concentrates those clusters in predictable places, which is what a systematic model exploits."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            {
              t: "Session extremes",
              b: "The Asian high and low accumulate stops from range traders all night. The London open frequently raids them first — the classic gold sweep.",
            },
            {
              t: "Equal highs and lows",
              b: "Visible double tops and bottoms on gold are among the most heavily populated pools in any market, because everyone can see them and everyone hides stops behind them.",
            },
            {
              t: "Data-release extremes",
              b: "CPI, NFP and FOMC create violent one-sided moves whose extremes become the pools that the following sessions either build on or sweep.",
            },
          ].map((item) => (
            <Card key={item.t} className="h-full">
              <h3 className="font-semibold text-foreground">{item.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.b}</p>
            </Card>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-[15.5px] leading-7 text-muted-foreground">
          Want the deep dive? Read{" "}
          <Link href="/blog/what-is-a-liquidity-sweep" className="text-gold hover:underline">
            what a liquidity sweep actually is
          </Link>{" "}
          and how{" "}
          <Link href="/blog/gold-session-behavior-asia-london-new-york" className="text-gold hover:underline">
            gold behaves in each session
          </Link>
          .
        </p>
      </Section>

      {/* ICT applied to gold */}
      <Section ariaLabel="How ICT concepts apply to gold">
        <SectionHeading
          eyebrow="ICT on gold"
          title="How ICT concepts apply to gold"
          lede="Each concept in the model has a gold-specific expression. Here is the short version of each — with links to full guides."
        />
        <div className="mt-8 space-y-8">
          {[
            {
              h3: "Identifying gold liquidity sweeps",
              body: "Mark the Asian range and prior session extremes before London. When gold pierces an extreme with a long wick and closes back inside, the sweep template activates. The confirmation — a displacement leg breaking the nearest opposing swing (MSS) — is what separates a tradeable sweep from a genuine breakout.",
              href: "/blog/what-is-a-liquidity-sweep",
              link: "Read: What is a liquidity sweep?",
            },
            {
              h3: "XAUUSD fair value gaps",
              body: "Gold's impulsive displacement candles regularly leave three-candle inefficiencies. The gaps that matter form at the origin of post-sweep moves, inside Kill Zone hours, and align with the higher-timeframe direction. We treat them as entry refinement, never as standalone signals.",
              href: "/blog/what-is-a-fair-value-gap",
              link: "Read: What is a fair value gap?",
            },
            {
              h3: "XAUUSD order blocks",
              body: "The last opposing candle before gold's displacement legs often marks where institutional programs filled. Blocks overlapped by FVGs, sitting in discount (for longs) of the dealing range, produce the highest-quality reactions in our testing.",
              href: "/blog/what-is-an-order-block",
              link: "Read: What is an order block?",
            },
            {
              h3: "Gold session behavior",
              body: "Asia builds, London raids, New York decides. The session map tells you which setups are plausible at which hour — and when the honest answer is to stop trading.",
              href: "/blog/gold-session-behavior-asia-london-new-york",
              link: "Read: Gold session behavior guide",
            },
          ].map((row) => (
            <div
              key={row.h3}
              className="grid gap-3 border-b border-border pb-8 md:grid-cols-[1fr_2fr] md:gap-10"
            >
              <h3 className="text-lg font-semibold text-foreground">{row.h3}</h3>
              <div>
                <p className="text-[15.5px] leading-7 text-muted-foreground">{row.body}</p>
                <Link
                  href={row.href}
                  className="mt-2 inline-block text-sm font-medium text-gold hover:underline"
                >
                  {row.link} →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Engine section */}
      <Section
        ariaLabel="How the gold signal engine works"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="From analysis to signals"
              title="How our XAUUSD signal engine works"
              lede="The engine applies the model above mechanically: pools mapped in advance, sweeps verified by closes, reversal confirmed by MSS, entries refined into FVGs and order blocks — then every setup graded on context and backtested history."
            />
            <ul className="mt-6 space-y-2.5">
              <CheckItem>Session-tagged liquidity map for gold, updated continuously</CheckItem>
              <CheckItem>Sweep + MSS confirmation required on every setup</CheckItem>
              <CheckItem>XAU/XAG SMT divergence checked at every key level</CheckItem>
              <CheckItem>Transparent quality score with visible reasoning</CheckItem>
            </ul>
            <CtaRow
              className="mt-8"
              primary={{ href: "/xauusd-signals", label: "Explore XAUUSD signals" }}
              secondary={{ href: "/ict-backtesting", label: "See the backtests" }}
            />
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">What a signal includes</h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Directional bias with the higher-timeframe context</CheckItem>
              <CheckItem>The liquidity pool that was swept, and when</CheckItem>
              <CheckItem>Entry zone (FVG or order block) and invalidation level</CheckItem>
              <CheckItem>Quality score with the factors behind it</CheckItem>
            </ul>
          </Card>
        </div>
      </Section>

      {/* FAQ */}
      <Section ariaLabel="XAUUSD FAQ">
        <SectionHeading eyebrow="FAQ" title="Gold trading questions" />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {GOLD_FAQS.map((f) => (
            <Card key={f.question}>
              <h3 className="font-semibold text-foreground">{f.question}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.answer}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Study gold with the model, not the noise"
          body="Open the terminal to explore gold signals, replay historical sessions and test the sweep–MSS–retrace model on years of XAUUSD data."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/blog", label: "Read the guides" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
