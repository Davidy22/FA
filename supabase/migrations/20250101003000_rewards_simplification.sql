-- Fixed membership thresholds with a new Platinum tier. Names and multipliers
-- remain configurable, but only at these four product-defined thresholds.
with fixed(ord, tier_name, threshold, default_multiplier) as (
  values
    (1, 'Member', 0, 1::numeric),
    (2, 'Silver', 1000, 2::numeric),
    (3, 'Gold', 5000, 3::numeric),
    (4, 'Platinum', 20000, 4::numeric)
), existing as (
  select value from public.platform_settings where key = 'rewards.tiers'
), normalized as (
  select f.*, (
    select item from jsonb_array_elements(coalesce((select value from existing), '[]'::jsonb)) item
     where item->>'min_lifetime_points' = f.threshold::text limit 1
  ) as config
  from fixed f
), ladder as (
  select jsonb_agg(
    jsonb_build_object(
      'name', coalesce(config->>'name', tier_name),
      'min_lifetime_points', threshold,
      'multiplier', case
        when coalesce(config->>'multiplier', '') ~ '^[0-9]+([.][0-9]+)?$'
             and (config->>'multiplier')::numeric >= 1
          then (config->>'multiplier')::numeric
        else default_multiplier
      end
    ) order by ord
  ) as value from normalized
)
insert into public.platform_settings(key, value)
select 'rewards.tiers', value from ladder
on conflict (key) do update set value = excluded.value;

-- Resolve the qualifying fixed tier, then read only its multiplier from the
-- setting. Missing or malformed rows use the default multiplier for that tier.
create or replace function public.reward_multiplier(p_lifetime_points integer)
returns numeric
language plpgsql stable
set search_path = public
as $$
declare
  v_tiers jsonb;
  v_tier jsonb;
  v_points int := greatest(coalesce(p_lifetime_points, 0), 0);
  v_threshold int;
  v_default numeric;
  v_configured numeric;
begin
  v_threshold := case
    when v_points >= 20000 then 20000
    when v_points >= 5000 then 5000
    when v_points >= 1000 then 1000
    else 0
  end;
  v_default := case v_threshold
    when 20000 then 4 when 5000 then 3 when 1000 then 2 else 1
  end;

  select value into v_tiers from public.platform_settings where key = 'rewards.tiers';
  if v_tiers is not null and jsonb_typeof(v_tiers) = 'array' then
    for v_tier in select value from jsonb_array_elements(v_tiers) loop
      if v_tier->>'min_lifetime_points' = v_threshold::text
         and coalesce(v_tier->>'multiplier', '') ~ '^[0-9]+([.][0-9]+)?$'
         and (v_tier->>'multiplier')::numeric >= 1 then
        v_configured := (v_tier->>'multiplier')::numeric;
        exit;
      end if;
    end loop;
  end if;
  return greatest(coalesce(v_configured, v_default), 1);
end;
$$;

-- Reward coupons always last one calendar year. Offer-code and manually issued
-- coupon expiry controls are independent and are not changed by this migration.
create or replace function public.redeem_rewards(p_option_index int)
returns public.coupons
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_opts jsonb;
  v_opt jsonb;
  v_points int;
  v_product uuid;
  v_coupon public.coupons;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_option_index is null or p_option_index < 0 then
    raise exception 'Invalid redemption option';
  end if;

  select value into v_opts from public.platform_settings where key = 'rewards.redeem_options';
  if v_opts is null or jsonb_typeof(v_opts) <> 'array'
     or jsonb_array_length(v_opts) = 0
     or p_option_index >= jsonb_array_length(v_opts) then
    raise exception 'Invalid redemption option';
  end if;

  v_opt := v_opts -> p_option_index;
  v_points := (v_opt ->> 'points')::int;
  if v_points is null or v_points <= 0 then
    raise exception 'Invalid redemption option';
  end if;
  if coalesce((v_opt ->> 'discount_type'), '') not in ('percent','fixed')
     or coalesce((v_opt ->> 'discount_value')::numeric, 0) <= 0 then
    raise exception 'Invalid redemption option';
  end if;

  v_product := nullif(btrim(coalesce(v_opt ->> 'product_id', '')), '')::uuid;
  if v_product is not null and not exists (
    select 1 from public.premade_products where id = v_product and status = 'published'
  ) then
    raise exception 'Invalid redemption option';
  end if;

  -- Atomic conditional deduction: fails the whole call when short on points.
  update public.profiles
     set points_balance = points_balance - v_points
   where id = v_uid
     and points_balance >= v_points;
  if not found then
    raise exception 'Not enough points';
  end if;

  loop
    begin
      insert into public.coupons(code, user_id, source, discount_type, discount_value,
                                 product_id, expires_at)
      values (public._coupon_code('RW', 10), v_uid, 'reward',
              v_opt ->> 'discount_type', (v_opt ->> 'discount_value')::numeric,
              v_product, now() + interval '1 year')
      returning * into v_coupon;
      exit;
    exception when unique_violation then
      -- code collision; retry with a fresh random code
      continue;
    end;
  end loop;

  insert into public.reward_transactions(user_id, points, type, coupon_id, memo)
  values (v_uid, -v_points, 'redeem', v_coupon.id, 'Redeemed ' || v_points || ' points for ' || v_coupon.code);

  return v_coupon;
end;
$$;

revoke execute on function public.redeem_rewards(int) from public;
grant execute on function public.redeem_rewards(int) to authenticated;

delete from public.platform_settings where key = 'rewards.coupon_days_valid';
