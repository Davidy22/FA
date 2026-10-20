# Make Anyth.ing

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
pnpm setup                 # installs all workspace dependencies (web + tooling) in one go
cp .env.example .env       # optional: Google/Facebook/GitHub OAuth credentials for local Supabase
supabase start && supabase db reset
cd web
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2) \
pnpm dev
```

## Scripts
- `pnpm test` — Vitest unit tests (pricing golden, format material, slug, i18n helpers)
- `pnpm test:db` — embedded Postgres migration/admin/checkout smoke tests (no Docker)
- `pnpm i18n:check` — en/zh-Hant/zh-Hans key parity
- `supabase test db` — pgTAP RLS/RPC tests
- `pnpm build` — static export to `web/out`
- `pnpm test:e2e` — Playwright smoke tests

See `docs/GETTING_STARTED.md` and `docs/ARCHITECTURE.md` for details.

## Roles & data flow
Customer (anon or registered) browses catalog, gets instant quotes (client heuristic in a Web Worker), checks out via Stripe — **guest checkout works without an account** (contact name/email only); webhook creates the order atomically, snapshots prices (including any coupon discount), writes creator earnings, and credits reward points (1 point per US$1 spent, registered accounts only). A print can be split into named **material slots** (for example a flexi cat's *Body* and *Collar*): each slot lists the materials it may be printed in with a per-slot price modifier, plus a default material and default colour, and the customer picks a material and an in-stock colour for every slot. Any product or option choice can also carry a **sale price** with an optional start/end window; the storefront shows the regular price struck through next to the sale price and `price_cart` charges it. Customers can sign in with email/password, Google, Facebook, or GitHub, and link/unlink providers on `/account` (see `docs/GETTING_STARTED.md` §7). Registered customers manage points, referral codes, and coupons on `/rewards` and claim promo offer codes on `/offers`; offer codes and point redemptions both issue single-use coupons, which can be applied in the cart/checkout. Staff manage own-location orders + filament stock. Admins manage everything chain-wide and approve community submissions (auto-publishing products with 85% creator revenue share).

## Local test accounts
`supabase db reset` applies `supabase/seed.sql` **after** migrations, so these local-only email/password accounts are ready to sign in at `/login` on every reset:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@example.test` | `LocalTest123!` |
| Employee (Central) | `employee@example.test` | `LocalTest123!` |
| Customer | `customer@example.test` | `LocalTest123!` |

These are public demo credentials: **never use them on a hosted database**. `supabase db push` does not run `seed.sql`. For a hosted project's first admin, use the verified-email `ADMIN_BOOTSTRAP_EMAIL` flow instead; see [Getting Started §5](docs/GETTING_STARTED.md#5-first-admin-account-and-staff). Existing admins can manage accounts and invite staff from **Users** without editing tables.

The shop is Hong Kong first: locations, prices and demo data default to HKD, `Asia/Hong_Kong` and country `HK`, and sales tax follows the location's country, so a Hong Kong pickup is always tax-free (a taxable country keeps its rate — the columns are there for a later expansion). The admin console provides forms for locations (including map coordinates, country and rates), materials and filaments, stock by location, products and options (including material slots and sale prices), submissions, orders, tickets, users, payouts, offers/coupons (conditional coupons, bulk code generation, and points redemption options), and platform pricing. Add/edit panels open above the list they belong to, and each item's localized text fields share one language picker. The header's location name links to the existing searchable location picker at `/locations` rather than changing locations via a dropdown.

## Deployment
- Frontend: GitHub Pages static export (`output: 'export'`, trailing slash, `.nojekyll`). See the [Pages deployment walkthrough](docs/GETTING_STARTED.md#7-deploy-the-frontend-to-github-pages) for required Actions configuration and how to publish.
- Backend: single Supabase project — RLS is the security boundary; secrets only in Edge Functions.
