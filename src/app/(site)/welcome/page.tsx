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
import { JsonLd } from "@/components/seo/json-ld";
import { webApplicationSchema } from "@/lib/schema";
import { articles } from "@/lib/articles";
import { LiquiditySweepDiagram } from "@/components/site/diagrams-price";

export const metadata: Metadata = buildMetadata({
  title: "XAUUSD & XAGUSD ICT Signals, Analysis and Backtesting | TradePilot",
  description:
    "Rule-based XAUUSD and XAGUSD signals built on ICT and Smart Money Concepts — liquidity sweeps, market structure, FVGs and order blocks — with honest backtesting.",
  // The live terminal is the front page ( src/app/(app)/page.tsx ); this
  // marketing landing now lives at /welcome — canonical must match or the
  // page would declare itself a duplicate of "/".
  path: "/welcome",
  keywords: [
    "XAUUSD signals",
    "XAGUSD signals",
    "gold trading signals",
    "silver trading signals",
    "ICT trading strategy",
    "smart money concepts",
    "gold backtesting",
  ],
});

const STEPS = [
  {
    title: "Map the liquidity",
    body: "The engine charts resting liquidity around equal highs and lows, session extremes and prior day/week levels on XAUUSD and XAGUSD — the pools that large orders hunt.",
  },
  {
    title: "Detect the sweep",
    body: "When price pierces a marked pool, the engine waits for the response: a close back inside the range that shows the move found no acceptance.",
  },
  {
    title: "Confirm with structure",
    body: "A market structure shift (MSS) with genuine displacement must follow the sweep. No confirmation, no setup — the engine simply stands aside.",
  },
  {
    title: "Score and publish",
    body: "Qualified setups are graded against historical backtest performance across context factors — session, SMT divergence, premium/discount — and published with full transparency.",
  },
];

const CONCEPTS = [
  { name: "Liquidity sweeps", href: "/blog/what-is-a-liquidity-sweep" },
  { name: "Fair value gaps", href: "/blog/what-is-a-fair-value-gap" },
  { name: "Order blocks", href: "/blog/what-is-an-order-block" },
  { name: "MSS & BOS", href: "/blog/market-structure-shift-vs-break-of-structure" },
  { name: "Premium & discount", href: "/blog/premium-and-discount-explained" },
  { name: "SMT divergence", href: "/blog/smt-divergence-between-gold-and-silver" },
  { name: "Kill Zones & sessions", href: "/blog/gold-session-behavior-asia-london-new-york" },
  { name: "Full glossary", href: "/ict-concepts" },
];

export default function HomePage() {
  const latestArticles = articles.slice(0, 3);

  return (
    <>
      <JsonLd data={webApplicationSchema()} />

      {/* ---------------- Hero ---------------- */}
      <Container className="pt-14 pb-4 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <Pill>ICT &amp; Smart Money Concepts · Engineered</Pill>
            <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem]">
              Rule-based{" "}
              <span className="text-gold">XAUUSD &amp; XAGUSD signals</span>{" "}
              built on ICT analysis
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-[17px]">
              TradePilot watches gold and silver the way a systematic ICT
              trader would: mapping liquidity, detecting sweeps, confirming
              with market structure shifts — then publishing every setup with
              its rules, its context and its backtested history.
            </p>
            <CtaRow
              className="mt-8"
              primary={{ href: "/xauusd-signals", label: "Explore XAUUSD signals" }}
              secondary={{ href: "/ict-strategy", label: "Learn the ICT model" }}
            />
            <p className="mt-5 text-sm text-muted-foreground">
              Transparent quality scores · Historically backtested ·{" "}
              <Link href="/faq" className="text-gold hover:underline">
                No profit guarantees
              </Link>
            </p>
          </div>
          <LiquiditySweepDiagram className="hidden lg:block" />
        </div>
      </Container>

      {/* ---------------- Instruments ---------------- */}
      <Section ariaLabel="Covered markets">
        <SectionHeading
          eyebrow="Markets"
          title="Two instruments, one systematic lens"
          lede="We deliberately focus on the two most liquid precious metals, where session structure and liquidity behavior are well defined and can be tested with discipline."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <Link href="/xauusd" className="group">
            <Card className="h-full transition-colors group-hover:border-gold/50">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-foreground">
                  Gold · XAUUSD
                </h3>
                <span className="font-mono text-sm text-gold">/xauusd</span>
              </div>
              <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                How gold liquidity works, why London and New York sessions
                dominate its character, and how sweeps, FVGs and order blocks
                apply to the metals&apos; flagship market.
              </p>
              <ul className="mt-4 space-y-2">
                <CheckItem>Session-based liquidity map and Kill Zone context</CheckItem>
                <CheckItem>Rule-based setups with historical quality scores</CheckItem>
                <CheckItem>Dedicated gold analysis framework</CheckItem>
              </ul>
            </Card>
          </Link>
          <Link href="/xagusd" className="group">
            <Card className="h-full transition-colors group-hover:border-gold/50">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-foreground">
                  Silver · XAGUSD
                </h3>
                <span className="font-mono text-sm text-gold">/xagusd</span>
              </div>
              <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                Silver&apos;s amplified structure, its liquidity profile, and the
                XAU/XAG SMT divergence that turns the two metals into a
                confirmation pair.
              </p>
              <ul className="mt-4 space-y-2">
                <CheckItem>Silver market structure and volatility handling</CheckItem>
                <CheckItem>XAU/XAG SMT divergence monitoring</CheckItem>
                <CheckItem>Dedicated silver analysis framework</CheckItem>
              </ul>
            </Card>
          </Link>
        </div>
      </Section>

      {/* ---------------- How the engine works ---------------- */}
      <Section ariaLabel="How the signal engine works" className="border-y border-border bg-[oklch(0.17_0.01_260)]">
        <SectionHeading
          eyebrow="Methodology"
          title="How the signal engine works"
          lede="Every signal follows the same four-stage pipeline. The stages are rules, not opinions — which is what makes the output auditable and backtestable."
        />
        <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full">
                <span className="font-mono text-sm text-gold">
                  0{i + 1}
                </span>
                <h3 className="mt-2 font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </Card>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-3xl text-[15px] leading-7 text-muted-foreground">
          The same pipeline is documented in detail on the{" "}
          <Link href="/xauusd-signals" className="text-gold hover:underline">
            XAUUSD signals
          </Link>{" "}
          and{" "}
          <Link href="/xagusd-signals" className="text-gold hover:underline">
            XAGUSD signals
          </Link>{" "}
          pages, and its historical performance is published via{" "}
          <Link href="/ict-backtesting" className="text-gold hover:underline">
            ICT backtesting
          </Link>
          .
        </p>
      </Section>

      {/* ---------------- Concepts ---------------- */}
      <Section ariaLabel="ICT concepts used">
        <SectionHeading
          eyebrow="Education"
          title="The ICT concepts behind every setup"
          lede="We teach the model before we sell the tool. Each concept is explained with rules and diagrams in our free knowledge base."
        />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CONCEPTS.map((c) => (
            <Link
              key={c.href + c.name}
              href={c.href}
              className="rounded-xl border border-border bg-card px-4 py-4 text-center text-sm font-medium text-muted-foreground transition-colors hover:border-gold/50 hover:text-foreground"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </Section>

      {/* ---------------- Backtesting ---------------- */}
      <Section ariaLabel="Backtesting" className="border-y border-border bg-[oklch(0.17_0.01_260)]">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Backtesting"
              title="Backtested, not backfitted"
              lede="Our engine evaluates every rule bar-by-bar on historical gold and silver data — no look-ahead bias, realistic costs included — and reports expectancy and drawdown, never win-rate marketing."
            />
            <ul className="mt-6 space-y-2.5">
              <CheckItem>
                Bar-replay evaluation that mimics real-time decisions
              </CheckItem>
              <CheckItem>
                Cost and slippage modeling for realistic gold spreads
              </CheckItem>
              <CheckItem>
                Results split by session, regime and setup grade
              </CheckItem>
            </ul>
            <CtaRow
              className="mt-8"
              primary={{ href: "/ict-backtesting", label: "See how backtesting works" }}
              secondary={{ href: "/blog/how-to-backtest-xauusd-strategies", label: "Backtest guide" }}
            />
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">Why it matters</h3>
            <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
              Most signal services publish cherry-picked screenshots. We
              publish the <strong className="text-foreground">rules</strong>{" "}
              behind each setup, the{" "}
              <strong className="text-foreground">context factors</strong> that
              shaped its quality score, and the{" "}
              <strong className="text-foreground">historical behavior</strong>{" "}
              of those rules on gold and silver. If a rule stops working, the
              data shows it — and the model gets retested.
            </p>
            <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
              Read our transparent{" "}
              <Link href="/blog/how-to-backtest-xauusd-strategies" className="text-gold hover:underline">
                backtesting methodology
              </Link>{" "}
              to run the same process yourself on any ICT strategy.
            </p>
          </Card>
        </div>
      </Section>

      {/* ---------------- Latest articles ---------------- */}
      <Section ariaLabel="Latest educational articles">
        <SectionHeading
          eyebrow="From the blog"
          title="Latest from the knowledge base"
          lede="Genuinely useful ICT and metals education — written for humans first, linked to the tools."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {latestArticles.map((article) => (
            <Link key={article.slug} href={`/blog/${article.slug}`} className="group">
              <Card className="h-full transition-colors group-hover:border-gold/50">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold">
                  {article.category}
                </p>
                <h3 className="mt-2 font-semibold leading-6 text-foreground">
                  {article.title}
                </h3>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {article.excerpt}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  {article.readingMinutes} min read ·{" "}
                  {new Date(article.publishedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </Card>
            </Link>
          ))}
        </div>
        <p className="mt-6">
          <Link href="/blog" className="text-sm font-medium text-gold hover:underline">
            Browse all articles →
          </Link>
        </p>
      </Section>

      {/* ---------------- FAQ teaser ---------------- */}
      <Section ariaLabel="Frequently asked questions" className="border-y border-border bg-[oklch(0.17_0.01_260)]">
        <SectionHeading
          eyebrow="FAQ"
          title="Questions traders actually ask"
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {[
            {
              q: "What are XAUUSD signals?",
              a: "Systematically generated analysis updates for gold that include directional bias, the liquidity context behind it, entry and invalidation levels, and a transparent quality score.",
            },
            {
              q: "Does TradePilot guarantee profitable trades?",
              a: "No — and anyone who does guarantee profits should be avoided. We publish rules and historical backtests so you can judge the edge yourself.",
            },
            {
              q: "Can I backtest ICT strategies on the platform?",
              a: "Yes. The backtesting engine runs the sweep–MSS–retrace model on historical XAUUSD and XAGUSD data with bar-replay discipline and realistic costs.",
            },
            {
              q: "Do I need ICT experience to use TradePilot?",
              a: "No. Every signal carries its context and reasoning, and the free knowledge base teaches every concept the engine uses.",
            },
          ].map((faq) => (
            <Card key={faq.q}>
              <h3 className="font-semibold text-foreground">{faq.q}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {faq.a}
              </p>
            </Card>
          ))}
        </div>
        <p className="mt-6">
          <Link href="/faq" className="text-sm font-medium text-gold hover:underline">
            Read the full FAQ →
          </Link>
        </p>
      </Section>

      {/* ---------------- CTA ---------------- */}
      <Section ariaLabel="Get started">
        <CtaBanner
          title="See the engine on live gold structure"
          body="Open the terminal to explore signals, run backtests, and study every concept the model uses — starting free."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/pricing", label: "View pricing" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
