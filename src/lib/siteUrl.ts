/**
 * Public origin of the site, read at request time. `import.meta.env.PUBLIC_*` is
 * frozen at build, so the runtime `process.env` value wins; `SITE` (astro.config
 * `site`) is the last resort. Behind Coolify's proxy the request URL is the
 * internal http origin, so never derive public URLs from it.
 */
export function siteUrl(): string {
  const url =
    process.env.PUBLIC_SITE_URL ??
    (import.meta.env.PUBLIC_SITE_URL as string | undefined) ??
    (import.meta.env.SITE as string | undefined);
  if (!url) throw new Error("PUBLIC_SITE_URL not set");
  return url;
}
