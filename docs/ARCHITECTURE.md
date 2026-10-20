# Architecture

Make Anyth.ing is a static SPA on GitHub Pages backed by a single Supabase free-tier project.

- Frontend: Next.js 14 static export (`output: 'export'`), React, Tailwind, TanStack Query, Zustand.
- Backend: Supabase Postgres + RLS + RPCs + Auth + Storage + Deno Edge Functions.
- Payments: Stripe Checkout hosted redirect + webhook.
- i18n: react-i18next + ICU with three locales (en, zh-Hant, zh-Hans). Parity enforced by `scripts/i18n-check.mjs`. The initial language comes from the browser's language preference, then from its region (or time zone), then English — so a `zh-HK` browser lands on 繁體中文 while an `en-HK` browser keeps English.
- Market: Hong Kong first. Locations, orders and the demo seed default to country `HK`, currency `HKD` and `Asia/Hong_Kong`; `formatMoney` renders every amount in the location's own currency (`HK$` by default, `US$` for a location abroad). Sales tax is a property of the location's country (`public.no_sales_tax_countries()` / `sales_tax_rate()`), so Hong Kong checkout is tax-free and the tax line is omitted entirely when nothing is charged, while a taxable country keeps the rate its admin sets.
- Quotation: client-side heuristic in pure TypeScript (web worker stub present) — server re-parses via `verify-model`. The `/quote` page is a contact form that opens a ticket (`tickets` / `ticket_messages` / `ticket_attachments` / `ticket_quotes`); staff reply in the thread and quote a price, which the customer accepts into the cart (`price_cart` kind `ticket`).

See `supabase/migrations/` for the schema and RLS; see `supabase/functions/` for Stripe integration, model verification, and admin actions.
