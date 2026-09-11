import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * TradePilot is a fully static site: every public SEO page, blog article and
 * OG image is prerendered at build time, and nothing uses ISR revalidation.
 * The static-assets incremental cache serves those prerendered artifacts
 * straight from Workers Assets (zero bindings, zero cold-start cost).
 *
 * `scripts/cf-cache-assets.mjs` (part of `bun run cf:build`) copies
 * `.open-next/cache/<buildId>` into `.open-next/assets/cdn-cgi/_next_cache/`
 * where this cache reads it through the ASSETS binding.
 *
 * If you later add ISR (revalidate) or on-demand revalidation, switch to the
 * KV-backed cache instead:
 *   import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
 *   export default defineCloudflareConfig({ incrementalCache: kvIncrementalCache });
 * (requires a KV namespace bound as NEXT_INC_CACHE_KV).
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
