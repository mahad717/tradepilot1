# TradePilot

Rule-based **XAUUSD & XAGUSD trading analysis** built on ICT and Smart Money
Concepts — with a fully SEO-optimized public website, a structured content
system, and a private authenticated terminal.

## Tech stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS 4** + shadcn/ui (dark premium theme)
- **Supabase** (authentication & data for the terminal — env-configured)
- File-based **JSON content system** for the blog (no code changes needed to publish)

## SEO architecture (spec §47)

| Requirement | Implementation |
|---|---|
| Public SEO pages | `/`, `/xauusd`, `/xagusd`, `/xauusd-signals`, `/xagusd-signals`, `/gold-analysis`, `/silver-analysis`, `/ict-strategy`, `/ict-backtesting`, `/ict-concepts`, `/pricing`, `/about`, `/faq`, `/blog` + 8 in-depth articles |
| Unique meta tags | `src/lib/seo.ts` factory — unique title, description, canonical, OG and Twitter tags per page |
| Dynamic SEO | `generateMetadata` for blog articles; per-page metadata for all static pages |
| Structured data | `src/lib/schema.ts` + `<JsonLd/>` — Organization, WebSite, WebApplication, FAQPage (visible-content-matched), Article, BreadcrumbList |
| Heading hierarchy | One H1 per page, audited |
| Internal linking | Header/footer link map, breadcrumbs, contextual in-content links with descriptive anchors |
| Clean URLs | Lowercase, hyphenated, canonicalized |
| Sitemap | `src/app/sitemap.ts` — auto-updates from the content system |
| Robots | `src/app/robots.ts` — blocks `/dashboard`, `/settings`, `/api/`, `/auth`, private signal/backtest routes |
| Performance / CWV | Public pages are 100% server-rendered (SSG), zero client JS except header toggle & FAQ accordion, `next/font` self-hosting, inline SVG diagrams (no image payloads), GA4 loaded only when configured |
| Rendering strategy | All public pages statically generated; articles pre-rendered via `generateStaticParams` |
| Image SEO | Responsive SVG diagrams with `<title>` + `aria-label`; unique OG images (1200×630) per page via `opengraph-image.tsx` |
| E-E-A-T | No profit guarantees, risk disclaimers site-wide, transparent methodology pages, privacy & terms |
| Private pages | `/dashboard`, `/auth` marked `noindex` + blocked in robots.txt |
| Analytics | GA4 (env-gated), GSC + Bing verification meta via env vars — see `.env.example` |

## Getting started

```bash
bun install
cp .env.example .env.local   # fill in values
bun run db:push              # only needed if using the terminal's DB features
bun run dev
```

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap/robots/OG (change to your domain) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_GA_ID` | GA4 measurement ID (optional) |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Search Console token (optional) |
| `NEXT_PUBLIC_BING_VERIFICATION` | Bing Webmaster token (optional) |
| `NEXT_PUBLIC_TWITTER_HANDLE` | twitter:site handle (optional) |

## Deploying to Cloudflare Workers

The app targets Cloudflare Workers via **@opennextjs/cloudflare**
(`wrangler.jsonc` + `open-next.config.ts`).

```bash
bun run cf:build     # opennextjs-cloudflare build + copy prerender cache into assets
bun run preview      # run the built Worker locally on workerd (http://localhost:8787)
bun run deploy       # opennextjs-cloudflare deploy (build + wrangler deploy)
```

### Cloudflare Builds configuration (Workers → Settings → Builds)

| Field | Value |
|---|---|
| Build command | `bun run cf:build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |
| Production branch | `main` |

### Variables & secrets

**Build variables** (Builds → Variables and secrets) — `NEXT_PUBLIC_*` values are
inlined at compile time, so the build must see them:

| Name | Example |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://tradepilot1.<your-subdomain>.workers.dev` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` |
| `NEXT_PUBLIC_GA_ID` / `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` / `NEXT_PUBLIC_BING_VERIFICATION` / `NEXT_PUBLIC_TWITTER_HANDLE` | optional |

**Runtime variables & secrets** (Settings → Variables and Secrets):

| Name | Type | Purpose |
|---|---|---|
| `TWELVEDATA_API_KEY` | Secret | Live gold market data |
| `TWELVEDATA_ENABLE_XAG` | Text | `1` to enable live silver (paid plan only) |

### Saved signals & backtests on Workers (optional)

Workers have no filesystem, so the terminal's persistence layer uses
**Cloudflare D1** through Prisma's driver adapter
(`src/lib/db.ts` auto-detects the environment; local dev keeps using SQLite):

1. `npx wrangler d1 create tradepilot-db`
2. Uncomment the `d1_databases` block in `wrangler.jsonc` and paste the
   printed `database_id`
3. `npx wrangler d1 execute tradepilot-db --remote --file=d1/schema.sql`
4. Redeploy

Until then the site works normally — the save endpoints answer a clean
HTTP 503.

### Notes

- Prerendered pages and OG images are served from Workers Assets via the
  static-assets incremental cache (`open-next.config.ts`); the OG images
  themselves render per-request with `next/og` (satori on workerd).
- Build uses webpack (`next build --webpack`) because OpenNext relies on
  webpack output tracing; Turbopack builds lack `.nft.json` files.
- Local dev is unaffected: `bun run dev` runs plain `next dev`.

## Publishing a new blog article

Add a JSON file to `src/content/articles/` following the existing schema
(slug, title, seoTitle, seoDescription, excerpt, category, tags, author,
publishedAt, updatedAt, readingMinutes, content blocks), register it in
`src/lib/articles.ts`, and redeploy. The blog index, sitemap and related-article
links update automatically.

## Project structure

```
src/
  app/
    (site)/          # public SEO website (static, indexable)
    (app)/           # authenticated terminal (noindex)
    robots.ts        # robots.txt
    sitemap.ts       # sitemap.xml
    not-found.tsx    # 404
  components/
    seo/             # JSON-LD renderer
    site/            # header, footer, UI primitives, diagrams, article renderer
  content/articles/  # JSON content system
  lib/
    seo.ts           # metadata factory
    schema.ts        # Schema.org builders
    og.tsx           # OG image factory (1200×630)
    articles.ts      # content loader
    supabase.ts      # server-side Supabase client
```

## Risk disclaimer

TradePilot provides educational, rule-based market analysis — not financial
advice. Trading involves substantial risk of loss. Past performance does not
guarantee future results.
