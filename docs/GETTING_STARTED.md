# Getting Started

## 1. Install
```
pnpm install
```

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
supabase test db                # pgTAP (RLS matrix, helpers)
node scripts/i18n-check.mjs     # locale key parity
pnpm test:e2e                   # Playwright smoke
```

## 5. Seed users (local)
The Supabase `seed.sql` migration inserts materials, filaments, locations and products, but not auth users.
Create admin/staff users via the dashboard or `create-staff` Edge Function.

## 6. Rewards & coupons (local)
- Points settings live in `platform_settings`: `rewards.points_per_dollar`, `rewards.redeem_options`, `rewards.coupon_days_valid`.
- Two offer codes are seeded so `/offers` works out of the box: `WELCOME10` (10% off) and `HIGHFIVE` ($5 off). Claiming one issues a personal single-use coupon.
- Coupons are applied in the cart or checkout; guests can use unassigned (bearer) coupons, while reward/offer coupons are bound to the account that claimed them.

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
