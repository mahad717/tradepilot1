import { ImageResponse } from "next/og";
import { siteConfig } from "./site";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export interface OgImageOptions {
  /** e.g. "XAUUSD Signals" */
  title: string;
  /** Short supporting line shown under the title. */
  subtitle?: string;
  /** Small category chip, e.g. "GOLD · XAUUSD" or "GUIDE". */
  tag?: string;
}

/**
 * Shared Open Graph image factory (1200×630).
 * Each public route renders a unique, branded social preview
 * via its opengraph-image.tsx file.
 */
export function createOGImage({ title, subtitle, tag }: OgImageOptions) {
  return () =>
    new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "72px 84px",
            backgroundColor: "#101319",
            backgroundImage:
              "radial-gradient(circle at 85% 15%, rgba(232,181,77,0.16) 0%, rgba(232,181,77,0) 45%)",
            color: "#f4f5f7",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 14,
                backgroundColor: "#15171d",
                border: "2px solid #2a2e38",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="26" height="26" viewBox="0 0 36 36">
                  <path
                    d="M6 24 L14 24 L14 12 L20 12 L20 26 L26 26 L26 16 L33 16"
                    stroke="#e8b54d"
                    strokeWidth="4"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, color: "#f4f5f7" }}>
              {siteConfig.name}
            </div>
            {tag ? (
              <div
                style={{
                  marginLeft: 14,
                  padding: "8px 18px",
                  borderRadius: 999,
                  border: "1px solid rgba(232,181,77,0.45)",
                  color: "#e8b54d",
                  fontSize: 21,
                  fontWeight: 600,
                  letterSpacing: 1,
                }}
              >
                {tag}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div
              style={{
                fontSize: title.length > 46 ? 60 : 72,
                fontWeight: 700,
                lineHeight: 1.08,
                letterSpacing: -1,
                maxWidth: 960,
              }}
            >
              {title}
            </div>
            {subtitle ? (
              <div
                style={{
                  fontSize: 29,
                  lineHeight: 1.35,
                  color: "#a7adba",
                  maxWidth: 880,
                  display: "flex",
                }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              color: "#7d8493",
              fontSize: 22,
            }}
          >
            <div style={{ display: "flex" }}>
              Rule-based ICT analysis for XAUUSD &amp; XAGUSD
            </div>
            <div style={{ display: "flex", color: "#e8b54d", fontWeight: 600 }}>
              {siteConfig.url.replace("https://", "")}
            </div>
          </div>
        </div>
      ),
      OG_SIZE
    );
}
