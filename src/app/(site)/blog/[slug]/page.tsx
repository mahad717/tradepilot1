import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo";
import { Container, Section, CtaBanner } from "@/components/site/ui";
import { RiskDisclaimer } from "@/components/site/risk-disclaimer";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { ArticleRenderer } from "@/components/site/article-renderer";
import { JsonLd } from "@/components/seo/json-ld";
import { articleSchema } from "@/lib/schema";
import { articles, getArticleBySlug, getRelatedArticles } from "@/lib/articles";

export const dynamicParams = false;

/** Pre-render every article at build time (SSG) for maximum crawlability. */
export function generateStaticParams() {
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) return {};

  return buildMetadata({
    title: article.seoTitle,
    description: article.seoDescription,
    path: `/blog/${article.slug}`,
    keywords: article.tags,
    type: "article",
    publishedTime: article.publishedAt,
    modifiedTime: article.updatedAt,
    authors: [article.author],
  });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) notFound();

  const related = getRelatedArticles(article);

  return (
    <>
      <JsonLd
        data={articleSchema({
          title: article.title,
          description: article.seoDescription,
          path: `/blog/${article.slug}`,
          author: article.author,
          publishedAt: article.publishedAt,
          updatedAt: article.updatedAt,
          image: `/blog/${article.slug}/opengraph-image`,
          section: article.category,
          keywords: article.tags,
        })}
      />

      <Container className="pt-8">
        <Breadcrumbs
          items={[
            { name: "Blog", path: "/blog" },
            { name: article.category, path: `/blog/${article.slug}` },
          ]}
        />
      </Container>

      <article className="pt-6">
        <Container>
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-gold">
              {article.category}
            </p>
            <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight sm:text-[2.1rem] sm:leading-[1.2]">
              {article.title}
            </h1>
            <p className="mt-4 text-[16.5px] leading-7 text-muted-foreground">
              {article.excerpt}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-6 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{article.author}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
              {article.updatedAt !== article.publishedAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Updated <time dateTime={article.updatedAt}>{formatDate(article.updatedAt)}</time>
                  </span>
                </>
              ) : null}
              <span aria-hidden="true">·</span>
              <span>{article.readingMinutes} min read</span>
            </div>
          </div>
        </Container>

        <Container className="pt-10">
          <div className="mx-auto max-w-3xl">
            <ArticleRenderer blocks={article.content} />

            <div className="mt-10 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-12 rounded-xl border border-border bg-card p-6">
              <p className="text-sm font-semibold text-foreground">
                About the author
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {article.author} produces TradePilot&apos;s educational
                content: rule-based ICT and Smart Money Concepts analysis for
                gold and silver, grounded in the platform&apos;s backtested
                methodology. All guides are reviewed for accuracy against the
                engine&apos;s documented rules and carry no profit promises.
              </p>
            </div>
          </div>
        </Container>
      </article>

      <Section ariaLabel="Related reading" className="pt-14">
        <Container>
          <div className="mx-auto max-w-3xl">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Continue reading
            </h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-3">
              {related.map((rel) => (
                <Link key={rel.slug} href={`/blog/${rel.slug}`} className="group">
                  <div className="h-full rounded-xl border border-border bg-card p-5 transition-colors group-hover:border-gold/50">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gold">
                      {rel.category}
                    </p>
                    <h3 className="mt-2 text-sm font-semibold leading-6 text-foreground">
                      {rel.title}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section ariaLabel="Get started" className="pt-0">
        <Container>
          <div className="mx-auto max-w-3xl">
            <CtaBanner
              title="See this concept in the engine"
              body="The terminal detects this exact pattern on live XAUUSD and XAGUSD data — and shows its backtested history for every rule."
              primary={{ href: "/dashboard", label: "Open the terminal" }}
              secondary={{ href: "/blog", label: "More guides" }}
            />
          </div>
        </Container>
      </Section>

      <RiskDisclaimer />
    </>
  );
}
