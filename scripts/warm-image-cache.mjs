#!/usr/bin/env node
/**
 * Pre-warm the Directus image transform cache for homepage-featured posts.
 *
 * Why: Directus transforms images on first request and caches the result.
 * Cold WebP encoding takes ~1s per image; cold AVIF takes ~10s. Running this
 * after every build means the first real visitor never pays the cold-encode
 * cost — they get the cached output immediately.
 *
 * What it does: fetches featured-tagged posts with images, then fires GETs at
 * each transform URL the homepage uses (large/medium/small WebP @ q=65).
 *
 * Runs in parallel with a small concurrency cap so we don't DoS the CMS.
 * Failures are logged but don't fail the build — image rendering still works
 * at runtime, just with a cold hit on first paint.
 *
 * Skips silently when DIRECTUS_URL or DIRECTUS_TOKEN is unset (offline builds).
 */
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  console.log("[warm-image-cache] DIRECTUS_URL/TOKEN unset — skipping.");
  process.exit(0);
}

// Keep these in sync with src/pages/index.astro.
const SIZES = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 720 },
  { w: 854, h: 480 },
];
const FORMAT = "webp";
const QUALITY = 65;
const CONCURRENCY = 4;

function transformUrl(uuid, w, h) {
  return `${DIRECTUS_URL}/assets/${uuid}?width=${w}&height=${h}&fit=cover&format=${FORMAT}&quality=${QUALITY}`;
}

async function fetchFeaturedImageUuids() {
  const u = new URL(`${DIRECTUS_URL}/items/posts`);
  u.searchParams.append("fields[]", "image");
  u.searchParams.append("filter[post_tags][post_tags_id][slug][_eq]", "featured");
  u.searchParams.append("filter[image][_nnull]", "true");
  u.searchParams.append("limit", "50");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } });
  if (!res.ok) throw new Error(`fetch featured posts failed: ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((p) => p.image).filter(Boolean);
}

async function warmOne(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    const ms = Date.now() - start;
    if (!res.ok) {
      console.warn(`  ${res.status}  ${ms}ms  ${url}`);
    } else {
      console.log(`  ${res.status}  ${ms}ms  ${url}`);
    }
  } catch (err) {
    console.warn(`  ERR  ${url}  ${err.message}`);
  }
}

async function main() {
  const uuids = await fetchFeaturedImageUuids();
  if (uuids.length === 0) {
    console.log("[warm-image-cache] No featured posts with images — nothing to warm.");
    return;
  }

  const urls = uuids.flatMap((u) => SIZES.map((s) => transformUrl(u, s.w, s.h)));
  console.log(
    `[warm-image-cache] Warming ${urls.length} transforms (${uuids.length} images × ${SIZES.length} sizes)...`,
  );

  // Simple worker-pool concurrency.
  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < urls.length) {
      const next = i++;
      await warmOne(urls[next]);
    }
  });
  const t0 = Date.now();
  await Promise.all(workers);
  console.log(`[warm-image-cache] Done in ${Date.now() - t0}ms.`);
}

main().catch((err) => {
  console.error("[warm-image-cache] failed:", err.message);
  // Don't fail the build — site still works, just cold on first visit.
  process.exit(0);
});
