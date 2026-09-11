import Link from "next/link";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { Container, Section, Pill, CtaBanner } from "@/components/site/ui";
import { RiskDisclaimer } from "@/components/site/risk-disclaimer";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { Card } from "@/components/site/ui";
import { articles } from "@/lib/articles";

export const metadata: Metadata = buildMetadata({
  title: "TradePilot Blog: ICT, SMC, Gold & Silver Trading Education",
  description:
    "Free, in-depth guides on ICT and Smart Money Concepts, XAUUSD and XAGUSD analysis, liquidity sweeps, fair value gaps, order blocks, SMT divergence and backtesting.",
  path: "/blog",
  keywords: [
    "ICT blog",
    "gold trading education",
    "silver trading guides",
    "SMC articles",
  ],
});

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogIndexPage() {
  const featured = articles.filter((a) => a.featured).slice(0, 2);
  const rest = articles.filter((a) => !featured.includes(a));

  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs items={[{ name: "Blog", path: "/blog" }]} />
      </Container>

      <Container className="pt-6">
        <div className="max-w-3xl">
          <Pill>Knowledge base</Pill>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            ICT, gold &amp; silver education{" "}
            <span className="text-gold">written for humans first</span>
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">
            Practical guides on the concepts the engine uses — each with rules,
            diagrams and honest discussion of what works and what doesn&apos;t.
            No thin marketing fluff.
          </p>
        </div>
      </Container>

      <Section ariaLabel="Featured articles">
        <div className="grid gap-5 md:grid-cols-2">
          {featured.map((article) => (
            <Link key={article.slug} href={`/blog/${article.slug}`} className="group">
              <Card className="h-full transition-colors group-hover:border-gold/50">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold">
                  {article.category} · Featured
                </p>
                <h2 className="mt-2 text-lg font-semibold leading-7 text-foreground">
                  {article.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {article.excerpt}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  {article.author} · {formatDate(article.publishedAt)} ·{" "}
                  {article.readingMinutes} min read
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section ariaLabel="All articles" className="pt-0">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((article) => (
            <Link key={article.slug} href={`/blog/${article.slug}`} className="group">
              <Card className="h-full transition-colors group-hover:border-gold/50">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold">
                  {article.category}
                </p>
                <h2 className="mt-2 font-semibold leading-6 text-foreground">
                  {article.title}
                </h2>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {article.excerpt}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  {formatDate(article.publishedAt)} · {article.readingMinutes} min read
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <CtaBanner
          title="Reading about the model is step one"
          body="Open the terminal to watch the same concepts compute on live gold and silver structure — free plan included."
          primary={{ href: "/dashboard", label: "Open the terminal" }}
          secondary={{ href: "/ict-concepts", label: "Start with the glossary" }}
        />
      </Section>

      <RiskDisclaimer />
    </>
  );
}
