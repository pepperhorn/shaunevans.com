# Handoff: adhoc — Umami analytics (Codex → lead)

- **Date:** 2026-11-25
- **Type:** return
- **Ledger / spec / plan:** Ad hoc quick fix requested by the owner; no ledger edits requested.
- **Branch:** `seo/umami`
- **Worktree:** `/home/shaun/.t3/worktrees/shaunevans.com/seo-umami-c4f4f0b9d6461c7e`
- **Base commit:** `ae816079fd1a190e3c2aa7e6695a92b7d35ff2bd`
- **Status:** Ready for draft PR; verification recorded below.

## Goal

Add the owner's Umami script to every public page through the shared head, enabled in production builds only. Push this branch and open a draft PR titled "Add Umami analytics" against `main`. Do not merge or watch it.

## Scope

- **In / files owned:** `src/layouts/BaseLayout.astro` and this return document.
- **Out:** Deployment, Coolify configuration, ledger changes, credentials changes, and unrelated code.

## Acceptance criteria

- Shared head emits the deferred `https://analytics.pepperhorn.com/script.js` script with public website ID `8d5b1dc0-d59f-4194-8574-1862208e80ad`.
- Development mode omits the script through `import.meta.env.PROD`.
- Production HTML contains the requested script; repo tests and build pass.
- Branch is pushed and a draft PR is opened without merging or watching.

## Verify with

```bash
pnpm install --frozen-lockfile
pnpm test
inf run --projectId 5a3277aa-7b32-4740-9c35-953ddc565798 --env prod --path /shaunevans-com -- pnpm build
git diff --check
```

## Known gotchas / decisions made

- `is:inline` preserves the external script and its attributes instead of Astro bundling it.
- All public Astro pages use BaseLayout, directly or through nested layouts. No repository CSP was found, so no CSP edits were necessary.
- The owner explicitly selected Prod credentials for local verification. Credentials were injected by Infisical; no deployment or env file copying was needed.
- The initial sandbox build encountered font-provider DNS restrictions and was stopped; verification uses the network-enabled production build above.
- GBrain: unavailable (`Transport closed` on project search). No GBrain writes from this implementer.
- Repo README's claim that tests do not exist is stale; `package.json` provides `pnpm test`.

## Open questions

None.

## Return

- **What changed:** One production-only script in the shared head.
- **Verification:** `pnpm test`: 16 files, 194 tests passed. Production `pnpm build` passed, including Pagefind and image-cache warm-up. HTMLParser inspection passed for all 51 generated HTML pages: exactly one script in `<head>`, with `defer`, the exact URL, and the requested website ID. `git diff --check` passed.
- **Follow-ups:** Lead review and merge; Coolify deploys from main after merge.
