"use client";

import Script from "next/script";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Lightweight analytics integration (Core-Web-Vitals friendly).
 *
 * - Google Analytics 4 is loaded with `afterInteractive` only when
 *   NEXT_PUBLIC_GA_ID is configured, so public pages ship zero
 *   third-party JavaScript by default.
 * - Google Search Console / Bing Webmaster verification tokens are
 *   injected as meta tags via env vars in the root layout
 *   (NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION / NEXT_PUBLIC_BING_VERIFICATION).
 *
 * Privacy: no PII is tracked; IP anonymization is handled by GA4 default.
 */
export function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  if (!gaId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${gaId}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}

/** Fire a custom analytics event (no-op when GA is not configured). */
export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", name, params);
  }
}
