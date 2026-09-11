import { siteConfig } from "./site";

/**
 * Schema.org JSON-LD builders.
 * Only schemas that accurately represent the visible page content are used.
 */

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: siteConfig.url,
    logo: `${siteConfig.url}/icon.svg`,
    description:
      "TradePilot provides rule-based XAUUSD and XAGUSD market analysis and ICT-based trading signals with transparent backtesting.",
    sameAs: [],
  };
}

export function webSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    publisher: { "@type": "Organization", name: siteConfig.name },
    inLanguage: "en",
  };
}

export function webApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${siteConfig.name} — ICT Signal & Backtesting Terminal`,
    url: siteConfig.url,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web browser",
    description:
      "Web application for rule-based XAUUSD and XAGUSD analysis using ICT and Smart Money Concepts, including signal workflows and bar-replay backtesting.",
    publisher: { "@type": "Organization", name: siteConfig.name },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free plan available",
    },
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${siteConfig.url}${item.path === "/" ? "" : item.path}`,
    })),
  };
}

export function faqPageSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

export interface ArticleSchemaInput {
  title: string;
  description: string;
  path: string;
  author: string;
  publishedAt: string;
  updatedAt: string;
  image: string;
  section?: string;
  keywords?: string[];
  wordCount?: number;
}

export function articleSchema(input: ArticleSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${siteConfig.url}${input.path}`,
    },
    image: `${siteConfig.url}${input.image}`,
    author: { "@type": "Organization", name: input.author },
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      logo: { "@type": "ImageObject", url: `${siteConfig.url}/icon.svg` },
    },
    datePublished: input.publishedAt,
    dateModified: input.updatedAt,
    ...(input.section ? { articleSection: input.section } : {}),
    ...(input.keywords && input.keywords.length > 0
      ? { keywords: input.keywords.join(", ") }
      : {}),
    inLanguage: "en",
  };
}
