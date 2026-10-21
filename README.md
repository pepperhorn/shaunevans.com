# shaunevans.com

Personal site for [Shaun Evans](https://shaunevans.com) — saxophonist, arranger, musical director. Plus a small e-commerce shop and a lessons booking flow.

## Stack

- **Astro 6** + **React 19** + **Tailwind 4**, SSR via `@astrojs/node` (standalone)
- **Directus** at [content.shaunevans.com](https://content.shaunevans.com) for all content — posts, pages (M2A page builder), products, lessons, forms, bookings, orders
- **Square** for shop checkout (Checkout Links API; sandbox + production environments)
- **Pagefind** for full-text search
- **Coolify** for deployment — builds the `Dockerfile`, serves the Node SSR app

The codebase originated as a fork of the [Revista](https://github.com/AshKyd/astro-revista) photography theme; that lineage shows in some legacy components under `src/components/`. The product is now music-focused and CMS-driven — treat anything Revista-flavoured as historical unless `CLAUDE.md` says otherwise.

## Commands

```bash
pnpm install
pnpm dev -- --host 0.0.0.0    # bind to LAN so other devices can hit it
pnpm build                    # SSR build + Pagefind index + image-cache warm-up
pnpm preview                  # serve dist/
pnpm astro check              # type-check .astro files
```

There are no automated tests — verification is build-then-spot-check.

## Environment

Required env vars are listed in `CLAUDE.md`. The biggest ones:

- `DIRECTUS_URL` + `DIRECTUS_TOKEN` — build-time + SSR data fetching
- `PUBLIC_DIRECTUS_URL` + `PUBLIC_DIRECTUS_BOOKING_TOKEN` — booking form (browser → Directus direct write)
- `SQUARE_ENVIRONMENT` + `SQUARE_{ENV}_ACCESS_TOKEN` / `LOCATION_ID` / `SQUARE_WEBHOOK_{ENV}_SIGNATURE_KEY` — checkout

The site **will not build** without `DIRECTUS_URL` + `DIRECTUS_TOKEN`. There is no static fallback.

## Deployment

Coolify pulls `main`, builds the `Dockerfile` at repo root, and serves the resulting Node app. No GitHub Actions, no GitHub Pages, no Cloudflare / Deno Deploy. Configure env vars in the Coolify project, not in committed files.

If you want PR-time build verification, add a single-job workflow that runs `pnpm install && pnpm build` — but don't restore the upstream Revista multi-target pipeline; every job in it expected secrets we don't set.

## Working in this repo

See `CLAUDE.md` for the full architectural map, the Directus permission table, conventions, and known gaps.
