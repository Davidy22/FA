-- Two operational tables grow with traffic and are never read again: every
-- checkout attempt writes a `checkout_sessions` row (a full cart plus the
-- customer's contact details) and every Stripe delivery writes a `stripe_events`
-- row (the whole event payload). On a free-tier plan they eventually dominate
-- the database, so prune them from the one place that is guaranteed to run:
-- the payment webhook.

create index if not exists checkout_sessions_created_at_idx
  on public.checkout_sessions (created_at);
create index if not exists stripe_events_received_at_idx
  on public.stripe_events (received_at);

create or replace function public.prune_operational_tables(
  p_checkout_days integer default 30,
  p_event_days integer default 90
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_sessions integer;
  v_events integer;
begin
  if p_checkout_days is null or p_event_days is null
     or p_checkout_days < 1 or p_event_days < 1 then
    raise exception 'Retention windows must be at least one day';
  end if;

  -- A checkout session older than the window that never produced an order can
  -- only belong to an abandoned checkout; the Stripe session itself is long
  -- expired (24h by default) so nothing can be paid against it any more.
  delete from public.checkout_sessions
    where created_at < now() - make_interval(days => p_checkout_days);
  get diagnostics v_sessions = row_count;

  -- Stripe retries a delivery for up to three days, so 90 days of ids keeps a
  -- very generous idempotency window without hoarding payloads.
  delete from public.stripe_events
    where received_at < now() - make_interval(days => p_event_days);
  get diagnostics v_events = row_count;

  return jsonb_build_object('checkout_sessions', v_sessions, 'stripe_events', v_events);
end;
$$;
-- Service role only: it deletes rows that no customer is allowed to see.
revoke all on function public.prune_operational_tables(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_operational_tables(integer, integer) to service_role;
