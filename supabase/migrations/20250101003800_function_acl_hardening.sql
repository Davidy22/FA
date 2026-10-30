-- Function ACL hardening.
--
-- Postgres grants EXECUTE on a new function to PUBLIC. Several functions below
-- were created without revoking that default, and because
-- `create or replace function` keeps the existing ACL, every later redefinition
-- silently kept the door open. Anonymous visitors could call staff RPCs and
-- trigger helpers directly; the only thing stopping them was the guard inside
-- the body.
--
-- Trigger functions never need a grant (the trigger runs with the table owner's
-- privileges), and `next_order_number` / `auth_role` are only reached from other
-- SECURITY DEFINER functions, so those are closed to every client role.
-- `admin_generate_coupons` and `accept_ticket_quote` stay available to signed-in
-- users, which is how the admin console and the quote ticket call them.
--
-- The allowlist of functions anon may still execute is asserted in
-- scripts/db-smoke-test.mjs, so a future function cannot re-open a hole quietly.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Trigger functions never check EXECUTE (the trigger fires as the table owner)
-- and `_`-prefixed helpers are only reached from SECURITY DEFINER RPCs, so no
-- client role needs either. Doing it by convention also covers the next one.
do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.proname like 'tg\_%' or p.proname like '\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
revoke all on function public.next_order_number() from public, anon, authenticated;
revoke all on function public.auth_role() from public, anon, authenticated;

revoke all on function public.accept_ticket_quote(uuid) from public, anon;
grant execute on function public.accept_ticket_quote(uuid) to authenticated;

revoke all on function public.admin_generate_coupons(integer, text, text, numeric, numeric, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.admin_generate_coupons(integer, text, text, numeric, numeric, uuid, timestamptz, uuid, integer) to authenticated;
