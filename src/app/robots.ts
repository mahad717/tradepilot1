import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

/**
 * robots.txt — allows crawling of all public content while blocking
 * the authenticated application, private areas and API endpoints.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/settings",
          "/api/",
          "/auth",
          "/signals/private",
          "/backtest/private",
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
