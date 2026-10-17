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
- Referral codes live with the points balance on `/rewards#referrals`. A new customer gets 10 points for the referrer at sign-up and 50 more after their first order.

## 7. Google, Facebook, and GitHub sign-in
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

## 8. Location map
- The map pins use `locations.lat` / `locations.lng` and OpenStreetMap tiles (no API key). Set coordinates in Supabase Studio; locations without coordinates still appear in the searchable list.
- With zero or one active location the picker, prompt, and map are hidden automatically; the only location is selected for the user.

## 9. Document printing
- PDF page counts are read in the browser with `pdf-lib` (loaded on demand). If you see `Module not found: Can't resolve 'pdf-lib'`, run `pnpm install` at the repository root and restart the dev server.
