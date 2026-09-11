import "server-only";
import a1 from "@/content/articles/what-is-a-liquidity-sweep.json";
import a2 from "@/content/articles/what-is-a-fair-value-gap.json";
import a3 from "@/content/articles/what-is-an-order-block.json";
import a4 from "@/content/articles/market-structure-shift-vs-break-of-structure.json";
import a5 from "@/content/articles/premium-and-discount-explained.json";
import a6 from "@/content/articles/smt-divergence-between-gold-and-silver.json";
import a7 from "@/content/articles/how-to-backtest-xauusd-strategies.json";
import a8 from "@/content/articles/gold-session-behavior-asia-london-new-york.json";

export interface Article {
  slug: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  excerpt: string;
  category: string;
  tags: string[];
  author: string;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  featured?: boolean;
  content: Block[];
}

export type Block =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; variant: "info" | "warning"; title: string; text: string }
  | { type: "diagram"; id: DiagramId; caption: string }
  | { type: "links"; title: string; items: { href: string; text: string }[] };

export type DiagramId =
  | "liquidity-sweep"
  | "fair-value-gap"
  | "order-block"
  | "market-structure"
  | "premium-discount"
  | "smt-divergence";

const FILES = [
  a1, a2, a3, a4, a5, a6, a7, a8,
] as unknown as Article[];

/**
 * Structured content system: each article is a JSON file in
 * src/content/articles/. Publishing a new article = adding one JSON
 * file and registering it above — no application code changes.
 * The blog index and sitemap.xml derive automatically from this list.
 */
export const articles: Article[] = FILES.sort(
  (a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)
);

export function getArticleBySlug(slug: string): Article | undefined {
  return articles.find((a) => a.slug === slug);
}

export function getArticleSlugs(): string[] {
  return articles.map((a) => a.slug);
}

export function getRelatedArticles(current: Article, count = 3): Article[] {
  const sameCategory = articles.filter(
    (a) => a.slug !== current.slug && a.category === current.category
  );
  const others = articles.filter(
    (a) => a.slug !== current.slug && a.category !== current.category
  );
  return [...sameCategory, ...others].slice(0, count);
}
