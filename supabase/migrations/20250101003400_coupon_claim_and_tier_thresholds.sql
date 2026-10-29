-- Raise the fixed membership milestones, preserving each tier's current label
-- and earning multiplier. This setting is no longer exposed in the admin UI.
update public.platform_settings
set value = (
  select jsonb_agg(
    case
      when (tier->>'min_lifetime_points')::integer = 5000
        then jsonb_set(tier, '{min_lifetime_points}', '10000'::jsonb)
      when (tier->>'min_lifetime_points')::integer = 20000
        then jsonb_set(tier, '{min_lifetime_points}', '100000'::jsonb)
      else tier
    end order by ordinality
  )
  from jsonb_array_elements(value) with ordinality as tiers(tier, ordinality)
)
where key = 'rewards.tiers' and jsonb_typeof(value) = 'array';

insert into public.platform_settings(key, value) values
  ('rewards.tiers', '[{"name":"Member","min_lifetime_points":0,"multiplier":1},{"name":"Silver","min_lifetime_points":1000,"multiplier":2},{"name":"Gold","min_lifetime_points":10000,"multiplier":3},{"name":"Platinum","min_lifetime_points":100000,"multiplier":4}]'::jsonb)
on conflict (key) do nothing;

-- A QR redemption binds a discount coupon to the signed-in account. A points-
-- only coupon is consumed and credited immediately, without requiring checkout.
create or replace function public.redeem_coupon_code(p_code text)
returns public.coupons
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_coupon public.coupons;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null then raise exception 'Sign in to claim this coupon'; end if;
  if v_code = '' then raise exception 'Enter a coupon code'; end if;

  select * into v_coupon from public.coupons where code = v_code for update;
  if not found then raise exception 'Invalid coupon code'; end if;
  if v_coupon.status <> 'active' then raise exception 'Coupon already used'; end if;
  if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then raise exception 'Coupon expired'; end if;
  if v_coupon.user_id is not null and v_coupon.user_id <> v_uid then
    raise exception 'Coupon is not valid for this account';
  end if;

  if v_coupon.discount_value = 0 and coalesce(v_coupon.grant_points, 0) > 0 then
    update public.coupons set user_id = v_uid, status = 'used', used_at = now()
      where id = v_coupon.id returning * into v_coupon;
    update public.profiles set points_balance = points_balance + v_coupon.grant_points,
      lifetime_points = lifetime_points + v_coupon.grant_points where id = v_uid;
    insert into public.reward_transactions(user_id, points, type, coupon_id, memo)
      values (v_uid, v_coupon.grant_points, 'grant', v_coupon.id, 'Claimed coupon ' || v_coupon.code);
  else
    update public.coupons set user_id = v_uid where id = v_coupon.id returning * into v_coupon;
  end if;
  return v_coupon;
end;
$$;

revoke all on function public.redeem_coupon_code(text) from public, anon;
grant execute on function public.redeem_coupon_code(text) to authenticated;
