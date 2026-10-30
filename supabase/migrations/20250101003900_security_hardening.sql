-- Security review follow-ups: a broken column grant, an over-broad settings
-- reader, a dead anonymous RPC, unbounded storage buckets, and a throttle the
-- public document converter can use.

-- 1. `profiles` updates are column-granted (see …0800), so a column added later
--    is not writable until it is granted. `delivery_address` was added in …3700
--    without one, which made checkout's "save this address" silently fail.
grant update (delivery_address) on public.profiles to authenticated;

-- 2. `get_setting` is executable by anon and used to return *any* row of
--    platform_settings. Storefront code only needs the customer-facing groups;
--    commission and payout thresholds stay with the admin console, which reads
--    the table directly under RLS.
create or replace function public.get_setting(p_key text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select value from public.platform_settings
  where key = p_key
    and (key like 'rewards.%' or key like 'document.%' or key like 'features.%');
$$;
grant execute on function public.get_setting(text) to anon, authenticated;

-- 3. `lookup_order` was a guest order lookup that no page ever called. It was
--    anon-executable and returned the whole order row (contact details, address,
--    Stripe payment intent) to anyone with an order number and an email address.
drop function if exists public.lookup_order(text, text);

-- 4. Bucket limits back up the client-side checks: direct API uploads skip them.
update storage.buckets
  set file_size_limit = 26214400 -- 25 MB, matches the ticket attachment limit
  where id in ('ticket-uploads', 'option-uploads');
update storage.buckets
  set file_size_limit = 10485760, -- 10 MB
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif']
  where id = 'product-images';

-- 5. Throttle for unauthenticated work (the document converter runs LibreOffice
--    on a visitor-supplied 20 MB file). Windows are fixed-length buckets so the
--    table stays small and the check is a single upsert.
create table if not exists public.request_throttle (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key, window_start)
);
create index if not exists request_throttle_window_idx on public.request_throttle(window_start);
alter table public.request_throttle enable row level security;
-- No policies: only the service role (which bypasses RLS) may touch it.
revoke all on public.request_throttle from anon, authenticated;

create or replace function public.consume_throttle(
  p_bucket text,
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if coalesce(p_bucket, '') = '' or coalesce(p_key, '') = ''
     or p_limit is null or p_window_seconds is null
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.request_throttle(bucket, key, window_start, hits)
  values (left(p_bucket, 64), left(p_key, 128), v_window, 1)
  on conflict (bucket, key, window_start)
    do update set hits = public.request_throttle.hits + 1
  returning hits into v_hits;
  -- Two windows of history is enough to answer the next request in a row.
  delete from public.request_throttle
    where window_start < now() - make_interval(secs => p_window_seconds * 2);
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.consume_throttle(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_throttle(text, text, integer, integer) to service_role;
