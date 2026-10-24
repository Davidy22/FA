-- Support the catalog's reverse material lookup and the creator dashboard's
-- owner-scoped history/balance queries. Forward product and earnings lookups
-- already have suitable primary/composite indexes.
create index product_materials_material_product_idx
  on public.product_materials(material_id, product_id);
create index filaments_material_active_idx
  on public.filaments(material_id) where is_active = true;
create index model_submissions_submitter_created_idx
  on public.model_submissions(submitter_id, created_at desc);
create index payouts_creator_status_amount_idx
  on public.payouts(creator_id, status, amount);

-- Requested/processing payouts reserve funds and paid payouts consume them.
-- Rejected payouts deliberately release their funds back to the creator.
create or replace function public._creator_available_balance(p_creator_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((
      select sum(ce.amount) from public.creator_earnings ce
      where ce.creator_id = p_creator_id
    ), 0) - coalesce((
      select sum(p.amount) from public.payouts p
      where p.creator_id = p_creator_id
        and p.status in ('requested', 'processing', 'paid')
    ), 0),
    0
  );
$$;

revoke all on function public._creator_available_balance(uuid) from public;

-- Aggregate the creator dashboard in Postgres instead of downloading the
-- creator's entire earnings ledger into the browser on every visit.
create or replace function public.creator_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  return (
    select jsonb_build_object(
      'balance', public._creator_available_balance(v_uid),
      'sales', count(*) filter (where ce.type = 'sale')
    )
    from public.creator_earnings ce
    where ce.creator_id = v_uid
  );
end;
$$;

revoke all on function public.creator_dashboard_summary() from public;
grant execute on function public.creator_dashboard_summary() to authenticated;

-- Use the same available-balance rule at payout time. Paid payouts must not
-- become spendable again, and the profile lock serializes concurrent requests.
create or replace function public.request_payout(p_amount numeric)
returns public.payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_min numeric;
  v_available numeric;
  v_open_count int;
  v_payout public.payouts;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'Profile not found'; end if;

  select coalesce((value#>>'{}')::numeric, 50) into v_min
    from public.platform_settings where key = 'payouts.min_amount';
  v_min := coalesce(v_min, 50);
  if p_amount is null or p_amount < v_min then
    raise exception 'Minimum payout amount is %', v_min;
  end if;

  select count(*) into v_open_count from public.payouts
    where creator_id = v_uid and status in ('requested', 'processing');
  if v_open_count > 0 then raise exception 'An open payout already exists'; end if;

  v_available := public._creator_available_balance(v_uid);
  if v_available < p_amount then raise exception 'Insufficient balance'; end if;

  insert into public.payouts(creator_id, amount, status, method)
  values (v_uid, p_amount, 'requested', 'manual')
  returning * into v_payout;

  return v_payout;
end;
$$;

revoke all on function public.request_payout(numeric) from public;
grant execute on function public.request_payout(numeric) to authenticated;
