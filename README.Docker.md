# Docker Deployment

This project ships as a multi-stage Docker image built on Node 22 Alpine.
As of Astro 6, the runtime is [`@astrojs/node`](https://docs.astro.build/en/guides/integrations-guide/node/)
in **standalone** mode — the Node server serves both SSR routes and
pre-rendered static assets. Cloudflare sits in front and handles SSL, CDN
caching, and DDoS protection.

## Image overview

| Stage | Base | Purpose |
|-------|------|---------|
| `builder` | `node:22-alpine` | Installs all deps, runs `pnpm build` |
| `runner` | `node:22-alpine` | Installs prod-only deps, copies `dist/` |

The two-stage build keeps devDependencies (prettier, pagefind, etc.) out of
the production image, saving ~86 MB.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HOST` | no | Bind address (default `0.0.0.0`) |
| `PORT` | no | Listen port (default `4321`) |
| `NODE_ENV` | no | Set to `production` in the image |
| `DIRECTUS_URL` | no | Directus base URL for build-time data fetch |
| `DIRECTUS_TOKEN` | no | Read token for products + lessons collections |
| `PUBLIC_DIRECTUS_URL` | no | Same URL, exposed to browser for form POSTs |
| `PUBLIC_DIRECTUS_BOOKING_TOKEN` | no | Write-only token for booking_requests |

Without the Directus vars the site builds from stub data in `src/data/*`.

## Building locally

```bash
docker build -t shaunevans-com .
```

## Running locally

```bash
docker run --rm -p 4321:4321 shaunevans-com
# → http://localhost:4321
```

## CI/CD pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and
pushes a multi-platform image (`linux/amd64`, `linux/arm64`, `linux/arm/v6`,
`linux/arm/v7`) to Docker Hub, then signs it with [Cosign](https://docs.sigstore.dev/cosign/overview/).

```
push to main
  └─ build-revista       # pnpm build, upload dist artifact
      ├─ deploy-to-deno
      ├─ deploy-to-cloudflare
      ├─ deploy-to-github-pages
      └─ prepare-docker → build-and-push-docker → inspect → sign
                                                        └─ purge-cloudflare-cache
```

## Coolify deployment

The production site runs on [Coolify](https://coolify.io). Point Coolify at
this repository; it will pick up the `Dockerfile` automatically. Set the
environment variables listed above in the Coolify project settings.

See `.env.example` in the repo root for the full list with descriptions.
