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
} from "@/components/site/ui";
import { RiskDisclaimer } from "@/components/site/risk-disclaimer";
import { Breadcrumbs } from "@/components/site/breadcrumbs";

export const metadata: Metadata = buildMetadata({
  title: "About TradePilot: Transparent, Rule-Based Market Analysis",
  description:
    "Who we are and how TradePilot works: rule-based ICT analysis for gold and silver, published methodology, backtested rules and honest limits — no profit guarantees, ever.",
  path: "/about",
  keywords: ["about TradePilot", "ICT platform", "transparent trading analysis"],
});

export default function AboutPage() {
  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs items={[{ name: "About", path: "/about" }]} />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>About</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            About TradePilot:{" "}
            <span className="text-gold">rules in the open, evidence over promises</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[17px]">
            TradePilot exists because retail traders deserve better than
            screenshot marketing. We build systematic ICT analysis for gold and
            silver, publish the rules behind every output, and tell you
            plainly what the model can and cannot do.
          </p>
        </div>
      </Container>

      <Section ariaLabel="Our approach">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="What we do"
              title="Systematic analysis, published methodology"
              lede="The engine implements the sweep–MSS–retrace model — the practical core of ICT and Smart Money Concepts — as explicit, binary rules on XAUUSD and XAGUSD. It maps liquidity, verifies sweeps, requires structure confirmation, and grades every qualifying setup against its backtested history."
            />
            <p className="mt-4 text-[15.5px] leading-7 text-muted-foreground">
              Every signal carries its context: the pool that was swept, the
              structure that confirmed it, the entry zone, the invalidation and
              a quality score with its factors listed. When we are wrong, the
              rules and data show that too. You can study the full model in the{" "}
              <Link href="/ict-strategy" className="text-gold hover:underline">
                ICT strategy guide
              </Link>{" "}
              and every concept in the{" "}
              <Link href="/ict-concepts" className="text-gold hover:underline">
                glossary
              </Link>{" "}
              — free, with no signup.
            </p>
          </div>
          <div>
            <SectionHeading
              eyebrow="What we won't do"
              title="The claims you will never see here"
              lede="Financial content creates real obligations. Ours are non-negotiable:"
            />
            <Card className="mt-4">
              <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-bear" />
                  Never &quot;100% accurate signals&quot; or &quot;guaranteed profits&quot; — such claims are always false.
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-bear" />
                  Never &quot;risk-free trading&quot; — all leveraged trading carries substantial risk of loss.
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-bear" />
                  Never cherry-picked win rates — we report expectancy and drawdown, or nothing.
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-bear" />
                  Never trading advice or fund management — we build analysis software, you make decisions.
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </Section>

      <Section
        ariaLabel="How we build"
        className="border-y border-border bg-[oklch(0.17_0.01_260)]"
      >
        <SectionHeading
          eyebrow="Principles"
          title="Four commitments behind the product"
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              t: "Rules, not opinions",
              b: "Every output traces to a written, binary rule. If it can't be tested, it doesn't ship.",
            },
            {
              t: "Evidence, not screenshots",
              b: "Backtests run bar-by-bar with realistic costs and are reported with their limitations attached.",
            },
            {
              t: "Education is free",
              b: "The glossary, guides and methodology are open. Paying users buy the live engine, not the knowledge.",
            },
            {
              t: "The trader stays in charge",
              b: "No auto-trading, no fund management, no custody. Analysis software only — decisions and risk remain yours.",
            },
          ].map((p) => (
            <Card key={p.t} className="h-full">
              <h3 className="font-semibold text-foreground">{p.t}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{p.b}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section ariaLabel="Contact and next steps">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Team"
              title="Who builds TradePilot"
              lede="TradePilot is built by a small team of systematic traders and engineers who got tired of signal services that hide their logic. We publish our research notes in the blog and iterate on the model openly — including retiring rules when the data stops supporting them."
            />
            <CtaRow
              className="mt-8"
              primary={{ href: "/blog", label: "Read the research" }}
              secondary={{ href: "/faq", label: "Common questions" }}
            />
          </div>
          <div>
            <SectionHeading
              eyebrow="Start here"
              title="Two paths into the platform"
              lede="If you are new to ICT, begin with the strategy guide and the free knowledge base. If you already know the model, the terminal and backtester are the fastest way to see what we do."
            />
            <CtaRow
              className="mt-8"
              primary={{ href: "/dashboard", label: "Open the terminal" }}
              secondary={{ href: "/ict-strategy", label: "Learn the model" }}
            />
          </div>
        </div>
      </Section>

      <RiskDisclaimer />
    </>
  );
}
