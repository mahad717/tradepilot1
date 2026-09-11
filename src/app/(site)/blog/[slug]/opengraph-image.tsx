import { ImageResponse } from "next/og";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { getArticleBySlug } from "@/lib/articles";

export const alt = "TradePilot article social preview";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Render per-request: prerendered image routes are not served by the
// static-assets incremental cache on Cloudflare Workers.
export const dynamic = "force-dynamic";

/** Unique per-article OG image generated from article metadata. */
export default async function ArticleOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  const title = article?.title ?? "TradePilot knowledge base";
  const tag = article?.category?.toUpperCase() ?? "GUIDE";

  return new ImageResponse(
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
          <div style={{ fontSize: 32, fontWeight: 700, color: "#e8b54d" }}>
            TradePilot
          </div>
          <div
            style={{
              marginLeft: 12,
              padding: "8px 18px",
              borderRadius: 999,
              border: "1px solid rgba(232,181,77,0.45)",
              color: "#e8b54d",
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            {tag}
          </div>
        </div>
        <div
          style={{
            fontSize: title.length > 60 ? 48 : 58,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: -1,
            maxWidth: 980,
            display: "flex",
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", color: "#7d8493", fontSize: 22 }}>
          TradePilot knowledge base · ICT &amp; Smart Money Concepts
        </div>
      </div>
    ),
    OG_SIZE
  );
}
