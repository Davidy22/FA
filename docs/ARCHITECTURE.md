# Architecture

Fab Anything is a static SPA on GitHub Pages backed by a single Supabase free-tier project.

- Frontend: Next.js 14 static export (`output: 'export'`), React, Tailwind, TanStack Query, Zustand.
- Backend: Supabase Postgres + RLS + RPCs + Auth + Storage + Deno Edge Functions.
- Payments: Stripe Checkout hosted redirect + webhook.
- i18n: react-i18next + ICU with three locales (en, zh-Hant, zh-Hans). Parity enforced by `scripts/i18n-check.mjs`.
- Quotation: client-side heuristic in pure TypeScript (web worker stub present) — server re-parses via `verify-model`.

See `supabase/migrations/` for the schema and RLS; see `supabase/functions/` for Stripe integration, model verification, and admin actions.
