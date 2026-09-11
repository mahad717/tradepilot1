import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";
import { articles } from "@/lib/articles";

/**
 * Auto-generated sitemap. Includes only canonical, indexable public
 * pages — never the dashboard, private signals/backtests, auth or API
 * routes. New articles published to the content system appear here
 * automatically with their updated dates.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: {
    path: string;
    priority: number;
    changeFrequency: "daily" | "weekly" | "monthly";
  }[] = [
    { path: "", priority: 1.0, changeFrequency: "daily" },
    { path: "/xauusd", priority: 0.9, changeFrequency: "weekly" },
    { path: "/xagusd", priority: 0.9, changeFrequency: "weekly" },
    { path: "/xauusd-signals", priority: 0.9, changeFrequency: "daily" },
    { path: "/xagusd-signals", priority: 0.9, changeFrequency: "daily" },
    { path: "/gold-analysis", priority: 0.8, changeFrequency: "weekly" },
    { path: "/silver-analysis", priority: 0.8, changeFrequency: "weekly" },
    { path: "/ict-strategy", priority: 0.8, changeFrequency: "monthly" },
    { path: "/ict-backtesting", priority: 0.8, changeFrequency: "monthly" },
    { path: "/ict-concepts", priority: 0.8, changeFrequency: "monthly" },
    { path: "/blog", priority: 0.8, changeFrequency: "weekly" },
    { path: "/pricing", priority: 0.7, changeFrequency: "monthly" },
    { path: "/faq", priority: 0.6, changeFrequency: "monthly" },
    { path: "/about", priority: 0.5, changeFrequency: "monthly" },
    { path: "/privacy", priority: 0.2, changeFrequency: "monthly" },
    { path: "/terms", priority: 0.2, changeFrequency: "monthly" },
  ];

  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((r) => ({
    url: `${siteConfig.url}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const articleEntries: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${siteConfig.url}/blog/${a.slug}`,
    lastModified: new Date(a.updatedAt),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticEntries, ...articleEntries];
}
