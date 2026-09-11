import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: no `output: "standalone"` — Cloudflare deploys via
  // @opennextjs/cloudflare (see wrangler.jsonc / open-next.config.ts), which
  // manages its own build output in `.open-next/`.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  poweredByHeader: false,
  compress: true,
  // No next/image usage today; keep optimization off so the Worker never
  // needs a native image pipeline (Workers can't run sharp).
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
