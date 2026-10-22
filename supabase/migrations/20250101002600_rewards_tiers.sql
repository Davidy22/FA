-- Membership tiers: the more a customer has spent over their lifetime, the
-- faster they earn points.
--
-- profiles.lifetime_points counts points *earned* (never reduced by
-- redemptions). The award trigger picks the customer's tier from that lifetime
-- total before crediting the order, multiplies the configured base rate
-- (rewards.points_per_dollar) by the tier multiplier, and increments both the
-- spendable balance and the lifetime total.
--
-- Tiers live in platform_settings `rewards.tiers` so an admin can retune the
-- thresholds, multipliers and names without a deploy. Shape:
--   [{ "name": "Member", "min_lifetime_points": 0,    "multiplier": 1 },
--    { "name": "Silver", "min_lifetime_points": 1000, "multiplier": 2 },
--    { "name": "Gold",   "min_lifetime_points": 5000, "multiplier": 3 }]
-- A missing/empty setting falls back to a single 1x tier.

alter table public.profiles
  add column if not exists lifetime_points integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_lifetime_points_nonnegative;
alter table public.profiles
  add constraint profiles_lifetime_points_nonnegative check (lifetime_points >= 0);

-- Backfill from the append-only ledger: every positive entry is an earn.
update public.profiles p
   set lifetime_points = coalesce((
     select sum(r.points)::int from public.reward_transactions r
      where r.user_id = p.id and r.points > 0
   ), 0)
 where p.lifetime_points = 0;

insert into public.platform_settings(key, value) values
  ('rewards.tiers',
   '[{"name":"Member","min_lifetime_points":0,"multiplier":1},
     {"name":"Silver","min_lifetime_points":1000,"multiplier":2},
     {"name":"Gold","min_lifetime_points":5000,"multiplier":3}]'::jsonb)
on conflict (key) do nothing;

-- The multiplier that applies to a customer with p_lifetime_points points.
-- Ignores malformed rows; the highest qualifying tier wins.
create or replace function public.reward_multiplier(p_lifetime_points integer)
returns numeric
language plpgsql stable
set search_path = public
as $$
declare
  v_tiers jsonb;
  v_tier jsonb;
  v_best numeric := 1;
  v_best_min int := -1;
  v_min int;
  v_mult numeric;
begin
  select value into v_tiers from public.platform_settings where key = 'rewards.tiers';
  if v_tiers is null or jsonb_typeof(v_tiers) <> 'array' or jsonb_array_length(v_tiers) = 0 then
    return 1;
  end if;
  for v_tier in select value from jsonb_array_elements(v_tiers) loop
    v_min := coalesce((v_tier->>'min_lifetime_points')::int, 0);
    v_mult := coalesce((v_tier->>'multiplier')::numeric, 1);
    if v_mult < 1 or v_min < 0 then continue; end if;
    if coalesce(p_lifetime_points, 0) >= v_min and v_min >= v_best_min then
      v_best := v_mult;
      v_best_min := v_min;
    end if;
  end loop;
  return greatest(v_best, 1);
end;
$$;

create or replace function public.tg_award_reward_points()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rate numeric := 1;
  v_multiplier numeric := 1;
  v_lifetime int := 0;
  v_points int;
begin
  -- Only registered accounts earn points; guests have no account to credit.
  if new.user_id is null then
    return new;
  end if;

  select coalesce((value #>> '{}')::numeric, 1) into v_rate
    from public.platform_settings where key = 'rewards.points_per_dollar';
  select coalesce(lifetime_points, 0) into v_lifetime
    from public.profiles where id = new.user_id;
  v_multiplier := public.reward_multiplier(v_lifetime);

  v_points := floor(coalesce(new.total_amount, 0) * v_rate * v_multiplier)::int;
  if v_points <= 0 then
    return new;
  end if;

  update public.profiles
     set points_balance = points_balance + v_points,
         lifetime_points = lifetime_points + v_points
   where id = new.user_id;

  insert into public.reward_transactions(user_id, points, type, order_id, memo)
  values (new.user_id, v_points, 'order_earn', new.id,
          'Order ' || new.order_number
          || case when v_multiplier > 1 then ' (' || trim(trailing '.' from trim(trailing '0' from to_char(v_multiplier, 'FM990.00'))) || '× tier)' else '' end);

  return new;
end;
$$;

drop trigger if exists orders_award_reward_points on public.orders;
create trigger orders_award_reward_points
after insert on public.orders
for each row execute function public.tg_award_reward_points();
