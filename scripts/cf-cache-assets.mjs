#!/usr/bin/env node
/**
 * TradePilot — Cloudflare static-assets incremental cache installer.
 *
 * `opennextjs-cloudflare build` emits the Next.js incremental cache into
 * `.open-next/cache/<buildId>/` (e.g. `index.cache`, `blog/<slug>.cache`, ...).
 * The static-assets incremental cache override used in `open-next.config.ts`
 * reads those files at runtime through the ASSETS binding from:
 *
 *   http://assets.local/cdn-cgi/_next_cache/<buildId>/<key>.cache
 *   http://assets.local/cdn-cgi/_next_cache/__fetch/<buildId>/<key>
 *
 * This script therefore mirrors the generated cache into the assets
 * directory so it ships with the deployment:
 *
 *   .open-next/cache/<buildId>/**  ->  .open-next/assets/cdn-cgi/_next_cache/<buildId>/**
 *
 * Fails soft: if there is nothing to copy it exits 0 with a warning, so a
 * missing optional cache can never break a CI deployment.
 */

import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const openNextDir = join(root, ".open-next");
const cacheDir = join(openNextDir, "cache");
const assetsDir = join(openNextDir, "assets");

/** Recursively count files in a directory (returns 0 if missing). */
function countFiles(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) count += countFiles(full);
    else count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1. Resolve the build id.
//    Preferred: the single buildId-named directory inside .open-next/cache.
//    Fallback:  the BUILD_ID file emitted into .open-next/assets.
// ---------------------------------------------------------------------------
let buildId;
if (existsSync(cacheDir)) {
  const dirs = readdirSync(cacheDir).filter((entry) => {
    try {
      return statSync(join(cacheDir, entry)).isDirectory();
    } catch {
      return false;
    }
  });
  if (dirs.length === 1) buildId = dirs[0];
}
if (!buildId) {
  const buildIdFile = join(assetsDir, "BUILD_ID");
  if (existsSync(buildIdFile)) {
    buildId = readFileSync(buildIdFile, "utf8").trim();
  }
}

if (!buildId) {
  console.warn(
    "[cf-cache-assets] No build id found (.open-next/cache/<buildId> or .open-next/assets/BUILD_ID) — skipping cache copy."
  );
  process.exit(0);
}

const source = join(cacheDir, buildId);
if (!existsSync(source)) {
  console.warn(
    `[cf-cache-assets] Cache directory for build ${buildId} not found — skipping cache copy.`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Mirror the cache into the assets directory.
//    Wipe cdn-cgi/_next_cache first so stale caches from previous builds are
//    never uploaded and keys can only resolve to the current build.
// ---------------------------------------------------------------------------
const targetRoot = join(assetsDir, "cdn-cgi", "_next_cache");
const target = join(targetRoot, buildId);

rmSync(targetRoot, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

const files = countFiles(target);
console.log(
  `[cf-cache-assets] Copied ${files} cache file(s) for build ${buildId}`
);
console.log(
  `[cf-cache-assets]   ${relative(root, source)} -> ${relative(root, target)}`
);
