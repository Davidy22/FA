-- pgTAP tests for the quote-ticket flow. Run via: supabase test db
-- Structural assertions only: RLS matrix for tickets is enforced by the
-- policies in migration 20250101001600 and exercised through the app.

create extension if not exists pgtap;

select plan(8);

-- Ticket tables exist
select ok(not exists (
  select 1 from unnest(array[
  'tickets','ticket_messages','ticket_attachments','ticket_quotes'
]) as expected(name)
  where not exists (select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname=expected.name)
), 'Ticket tables exist');

-- RLS enabled on all ticket tables
select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
      and c.relname in ('tickets','ticket_messages','ticket_attachments','ticket_quotes')
  ),
  'RLS enabled on all ticket tables'
);

-- CHECK constraints on statuses exist
select ok(exists (
  select 1 from pg_constraint where conname = 'tickets_status_check'
), 'tickets status check constraint exists');

select ok(exists (
  select 1 from pg_constraint where conname = 'ticket_quotes_status_check'
), 'ticket_quotes status check constraint exists');

-- Order items can reference a ticket quote
select has_column('public', 'order_items', 'ticket_quote_id',
  'order_items links to ticket quotes');

-- Customer acceptance RPC exists
select has_function('public', 'accept_ticket_quote', array['uuid'],
  'accept_ticket_quote(uuid) exists');

-- price_cart rejects an unknown ticket quote
select throws_ok(
  $$select public.price_cart(jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001',
    'items', jsonb_build_array(jsonb_build_object(
      'kind','ticket','ticket_quote_id','00000000-0000-0000-0000-000000000001','quantity',1
    ))
  ))$$,
  null, null,
  'price_cart rejects an unknown ticket quote'
);

-- Private storage bucket for ticket attachments
select isnt_empty(
  $$select * from storage.buckets where id = 'ticket-uploads'$$,
  'ticket-uploads storage bucket exists'
);

select * from finish();
