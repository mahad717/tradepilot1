import type { Metadata } from "next";
import { siteConfig } from "./site";

export interface SeoInput {
  /** Full, unique page title (recommended: <= 60 characters). */
  title: string;
  /** Unique meta description (recommended: 140–160 characters). */
  description: string;
  /** Canonical path, e.g. "/xauusd". Must be lowercase, hyphenated. */
  path: string;
  /** Extra keywords (used sparingly — content is written for humans first). */
  keywords?: string[];
  /** Set true for private/app pages. */
  noIndex?: boolean;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
}

const maxIndexFollow = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
} as const;

const noIndexFollow = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
} as const;

/**
 * Builds a complete, unique Metadata object for a page:
 * title, description, canonical URL, Open Graph and Twitter card tags.
 * File-based `opengraph-image.tsx` routes supply the social images.
 */
export function buildMetadata({
  title,
  description,
  path,
  keywords,
  noIndex = false,
  type = "website",
  publishedTime,
  modifiedTime,
  authors,
}: SeoInput): Metadata {
  const canonicalUrl = `${siteConfig.url}${path === "/" ? "" : path}`;

  return {
    title: { absolute: title },
    description,
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
    alternates: { canonical: canonicalUrl },
    robots: noIndex ? noIndexFollow : maxIndexFollow,
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      type,
      ...(type === "article" ? { publishedTime, modifiedTime, authors } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(siteConfig.twitterHandle ? { site: siteConfig.twitterHandle } : {}),
    },
  };
}

/** Robots metadata for private, authenticated pages (noindex + nofollow). */
export const PRIVATE_ROBOTS = noIndexFollow;
