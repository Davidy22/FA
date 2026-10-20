# Getting Started

## 1. Install
```
pnpm setup                 # one-shot install of every workspace dependency
# (equivalent to: pnpm install)
```
All runtime dependencies (including `pdf-lib` and `leaflet`) are declared in
`web/package.json`, so a single install at the repository root is enough.

## 2. Start Supabase (requires Docker)
```
supabase start
supabase db reset          # applies migrations + seed
```

## 3. Run the web app
```
cd web
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2) \
pnpm dev
```

## 4. Run tests
```
pnpm test                       # Vitest (pricing, i18n helpers, formatters)
pnpm test:db                    # embedded PostgreSQL migrations/admin/checkout smoke tests; no Docker
supabase test db                # pgTAP (full Supabase/RLS matrix; requires Docker)
node scripts/i18n-check.mjs     # locale key parity
pnpm test:e2e                   # Playwright smoke
```

## 5. First admin account and staff
### Local accounts, automatically restored by reset
`supabase db reset` applies the catalog migrations, then `supabase/seed.sql`. The seed creates confirmed email/password accounts (including their Auth identities and profiles), with the employee assigned to the seeded Hong Kong location. Sign in at `/login` with:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@example.test` | `LocalTest123!` |
| Employee | `employee@example.test` | `LocalTest123!` |
| Customer | `customer@example.test` | `LocalTest123!` |

The seed can be rerun locally without duplicate accounts. Use `supabase db reset --no-seed` to opt out. **These published credentials are only for disposable local development databases:** never use this seed or these passwords on staging/production, and do not commit real credentials. `supabase db push` applies migrations but does **not** run `seed.sql`.

### First admin on a hosted project (without demo passwords)
1. Deploy database migrations and Edge Functions (`supabase db push` and `supabase functions deploy`). Do not expose your Supabase service-role key to the web app.
2. Configure the **Edge Function secret** `ADMIN_BOOTSTRAP_EMAIL` with the exact email address that will own the first admin account: `supabase secrets set ADMIN_BOOTSTRAP_EMAIL=your-test-email@example.com`. If testing this flow locally without the seeded accounts, put it in the ignored `supabase/functions/.env` before starting/serving functions. This value is server-side only.
3. Register that email at `/login` and confirm it if email confirmation is enabled. Sign in, open `/admin`, and select **Activate initial admin account**. Only a verified session for the configured address succeeds, and the operation is disabled once any active admin exists.
4. Thereafter, use `/admin` → **Users** to promote existing accounts, assign staff to a location, disable/re-enable users, or invite new staff. Leave the invitation password blank for an email invite; if using a temporary password, communicate it securely.

The admin console also manages locations (map coordinates, country and rates — new locations default to Hong Kong, HKD and `Asia/Hong_Kong`, and sales tax follows the location's country, so a Hong Kong location is always tax-free while a location abroad keeps the rate its admin sets), available materials/filaments and location stock, product listings/options, review decisions, orders, tickets, payouts, offers/coupons (including points redemption and bulk coupon codes) and platform settings. Add/edit panels open **above** the list they belong to. The header's location control is a **link** to `/locations`, the existing searchable/map picker. Changing the location for a customer does not require any admin permission.

## 6. Rewards & coupons (local)
- Points settings live in `platform_settings`: `rewards.points_per_dollar`, `rewards.redeem_options`, `rewards.coupon_days_valid`. Earn rates and coupon validity are edited under **Admin → Platform settings**; the redemption options themselves are edited under **Admin → Offers & coupons**, next to the coupon tools they issue.
- A redemption option may name a product, so points can be traded for a specific item (100% off that product = a free item). The option's product must be published.
- Two offer codes are seeded so `/offers` works out of the box: `WELCOME10` (10% off) and `HIGHFIVE` (HK$5 off). Claiming one issues a personal single-use coupon.
- Coupons and offer codes can carry conditions: a **minimum spend** and/or a **single product** the discount applies to. `price_cart` enforces both, so the cart, checkout and the Stripe webhook all agree.
- **Admin → Offers & coupons → Bulk generate codes** creates up to 500 single-use codes in one call (`admin_generate_coupons`) and lists them ready to copy; issuing a single coupon with a blank code mints one automatically.
- Coupons are applied in the cart or checkout; guests can use unassigned (bearer) coupons, while reward/offer coupons are bound to the account that claimed them.
- There is no minimum-order fee: a US$1 document print totals US$1 (plus sales tax only where the pickup location's country has one).
- Referral codes live with the points balance on `/rewards#referrals`. A new customer gets 10 points for the referrer at sign-up and 50 more after their first order.

## 7. Deploy the frontend to GitHub Pages

The workflow is `.github/workflows/deploy-web.yml` (**Deploy Web**). It builds
`web/out`, uploads that directory as the `github-pages` artifact, and publishes it
in a separate deployment job. No `gh-pages` branch or committed build output is
needed.

### One-time GitHub configuration

1. In the repository's **Settings → Pages → Build and deployment**, select
   **Source: GitHub Actions**. For `Davidy22/FA`, this is already selected and the
   site URL is **https://davidy22.github.io/FA/**.
2. Open **Settings → Environments → staging → Environment variables** and add:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Your hosted Supabase project URL, e.g. `https://<project-ref>.supabase.co` (not localhost). |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | That project's public `anon` key (or publishable key), from Supabase's project settings/API keys. |

   Alternatively, set these under **Settings → Secrets and variables → Actions
   → Variables** at repository level if all builds should use the same backend.
   The workflow also accepts Actions **secrets** with the same names, so existing
   secret-based configuration does not need to be copied. Variables take
   precedence over secrets.

   These are **public browser configuration** and are embedded in the downloaded
   JavaScript even if stored as GitHub secrets. **Never** put a Supabase
   `service_role`/secret key, database password, Supabase access token, or Stripe
   secret key in a `NEXT_PUBLIC_*` value. Backend security depends on RLS.

   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are
   passed through when configured, but are not required to publish the frontend.
3. Do **not** set `NEXT_PUBLIC_BASE_PATH` in Actions. `actions/configure-pages`
   supplies the actual Pages path **before** the build: `/FA` for this project
   site, or an empty path for a root/custom-domain site. The workflow ignores any
   old Actions variable with this name. This ensures scripts, styles, navigation,
   favicon, and checkout return URLs stay inside the deployed site.
4. In **Settings → Environments → github-pages**, allow deployments from the
   **main** branch. This repository already has that rule. Keep this deployment
   environment separate from `staging`/`prod`, which select the backend build
   configuration. If required reviewers are configured, approve the deployment
   when GitHub requests it.

### Publish and verify

1. Merge the workflow fixes into **main**. A push to `main` runs **Deploy Web**
   using the `staging` backend configuration.
2. To retry or rebuild after changing variables, open **Actions → Deploy Web →
   Run workflow**, choose branch **main**, and select **staging** (or **prod** if
   configured). Changing a variable alone does not trigger a new build: public
   configuration is baked into the static files.
3. Check both jobs: **build** should upload the Pages artifact, then **deploy**
   should publish it. The deployment job's environment URL links to the live site.
4. Open **https://davidy22.github.io/FA/**. Also load a route directly, such as
   **https://davidy22.github.io/FA/catalog/**, and refresh it. Scripts/styles should
   load from `/FA/_next/`, not `/_next/`. The workflow and CI verify the exported
   files and their asset URLs before upload.

**Release/prod builds:** Publishing a release selects the `prod` build environment;
create it and set its public variables (or use repository-level values) first.
The `github-pages` environment currently only permits the `main` branch, so release
builds also need a **tag** deployment rule matching your release tags. Alternatively,
run the workflow manually on **main** with **prod**, which needs no tag rule change.
There is only **one Pages site** for this repository: staging/prod deployments
replace the same site, not two separate URLs.

### Backend setup is separate

Pages hosts the frontend only; it does not create or migrate a Supabase project.
The **Migrate DB** workflow needs `SUPABASE_PROJECT_REF` as an environment variable
and `SUPABASE_ACCESS_TOKEN` as an environment secret in the selected `staging` or
`prod` environment. Complete the Supabase database/Edge Function setup for catalog,
auth, uploads, and payments to work. In Supabase **Authentication → URL
Configuration**, set the Site URL and allowed redirect URLs to the deployed site
(including `/FA/`), rather than localhost.

A failing **CI**, **Migrate DB**, or **Nightly E2E** run is distinct from a
**Deploy Web** run; those workflows are not deployment dependencies. If **Deploy
Web** stops at **Check public frontend configuration**, set the named missing
variable(s) in the selected build environment and start a new run. If it stops at
**Configure Pages**, recheck **Settings → Pages → Source: GitHub Actions**. If the
**deploy** job is rejected, check the `github-pages` branch/tag rules and approvals.

## 8. Google, Facebook, and GitHub sign-in
1. Create an OAuth app with each provider and register the Supabase callback:
   - Local: `http://localhost:54321/auth/v1/callback`
   - Hosted: `https://<project-ref>.supabase.co/auth/v1/callback`
2. Copy `.env.example` to `.env` at the repository root and fill in the client IDs/secrets. `supabase/config.toml` reads these through `env()`.
3. Set `enabled = true` under the matching `[auth.external.*]` section in `supabase/config.toml`, then restart Supabase (`supabase stop && supabase start`).
4. Add the web app callback to **Authentication → URL Configuration → Redirect URLs**:
   - `http://localhost:3000/auth/callback/`
   - `https://<your-site>/auth/callback/` (for GitHub Pages: `https://<user>.github.io/<repo>/**`)
   Set **Site URL** to the deployed site so provider redirects land back in the app.
5. Account linking uses `supabase.auth.linkIdentity()`, which requires **Enable Manual Linking** in the hosted dashboard (local config sets `enable_manual_linking = true`). Enable the providers and redirect URLs in the hosted dashboard too; `config.toml` only configures the local stack.

Sign-in providers appear on `/login`; connected methods are managed on `/account`. If a provider is not enabled, the page shows a setup hint instead of failing silently.

## 9. Location map
- The map pins use `locations.lat` / `locations.lng` and OpenStreetMap tiles (no API key). Set coordinates from `/admin` → **Locations**; locations without coordinates still appear in the searchable list.
- With zero or one active location the picker, prompt, and map are hidden automatically; the only location is selected for the user.

## 10. Document printing
- PDF page counts are read in the browser with `pdf-lib` (loaded on demand). If you see `Module not found: Can't resolve 'pdf-lib'`, run `pnpm install` at the repository root and restart the dev server.

## 11. Quote tickets
- `/quote` is a contact form (subject, message, up to 5 attachments) that opens a support/quote ticket. Sign-in is required so the thread persists.
- Customers reply on `/tickets`; staff reply, quote a price, and resolve tickets from the Employee Portal → Quote tickets (`/employee/tickets`).
- A staff quote has a description, unit price, and quantity, and is valid for 7 days. The customer accepts it from `/tickets`, which adds the quoted item to the cart (`kind: 'ticket'`).
- Ticket prices are authoritative server-side: `price_cart` reads the `ticket_quotes` row (status must be `accepted`, unexpired, and the cart user must own the ticket). Fulfilling the order marks the quote `ordered` and links `order_items.ticket_quote_id`.
- Attachments live in the private `ticket-uploads` storage bucket under `<user-id>/<ticket-id>/<file>`; downloads go through the `sign-file` Edge Function (owner, staff at the ticket's location, or admin).
