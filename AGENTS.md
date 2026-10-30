# AGENTS.md

A starting point for AI/automation agents (and new humans) working in this repo.
It summarises the architecture, the commands that must pass, the conventions that
are easy to get wrong, and where each feature lives. Deeper background lives in
[`README.md`](README.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) — read this file first, then
those only for the area you are touching.

---

## 0. The rules that matter most

1. **It is a static site.** `next.config.mjs` sets `output: 'export'`. There is no
   server runtime: no API routes, no `getServerSideProps`, no server actions, no
   middleware. All data access happens in the browser through `supabase()`.
2. **The database is the security boundary.** Supabase RLS policies plus
   `SECURITY DEFINER` RPCs decide what a customer or staff member can do. Hiding a
   button is never the protection; check the policy/RPC too. §15 is the checklist
   that keeps the boundary honest.
3. **Never trust the browser for money.** `price_cart(jsonb)` is the authoritative
   price. The client may estimate for display, but checkout re-prices server-side and
   Stripe is charged from that result.
4. **Migrations are forward-only.** Add a new numbered file; never edit or delete an
   applied migration. If you change a function, re-create it in full in the new file.
5. **Everything user-facing is translated** into `en`, `zh-Hant` and `zh-Hans`
   (see §9). A PR that adds English-only copy fails CI.
6. **Finish with the full check suite** in §14 — that is exactly what CI runs.
7. **Tokens never leave the browser.** The anon key is public and RLS-deep; the
   service-role key exists only inside Edge Functions.

---

## 1. What this is

"Make Anyth.ing" — a Hong Kong-first, multi-branch 3D-printing shop: catalog,
custom-quote tickets, document printing, cart/checkout (pickup or delivery),
rewards (points, coupons, offer codes, membership tiers), creator payouts, plus a
staff/admin console.

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 15 App Router, **static export**, React 19, TypeScript (strict), Tailwind, TanStack Query, Zustand (persisted), react-i18next |
| Backend | Single Supabase project: Postgres + RLS + RPCs, Auth, Storage, Deno Edge Functions |
| Payments | Stripe Checkout (hosted redirect) + signed webhook |
| Hosting | GitHub Pages (`web/out`), Supabase free tier |

Monorepo: root tooling + the single workspace package `web/` (`pnpm-workspace.yaml`).

---

## 2. Commands (run from the repo root unless noted)

```bash
pnpm install            # also: pnpm setup. One install covers everything.

# Local stack (needs Docker; not available in every sandbox)
supabase start && supabase db reset        # migrations + supabase/seed.sql

# Frontend dev server (env is required — see §2.1)
pnpm dev                                   # next dev on :3000

# Checks — these are the CI gates
pnpm lint               # next lint (eslint-config-next)
pnpm typecheck          # tsc --noEmit (strict + noUnusedLocals/Parameters)
pnpm test               # Vitest, jsdom (unit + component)
pnpm test:db            # scripts/db-smoke-test.mjs — all migrations in PGlite, no Docker
pnpm i18n:check         # locale key + {{placeholder}} parity
pnpm check:repo         # migrations append-only + edge-function/config parity
pnpm verify             # everything above except build, in one go
pnpm build              # static export to web/out
node scripts/check-pages-export.mjs        # verifies the built artifact (needs web/out)

# Optional / slower
pnpm i18n:sync                              # rewrite zh-* structure from en (keeps translations)
node scripts/i18n-sync.mjs --since main     # list English copy that changed since a ref
supabase test db                            # pgTAP RLS/RPC matrix (needs Docker)
pnpm test:e2e                               # Playwright (starts its own dev server)
pnpm exec playwright install                # once, before test:e2e
```

### 2.1 Environment

The browser client reads `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`; without them `supabase()` throws at runtime.

```bash
# web/.env.local is gitignored (.env.* is ignored, .env.example is not)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2)
```

`NEXT_PUBLIC_BASE_PATH` (e.g. `/FA` on GitHub Pages) is **only applied in
production builds** (`next.config.mjs` → `isProd ? basePath : ''`). Base-path bugs
therefore never show in `pnpm dev`; build and run `check-pages-export.mjs` to catch
them. Raw URLs (assets, `window.location`, redirect/`mailto` targets) must go through
`withBasePath()` in `web/src/lib/paths.ts`; `next/link` and the router already prefix
themselves.

If you run a dev server inside a container and need to preview it from outside,
bind it: `pnpm dev -- -H 0.0.0.0 -p 3000`. `supabase/config.toml` already lists
`https://*.e2b.app` and GitHub Pages origins as allowed auth redirect URLs.

---

## 3. Repo map

```
AGENTS.md                 ← you are here
README.md                 product + feature overview
docs/ARCHITECTURE.md      design notes per subsystem
docs/GETTING_STARTED.md   setup, Pages deploy, OAuth, document printing, tickets
package.json              root scripts (delegate to web/ or scripts/)
pnpm-lock.yaml            committed; CI installs with --frozen-lockfile
scripts/
  db-smoke-test.mjs       runs every migration in embedded PGlite, then asserts
                          admin + checkout + pricing behaviour (the schema contract)
  i18n-check.mjs          CI wrapper: i18n-sync.mjs --check
  i18n-sync.mjs           synchronises zh-* bundles to en structure
  check-pages-export.mjs  asserts the static export's assets/favicon honour basePath
supabase/
  config.toml             local ports (API 54321, DB 54322), auth redirect URLs
  migrations/             forward-only SQL, numerically ordered
  functions/              Deno Edge Functions (see §4.4)
  tests/db_policies.sql   pgTAP RLS/RPC matrix (`supabase test db`)
  seed.sql                local demo accounts (never used by `db push`)
web/
  next.config.mjs         output: 'export', trailingSlash, basePath/assetPrefix
  tailwind.config.ts      brand palette 50–900 (see §11)
  vitest.config.ts        jsdom, globals, alias @ -> src, src/test/setup.ts
  src/app/                one directory per route (client components, see §4.1)
  src/components/         shared UI; components/admin/* = console panels
  src/hooks/              shared react-query hooks (locations, document prices, filaments)
  src/store/              Zustand stores: cart, location, locale (+ lib/theme.ts)
  src/lib/                pure helpers + supabase client + types + i18n
  src/i18n/locales/{en,zh-Hant,zh-Hans}/*.json   13 namespaces each
  e2e/basic.spec.ts       Playwright smoke tests (seed localStorage, no login)
```

---

## 4. Architecture you must not fight

### 4.1 Static export + client-side data

* Every page is a client component (`'use client'`), except the static
  "submissions are closed" notice at `app/creator/submit/page.tsx`. Data comes from
  `@tanstack/react-query` over `supabase()` (`web/src/lib/supabase.ts`, a memoised
  `createBrowserClient`). There is exactly one layout (`app/layout.tsx`) and no
  `middleware.ts`/`route.ts` anywhere.
* Routes use `trailingSlash`, so links/redirects end with `/` (`/checkout/success/`).
* `useSearchParams()` requires a `<Suspense>` boundary in a static export — copy the
  `ProductPage` wrapper pattern (`web/src/app/product/page.tsx`).
* Query keys are plain arrays used informally across pages (`['me']`, `['me_account']`,
  `['my_coupons']`, `['price_cart', …]`, `['admin_*']`). Reuse the existing key if a
  page already loads the same data; mutation flows invalidate them (see `offers`,
  `coupon`, `rewards` pages, and `refreshSettings` in `components/admin/Settings.tsx`).

### 4.2 Persisted client stores

| Store | Key | Contents |
| --- | --- | --- |
| `store/cart.ts` | `ma.cart` | items (`CartLineInput[]`), coupon code, note, fulfilment, delivery address |
| `store/location.ts` | `ma.location` | `selectedLocationId` |
| `store/locale.ts` | `ma.locale` | locale |

Zustand merges persisted state over the initial state, so **a newly added field needs
a default in the store** and old payloads keep working. Playwright tests seed these
keys directly (`e2e/basic.spec.ts`), which is how guest flows are tested.

### 4.3 Checkout lifecycle (the only write path for orders)

```
cart page ── price_cart() ──> display totals
checkout page ── price_cart() ──> review + coupon eligibility
  └─ stripe-checkout (Edge Function: verifies the caller, re-downloads document
     PDFs to recount pages, re-prices with the service role, creates the Stripe
     session, snapshots the cart into checkout_sessions)
       └─ Stripe hosted page
            └─ stripe-webhook (verifies the signature, dedupes via stripe_events)
                 └─ create_order_from_cart() (service_role only)
                      └─ orders + order_items (+ option values, material slots,
                         creator earnings, coupon consumption, points trigger)
```

`create_order_from_cart` re-runs `price_cart` and aborts if a coupon is no longer
valid, so a stale browser cart can never change the amount actually charged.

### 4.4 Edge Functions (`supabase/functions/`)

Deno modules; shared helpers in `_shared/` (`supabaseServiceClient`,
`supabaseUserClient`, `corsHeaders`/`handleCors`).

| Function | Purpose |
| --- | --- |
| `stripe-checkout` | create the Checkout session (validates caller + cart) |
| `stripe-webhook` | fulfil the order, send the Resend confirmation email |
| `convert-document` | DOC/DOCX/ODT/Pages → PDF via private Gotenberg (`GOTENBERG_URL`) |
| `sign-file` | short-lived signed URLs for private order files |
| `refund-order` | Stripe refund for allowed statuses |
| `bootstrap-admin`, `create-staff`, `set-user-active`, `site-rebuild` | admin/ops actions |

Secrets live only in Edge Functions. The browser never sees anything but the anon key.

### 4.5 Storage buckets

`document-prints` (private, guest capability paths `guest/<uuid>/<uuid>.pdf` or
`<userId>/…`), `option-uploads` (private, owner-scoped), `ticket-uploads` (private),
`product-images` (public), `product-files`/`models`/`submission-assets` (legacy /
retired for new creator uploads).

---

## 5. Where things live (feature → files)

| Feature | SQL | UI |
| --- | --- | --- |
| Catalog & product page | `premade_products`, `product_materials`, `product_option_*`, `product_material_slots` | `app/catalog/page.tsx`, `app/product/page.tsx`, `components/ProductCard.tsx` |
| Pricing / sales | `price_cart`, `effective_price`, `sale_*` helpers (`20250101002300`, redefined in `…03300`, `…03700`) | `lib/sale.ts`, `components/Price.tsx` |
| Cart & options editing | `price_cart` line output | `app/cart/page.tsx`, `components/CartItemOptions.tsx`, `store/cart.ts` |
| Checkout / delivery | `price_cart`, `create_order_from_cart`, `orders.fulfilment/shipping_address`, `profiles.delivery_address` | `app/checkout/page.tsx`, `lib/shipping.ts` |
| Rewards & coupons | `20250101000800`, `…02600` (tiers), `…03000`, `…03300`, `redeem_rewards`, `claim_offer_code`, `redeem_coupon_code` | `app/rewards/page.tsx`, `app/offers/page.tsx`, `app/coupon/page.tsx`, `lib/rewards.ts` |
| Quote tickets & staff quotes | `20250101001600`: `tickets`, `ticket_messages`, `ticket_attachments`, `ticket_quotes`, `accept_ticket_quote` | `app/quote/page.tsx`, `app/tickets/page.tsx`, `app/employee/tickets/page.tsx`, `components/TicketThread.tsx` |
| Document printing | `20250101001200`, `20250101002900` (`_document_path_allowed`, settings `document.*_per_side`) | `app/document-printing/page.tsx`, `lib/documents.ts`, `hooks/useDocumentPrices.ts` |
| Locations & tax | `20250101002100`, `…02200`, `sales_tax_rate`, `no_sales_tax_countries` | `app/locations/page.tsx`, `components/Location*.tsx`, `hooks/useLocations.ts`, `lib/countries.ts` |
| Staff permissions | `20250101002400`: `permission_keys`, `has_permission`, `admin_set_user_permissions` | `lib/permissions.ts` (**keep the two lists in step**), `components/admin/Users.tsx` |
| Admin console | `admin_save_product`, `admin_generate_coupons`, `admin_update_user`, … | `app/admin/page.tsx` (tab → permission map) + `components/admin/*` |
| Creator payouts | `creator_earnings`, `request_payout`, `admin_decide_payout` | `app/creator/page.tsx`, `app/admin` → payouts |
| Appearance (light/dark) | — | `lib/theme.ts`, `components/ThemeSync.tsx`, `components/AppearanceSelect.tsx`, `app/globals.css` |

Local demo data after `supabase db reset` (see `supabase/seed.sql` and the demo
migration): `admin@example.test` / `employee@example.test` / `customer@example.test`,
all `LocalTest123!`; two Hong Kong branches; demo products under ids
`33333333-…-00000000000{1,2,3}`; offer codes `WELCOME10` and `HIGHFIVE`.

### 5.1 Deliberately retired / legacy code — do not "restore" it

* **Creator model uploads are closed.** `app/creator/submit/page.tsx` is a static
  notice, `features.model_submissions` is off, and the `models` / `product-files`
  buckets are legacy. `model_submissions` tables and admin review RPCs still exist.
* **Custom quotes go through tickets.** `quote_requests` / `uploaded_models` and the
  `custom` cart kind are still priced by `price_cart`, but the storefront path is the
  quote-ticket flow (`/quote` → staff quote → accept into cart).
* **`/referrals` was deleted.** Referral details live in the rewards tab
  (`/rewards#referrals`); there is no standalone route.

---

## 6. Frontend conventions

* **Files/pages:** one folder per route under `src/app`, `'use client'` at the top.
  Larger pages stay single files with small local components; shared pieces move to
  `src/components`. Admin panels live in `src/components/admin/` and follow the
  `AdminFeedback` / `AdminQueryState` / `useAdminAction` / `LocalizedFields` helpers
  in `components/admin/Shared.tsx`.
* **Data:** never `fetch()` the REST API by hand — use `supabase().from(...)`,
  `supabase().rpc(...)`, `supabase().functions.invoke(...)`. Wrap reads in
  `useQuery` with an explicit key and type the row with `src/lib/types.ts`
  (hand-maintained; update it when you add a column you read).
* **Money:** always `formatMoney(amount, locale, currency)` from `lib/format.ts`;
  never hardcode `$`/`HK$`. Currency comes from the selected location.
* **DB-localised text:** `t_db(value, locale)` for `{en, zh-Hant, zh-Hans}` JSONB
  columns; `formatMaterial()` for material names (+ optional price modifier).
* **Auth/state:** `queryClient.setQueryData(['me'], null)` on sign-out and
  invalidate `['me']`, `['me_account']`, `['auth_user']` on auth changes (see
  `components/Header.tsx`).
* **Accessibility:** interactive controls need labels or `aria-label`; status
  messages use `role="status"`, errors `role="alert"` (tests rely on these).

---

## 7. Money, tax, currency, shipping

* Home market: `country = HK`, `currency = HKD`, `timezone = Asia/Hong_Kong`
  (column defaults + `20250101002200`). A location abroad keeps its own currency
  and tax.
* Sales tax is a property of the **country**: `public.sales_tax_rate(country, rate)`
  returns 0 for Hong Kong and friends, so the tax line is omitted when it is zero.
* `formatMoney` formats with an `-HK` region tag so foreign currencies read
  unambiguously (`US$5.00`, never a bare `$5.00`).
* Delivery: flat `50` and free from `500` of merchandise (after coupon). SQL is
  authoritative (`price_cart`); `web/src/lib/shipping.ts` mirrors it for display
  and validates the address. If you change either number, change both.
* Membership points: `floor(total × points_per_dollar × tier multiplier)`, awarded by
  a trigger on orders; `lifetime_points` only grows.

---

## 8. Database workflow

**Adding a migration**

```
supabase/migrations/2025010100NN00_short_name.sql
```

Files are `YYYYMMDDHHMMSS`-shaped but this repo increments a fixed counter: pick the
next free suffix (currently `20250101003700`; add `…03800`, `…03900`, …) so the file
sorts last. Migrations must be idempotent-friendly (`add column if not exists`,
`on conflict do nothing`) where they touch seeded rows, and must not assume a clean
database.

**Changing an existing function** — the trap. Many core functions are redefined
across several migrations (e.g. `price_cart` appears in `…00500`, `…00900`, `…01200`,
`…01600`, `…01800`, `…02100`, `…02300`, `…02900`, `…03300`, `…03700`). Find the **newest**
definition first:

```bash
grep -rn "function public.price_cart" supabase/migrations
grep -rn "function public.create_order_from_cart" supabase/migrations
```

Copy that whole body into your new migration, edit it, and re-state the grants at the
end (`grant execute … to anon, authenticated, service_role;` or, for service-only
RPCs, `revoke all … from public, anon, authenticated; grant … to service_role;`).
A partial `create or replace` will silently drop behaviour.

**Security model**

* RLS is enabled on every public table (`supabase/migrations/20250101000400_rls.sql`
  and later). Reads for the storefront are mostly `is_active` / `published` policies;
  admin writes go through `is_admin()` / `has_permission('module.action')`.
* Mutating business logic lives in `SECURITY DEFINER` functions with
  `set search_path = public` — validate inputs and ownership inside them.
* Never let the client insert/update `orders`, `order_items`, `creator_earnings`,
  `reward_transactions`, coupons being consumed, or `profiles.points_balance`.

**Proving it works**

* `pnpm test:db` runs every migration in embedded Postgres (PGlite) with stubbed
  Supabase schemas, then exercises the real RPCs. **Extend
  `scripts/db-smoke-test.mjs`** when you add a column/RPC/pricing rule — it is the
  cheapest way to catch a broken migration, and it asserts seeded data (e.g. the
  branch names) too.
* `supabase test db` (pgTAP) covers RLS policy matrices; add cases there for new
  policies. It needs Docker, so it may be unavailable in a sandbox — say so rather
  than claiming it passed.

---

## 9. i18n workflow

* 13 namespaces (`common, catalog, quote, cart, checkout, orders, creator, employee,
  admin, errors, rewards, tickets, pages`) × 3 locales in
  `web/src/i18n/locales/<locale>/<ns>.json`. **`en` is the source of truth.**
* Use i18next `{{variable}}` interpolation only (not ICU/`{var}`).
* Adding copy:
  1. add the key to `en/<ns>.json`,
  2. run `pnpm i18n:sync` — it rebuilds the zh-* structure from `en`, keeping existing
     translations and filling gaps with English,
  3. translate the newly added zh-* values by hand (the sync tool copies English and
     reports what it added),
  4. `pnpm i18n:check` must pass (key structure + placeholder parity).
* The `admin` namespace is **lazily loaded** (`components/admin/AdminNamespaceGate.tsx`)
  to keep it out of the shared bundle — use `useTranslation('admin')` inside admin
  panels as usual, but never `import` admin JSON into the storefront bundle directly.
* Copy style: short, plain sentences that match the surrounding tone (the UI avoids
  internal jargon and marketing flourish). Traditional and Simplified Chinese should
  read naturally rather than literally translated.

---

## 10. Testing

* **Vitest** (`web`, jsdom, `@` alias): `src/lib/__tests__/*.test.ts` for pure helpers,
  `src/components/__tests__/*` and `src/app/**/__tests__/*` for components/pages.
  Mock `@/lib/supabase` with `vi.mock` and a chainable PostgREST stub (copy the
  `query()` helper in `components/admin/__tests__/panels.test.tsx`).
  Mock `react-i18next` by spreading `importOriginal` and returning
  `useTranslation: () => ({ t: (key) => key })` — spreading matters, because the
  locale store initialises i18next through the real module.
  Wrap components that use react-query in a fresh `QueryClientProvider`.
* **Playwright** (`web/e2e`): smoke tests only. Seed state by `page.addInitScript`
  writing `ma.cart` / `ma.location` to `localStorage` — that is how guest checkout is
  covered without an account.
* **Repo guards** run inside the same Vitest suite: `lib/__tests__/theme-surfaces.test.ts`
  (every colour utility has a theme shade and a dark-mode rule) and
  `lib/__tests__/client-guards.test.ts` (inlinable env vars, `basePath`-safe URLs,
  links to real routes, `formatMoney` instead of currency symbols). They read `src/`
  from disk, so a failure names the offending file.
* **pgTAP** (`supabase/tests`): policy/RPC behaviour against a real Supabase stack.
* When a test asserts user-visible copy or existence of a string, prefer roles/labels
  over raw text where reasonable; several older tests still match text.

---

## 11. Styling & theme

* Tailwind with a small design system in `web/src/app/globals.css`: `.container-ma`
  (page width + responsive padding), `.btn`, `.btn-outline`, `.card`, `.badge`,
  `.input`, `.label`, `.swatch`. Prefer these over ad-hoc utilities.
* `html[data-theme="dark"]` overrides remap `bg-white`, `bg-slate-*`, `text-slate-*`,
  `border-slate-*`, `.card`, `.input`, `.btn-outline`, brand/emerald/red text, etc.
  **When you add a new surface colour, add its dark-mode counterpart there** or it
  will stay light in dark mode. The attribute is applied in `lib/theme.ts` (by
  `components/ThemeSync.tsx` in the root layout, plus an inline pre-paint script) and
  stored under `make-anything-appearance` (`light` | `dark` | `auto`).
* `tailwind.config.ts` defines the **full `brand` ramp, 50–900**. Use any shade
  freely, but check the dark-mode remaps: `bg-brand-50`, `bg-brand-50/60`,
  `bg-brand-100`, `border-brand-200` and `text-brand-700`/`text-brand-800` are
  remapped in §11's dark block, and `bg-brand-600` is dark enough to keep as-is.
  `lib/__tests__/theme-surfaces.test.ts` scans `src/` for every colour utility and
  fails if a shade is missing from the config, or a pale fill / dark text / pale
  border has no `html[data-theme="dark"]` rule — so a typo or a new badge colour
  breaks `pnpm test` instead of silently rendering the wrong thing.
* Wide tables: `main table { display: block; overflow-x: auto }` in `globals.css` keeps
  admin tables scrollable on narrow screens; don't undo it.

---

## 12. Recipes

**Add a settings-backed value**
1. Read it in SQL with
   `coalesce((select (value#>>'{}')::numeric from public.platform_settings where key = 'x.y'), <default>)`.
2. Seed it in the migration (`insert … on conflict do nothing`).
3. Surface it in `components/admin/Settings.tsx` (`SETTING_GROUPS`) + `setting_labels.*`
   in the admin locale files — only if something actually reads it.

**Add a product option type / admin-managed list**
Learn from `product_categories` and `filament_finishes`: the list is a table with
localised `name`, `sort_order`, `is_active`; the storefront and admin forms read the
table, never a hard-coded array.

**Add a database column the UI reads**
1. `alter table … add column if not exists …` in a new migration (defaults for
   existing rows).
2. Update `web/src/lib/types.ts`.
3. Read it via react-query and show it; add dark-mode styling if it introduces colour.
4. Assert it in `scripts/db-smoke-test.mjs`.

**Change a price rule**
Change it in SQL (`price_cart` etc.) *and* mirror it in the display helper
(`lib/sale.ts`, `lib/shipping.ts`, `lib/rewards.ts`), then add/extend a Vitest case
for the helper and a PGlite assertion for the RPC.

**Add a page**
`web/src/app/<route>/page.tsx` with `'use client'`, a `<Suspense>` wrapper if it uses
`useSearchParams`, translations in all three locales, and a nav link only if the page
is meant to be discoverable (the header is deliberately minimal: tickets live under
`/account`, not the header).

**Deploy-related changes**
Nothing here runs at request time: build-time env vars are baked in, and the Pages
workflow (`deploy-web.yml`) runs `pnpm build` + `check-pages-export.mjs` before
uploading `web/out`. If you add an asset or a raw URL, use `withBasePath()`.

---

## 13. Traps checklist

Most of these now fail a check instead of shipping. The guard is named next to
each one; run `pnpm verify` (plus `pnpm build && node scripts/check-pages-export.mjs`)
before you claim a change is done.

* **Editing an applied migration.** `check:repo` fails when a file under
  `supabase/migrations` is modified or deleted against the base branch — add a new
  migration instead (it carries a checksum).
* **A new function that nobody revoked.** Postgres grants `EXECUTE` to `PUBLIC` on
  every new function, and `drop function` + `create` resets the ACL. `check:repo`
  requires every function created by a new migration to state its ACL in the same
  file, and `pnpm test:db` asserts the exact set of functions `anon` may execute
  (`scripts/db-smoke-test.mjs`, `anonAllowlist`). Trigger (`tg_*`) and `_internal`
  helpers are revoked wholesale by `20250101003800_function_acl_hardening.sql`.
* **An edge function stanza with no function** (or vice versa). `check:repo` diffs
  `[functions.x]` in `supabase/config.toml` against `supabase/functions/x/index.ts`.
* **A colour with no dark-mode counterpart** or a shade missing from the theme:
  `src/lib/__tests__/theme-surfaces.test.ts` scans the utilities `src/` uses and
  requires a `html[data-theme="dark"]` rule for pale fills (50–200), dark text
  (600–900) and pale borders, plus the full `brand` 50–900 ramp.
* **`process.env.FOO` in client code** (only `NEXT_PUBLIC_*` / `NODE_ENV` is
  inlined) and **a raw root-relative `href`/`src`** that skips `basePath`:
  `src/lib/__tests__/client-guards.test.ts`. It also fails on links to routes that
  have no `page.tsx`, and on hand-written currency symbols (`formatMoney` instead).
* **Assuming `pnpm dev` reflects `basePath`** — it does not (production only); build
  and run `node scripts/check-pages-export.mjs` when a URL, asset or redirect changes.
* **Showing a total computed in the browser as if it were authoritative.** Only
  `price_cart` / `create_order_from_cart` may decide money; the UI formats what the
  RPC returned.
* **Adding English strings without the zh-* counterparts** — `pnpm i18n:check`.
* **Reading a new persisted-store field without a default** (`ma.cart`,
  `ma.location`, `ma.locale`, `ma.appearance` survive deploys). Keep the default in
  the store initialiser, or bump `version` with a `migrate`.
* **Copying only part of a redefined SQL function** — re-read the whole body from
  the newest migration; the PGlite smoke test covers behaviour, not completeness.
* **Trusting the UI for authorisation** instead of the policy/RPC.
* **Reintroducing store-name location labels**: all locations are branches of one
  shop, so a branch name is just its neighbourhood (`Central`, not
  `Make Anyth.ing Central`).

---

## 14. Definition of done

```bash
pnpm verify                                  # lint, typecheck, tests, db smoke, i18n, repo checks
pnpm build && node scripts/check-pages-export.mjs
```

Plus, where relevant:

* a new/extended Vitest case for pure logic and one for the UI you changed,
* a PGlite assertion in `scripts/db-smoke-test.mjs` for schema/RPC changes,
* `supabase test db` for policy changes (state clearly if Docker was unavailable),
* zh-Hant/zh-Hans copy for every new string,
* a short note in `README.md` / `docs/` when a user-visible rule changes,
* commit on your working branch (never rewrite `main`), and describe the *why* in the
  commit message.

---

## 15. Security invariants

Read this before touching auth, RLS, storage or payments. Most of it is already
asserted by `pnpm verify`; the rest is the reasoning you need to not undo it.

**Clients and keys**
* The browser only ever holds `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY`. A secret
  in a `NEXT_PUBLIC_*` value is shipped to every visitor — `client-guards.test.ts`
  and CI's config check will not save you from a genuinely public value, so never
  put one there.
* `verify_jwt = true` on an Edge Function only proves the JWT was signed by the
  project; **the anon key is one of those JWTs**. A function is public until it
  resolves the caller itself (`supabaseUserClient(req).auth.getUser()`) and checks
  the role from `profiles`. `convert-document` and `stripe-checkout` are the two
  deliberately public endpoints, which is why both are throttled.

**Database**
* RLS is enabled on every `public` table (`pnpm test:db` fails if a new one is not).
  An RLS-enabled table with no policy is deny-all, which is a valid choice.
* `anon` may execute only the functions listed in `anonAllowlist`
  (`scripts/db-smoke-test.mjs`): catalog reads, `price_cart`, and the helpers RLS
  policies call. Anything else must be revoked in the migration that creates it.
* Column privileges are part of the policy. `profiles` is `revoke update` plus an
  explicit column list — **adding a column does not add permission**, so grant it in
  the same migration (that is how `delivery_address` was silently broken).
* `get_setting(key)` is anon-executable and whitelisted to `rewards.*`,
  `document.*` and `features.*`. Platform commission and payout limits stay in the
  admin console's RLS-guarded table reads.
* Every `SECURITY DEFINER` function sets `search_path = public`, and never builds
  SQL from a caller-supplied string.
* Storage: every bucket except `product-images` is private, read through
  `sign-file` (which checks ownership/ticket/order before signing). Buckets carry
  `file_size_limit` and, where the type is fixed, `allowed_mime_types`.
* A customer may delete their own upload from `option-uploads`, `ticket-uploads`
  and `document-prints` so abandoned files do not accumulate. Two rules make that
  work: a DELETE needs a matching SELECT policy to find the row at all (that is
  why `owner read own option uploads` exists), and
  `upload_is_referenced(bucket, name)` refuses to delete a file an order or ticket
  still points at.
* Indexes: `orders.user_id`, the option-group/choice joins, and the `ilike`
  search columns (`orders.order_number`, `orders.contact_email`,
  `profiles.email`, product names/slug) are covered by a btree/trigram index.
  `pnpm test:db` fails if one of the hot-path indexes is dropped.

**Payments**
* The webhook verifies `STRIPE_WEBHOOK_SECRET` and only fulfils a session whose
  `payment_status` is `paid`; delayed methods fulfil on
  `checkout.session.async_payment_succeeded`. There is no other order-creation path.
* `stripe-checkout` accepts `success_url` / `cancel_url` only from
  `PUBLIC_SITE_URLS` (or the caller's own origin). Keep it that way or checkout
  becomes an open redirect.
* Money is formatted with `Intl`/`formatMoney` and the order's own `currency`
  column — the store prices in HKD, so never print `US$`.
* Refunds go through Stripe first and then the caller-scoped `orders` update, so
  the status trigger re-checks the admin role.

**Operational**
* Anything an anonymous visitor can drive repeatedly goes through
  `_shared/throttle.ts` → `consume_throttle(bucket, key, limit, window)`: document
  conversion (20/hour) and checkout session creation (40/10 min). Keys are hashed
  client addresses, never raw IPs, and a counter outage fails open.
* CORS is `Access-Control-Allow-Origin: *` on purpose: authorisation travels in a
  bearer token, not a cookie, so a hostile page cannot borrow a session by
  reflecting an origin. Do not "fix" it without also changing the auth model.
* Errors returned from public endpoints are generic; the Postgres/Stripe detail
  goes to `console.error`. Staff-only endpoints may still explain what failed.
* The header clears the TanStack cache whenever the signed-in user changes. Most
  query keys carry no user id, so keeping the cache would hand one account's
  orders, coupons and earnings to the next person who signs in on the same tab.
* `pnpm audit` must stay at zero. Next is pinned to the latest 15.5 patch (14.x
  is no longer patched and carries advisories that have no 14.x fix); version
  bumps go through `pnpm verify` plus `node scripts/check-pages-export.mjs`.
