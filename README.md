# Fab Anything

Multi-location 3D printing service — static SPA on GitHub Pages + Supabase Postgres/Auth/Storage/Edge Functions.

## Repository layout
```
web/                 Next.js 14 static export (TypeScript, Tailwind, react-i18next, three.js)
supabase/
  migrations/        Forward-only SQL (extensions, helpers, schema, RLS, triggers, RPCs, seed)
  functions/         Deno Edge Functions (stripe-checkout, stripe-webhook, verify-model, sign-file, ...)
  tests/             pgTAP policy/RPC tests
scripts/             i18n key parity check, etc.
.github/workflows/   CI, Pages deploy, DB migration, nightly E2E, keepalive
docs/                Architecture & getting started
```

## Quick start (local)
```bash
pnpm install
supabase start && supabase db reset
cd web
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2) \
pnpm dev
```

## Scripts
- `pnpm test` — Vitest unit tests (pricing golden, format material, slug, i18n helpers)
- `pnpm i18n:check` — en/zh-Hant/zh-Hans key parity
- `supabase test db` — pgTAP RLS/RPC tests
- `pnpm build` — static export to `web/out`
- `pnpm test:e2e` — Playwright smoke tests

See `docs/GETTING_STARTED.md` and `docs/ARCHITECTURE.md` for details.

## Roles & data flow
Customer (anon or registered) browses catalog, gets instant quotes (client heuristic in a Web Worker), checks out via Stripe; webhook creates the order atomically, snapshots prices, and writes creator earnings. Staff manage own-location orders + filament stock. Admins manage everything chain-wide and approve community submissions (auto-publishing products with 85% creator revenue share).

## Deployment
- Frontend: GitHub Pages static export (`output: 'export'`, trailing slash, `.nojekyll`)
- Backend: single Supabase project — RLS is the security boundary; secrets only in Edge Functions.
