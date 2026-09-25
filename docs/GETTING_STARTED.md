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
