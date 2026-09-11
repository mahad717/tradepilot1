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
  title: "ICT Backtesting for Gold & Silver: Bar Replay Without Look-Ahead | TradePilot",
  description:
    "How ICT backtesting works on TradePilot: bar-replay evaluation, zero look-ahead bias, realistic costs, and expectancy-based results for XAUUSD and XAGUSD strategies.",
  path: "/ict-backtesting",
  keywords: [
    "ICT backtesting",
    "forex backtesting",
    "gold backtesting",
    "silver backtesting",
    "backtest XAUUSD",
    "look-ahead bias",
  ],
});

const BT_FAQS = [
  {
    question: "Can I backtest ICT strategies?",
    answer:
      "Yes. The TradePilot backtester runs the sweep–MSS–retrace model bar-by-bar on historical XAUUSD and XAGUSD data, and you can run the same workflow manually with our free guide.",
  },
  {
    question: "How do you avoid look-ahead bias?",
    answer:
      "Bar-replay evaluation: the engine only ever sees candles up to the timestamp it is deciding on. Session levels, pools and confirmations are computed from data available at that moment — never from the future.",
  },
  {
    question: "Why is backtesting accuracy important?",
    answer:
      "Because a biased backtest manufactures confidence in a strategy that does not work. Realistic costs, honest timestamps and enough samples are the difference between an edge and an illusion.",
  },
];

export default function IctBacktestingPage() {
  return (
    <>
      <JsonLd data={faqPageSchema(BT_FAQS)} />

      <Container className="pt-8">
        <Breadcrumbs
          items={[{ name: "ICT backtesting", path: "/ict-backtesting" }]}
        />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Backtesting</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            ICT backtesting for gold &amp; silver:{" "}
            <span className="text-gold">no look-ahead, no excuses</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            Backtesting is how an opinion becomes a number. Our engine tests
            the sweep–MSS–retrace model on years of XAUUSD and XAGUSD history
            under bar-replay discipline — and publishes expectancy, not
            marketing.
          </p>
          <CtaRow
            className="mt-8"
            primary={{ href: "/dashboard", label: "Open the backtester" }}
            secondary={{ href: "/blog/how-to-backtest-xauusd-strategies", label: "Read the DIY guide" }}
          />
        </div>
      </Container>

      {/* How it works */}
      <Section ariaLabel="How ICT backtesting works">
        <SectionHeading
          eyebrow="Methodology"
          title="How our ICT backtesting works"
          lede="Four disciplines separate an honest test from a self-deceiving one. Each is built into the engine, not left to the analyst's good intentions."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {[
            {
              t: "Bar replay, candle by candle",
              b: "The engine evaluates each timestamp with only the history visible up to that point. Pools, sweeps and confirmations are computed from information available at decision time — the future is structurally invisible.",
            },
            {
              t: "Zero look-ahead tolerance",
              b: "No marking equal highs that only became equal later, no session levels computed after the close, no confirmation candles used as entry candles. Every rule is timestamp-audited.",
            },
            {
              t: "Realistic cost modeling",
              b: "Gold and silver spreads widen around news; fills slip. The engine applies spread and slippage models per session and per volatility regime instead of a flat fantasy cost.",
            },
            {
              t: "Sample breadth requirements",
              b: "Results are computed across trending and ranging regimes, across sessions, and over multi-year spans. A strategy that only works in London on trending weeks is reported as exactly that.",
            },
          ].map((item) => (
            <Card key={item.t} className="h-full">
              <h3 className="font-semibold text-foreground">{item.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* Metrics */}
      <Section
        ariaLabel="Metrics that matter"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Measurement"
              title="Win rate vs expectancy — we report the right one"
              lede="Win rate flatters losing strategies. Expectancy — the average R earned per trade over many samples — is the only headline number that can't lie when the sample is honest."
            />
            <p className="mt-4 text-[15.5px] leading-7 text-muted-foreground">
              Every backtest report includes expectancy (R per trade), profit
              factor, maximum drawdown, trade count, and the breakdowns by
              session, setup grade and regime. Where a rule fails — for
              example, during low-volatility holiday weeks — the report says
              so. This is also exactly how our{" "}
              <Link href="/xauusd-signals" className="text-gold hover:underline">
                signal quality scores
              </Link>{" "}
              are calibrated.
            </p>
          </div>
          <Card>
            <h3 className="font-semibold text-foreground">Report contents</h3>
            <ul className="mt-4 space-y-2">
              <CheckItem>Expectancy per trade (R) with confidence context</CheckItem>
              <CheckItem>Profit factor and maximum drawdown</CheckItem>
              <CheckItem>Session split: London / New York / other</CheckItem>
              <CheckItem>Regime split: trending vs balanced periods</CheckItem>
              <CheckItem>Parameter sensitivity: the same rules, shifted slightly</CheckItem>
            </ul>
          </Card>
        </div>
      </Section>

      {/* How to backtest XAUUSD / XAGUSD */}
      <Section ariaLabel="How to backtest XAUUSD and XAGUSD">
        <SectionHeading
          eyebrow="DIY"
          title="How to backtest XAUUSD and XAGUSD yourself"
          lede="You don't need proprietary tools to test ICT ideas honestly — you need rules, replay discipline and a spreadsheet. Our full walkthrough teaches the process; here is the skeleton."
        />
        <ol className="mt-8 space-y-4">
          {[
            "Write every rule as a binary condition — sweep definition, MSS requirement, entry trigger, invalidation.",
            "Use bar replay on a tick-data or high-fidelity feed; never mark setups on a fully visible chart.",
            "Collect 100–200 samples across at least a year, logging date, session, grade, outcome and a screenshot per trade.",
            "Compute expectancy, profit factor and drawdown; split results by session and regime.",
            "Stress it: add realistic costs, shift parameters slightly, and forward-test outside the sample before trusting anything.",
          ].map((step, i) => (
            <li key={i} className="flex gap-4 border-b border-border pb-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/50 font-mono text-xs text-gold">
                {i + 1}
              </span>
              <span className="text-[15px] leading-7 text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-3xl text-[15.5px] leading-7 text-muted-foreground">
          The detailed version — including the subtle look-ahead traps — is in{" "}
          <Link href="/blog/how-to-backtest-xauusd-strategies" className="text-gold hover:underline">
            how to backtest XAUUSD strategies
          </Link>
          . The same process applies to silver via{" "}
          <Link href="/xagusd-signals" className="text-gold hover:underline">
            XAGUSD
          </Link>
          .
        </p>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Test the model on years of metals history"
          body="Open the terminal to replay historical gold and silver sessions, inspect every rule firing, and read the engine's honest results — expectancy and drawdown included."
          primary={{ href: "/dashboard", label: "Open the backtester" }}
          secondary={{ href: "/pricing", label: "View pricing" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
