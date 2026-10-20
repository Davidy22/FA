-- Conditional coupons: minimum spend and single-product scope.
--
-- A coupon can now require a minimum cart subtotal and/or apply to one product
-- only. Both conditions are stored on the coupon, enforced by price_cart (so the
-- cart, checkout, and the Stripe webhook all see the same rules), and inherited
-- by coupons issued from offer codes and point redemptions — which is how a
-- "redeem 500 points for this keychain" reward works.
-- Also adds admin_generate_coupons() so staff can create a batch of single-use
-- codes at once instead of typing them one by one.

alter table public.coupons
  add column if not exists min_subtotal numeric(10,2)
    check (min_subtotal is null or min_subtotal > 0),
  add column if not exists product_id uuid references public.premade_products(id) on delete set null;

alter table public.offer_codes
  add column if not exists min_subtotal numeric(10,2)
    check (min_subtotal is null or min_subtotal > 0),
  add column if not exists product_id uuid references public.premade_products(id) on delete set null;

-- An empty prefix is allowed now (the random part alone satisfies the 6-char minimum).
create or replace function public._coupon_code(p_prefix text default 'MA', p_len int default 10)
returns text
language plpgsql volatile
set search_path = public
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_out text := '';
  i int;
begin
  for i in 1..p_len loop
    v_out := v_out || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
  end loop;
  return coalesce(p_prefix, '') || v_out;
end;
$$;

-- Discount for a coupon against a cart. p_product_totals maps product_id to the
-- summed line total for that product, so a product-scoped coupon only discounts
-- the item it names (and never more than the cart subtotal).
drop function if exists public._coupon_discount(public.coupons, numeric);
create function public._coupon_discount(
  p_coupon public.coupons,
  p_subtotal numeric,
  p_product_totals jsonb default null
)
returns numeric
language sql immutable
set search_path = public
as $$
  select least(
    greatest(coalesce(p_subtotal, 0), 0),
    case when p_coupon.product_id is null then
      case when p_coupon.discount_type = 'percent'
           then round(greatest(coalesce(p_subtotal, 0), 0) * p_coupon.discount_value / 100.0, 2)
           else p_coupon.discount_value
      end
    else
      least(
        coalesce((p_product_totals ->> p_coupon.product_id::text)::numeric, 0),
        case when p_coupon.discount_type = 'percent'
             then round(coalesce((p_product_totals ->> p_coupon.product_id::text)::numeric, 0)
                        * p_coupon.discount_value / 100.0, 2)
             else p_coupon.discount_value
        end
      )
    end
  );
$$;

-- Raises when a valid coupon does not apply to this cart, with a message the
-- cart/checkout UI can show next to the coupon field.
create or replace function public._assert_coupon_applies(
  p_coupon public.coupons,
  p_subtotal numeric,
  p_product_totals jsonb
)
returns void
language plpgsql stable
set search_path = public
as $$
declare
  v_eligible numeric;
  v_product text;
begin
  if p_coupon.min_subtotal is not null and coalesce(p_subtotal, 0) < p_coupon.min_subtotal then
    raise exception 'Spend at least % to use this coupon', p_coupon.min_subtotal;
  end if;
  if p_coupon.product_id is not null then
    v_eligible := coalesce((p_product_totals ->> p_coupon.product_id::text)::numeric, 0);
    if v_eligible <= 0 then
      select coalesce(name->>'en', slug) into v_product
        from public.premade_products where id = p_coupon.product_id;
      raise exception 'This coupon only applies to %', coalesce(v_product, 'one specific product');
    end if;
  end if;
end;
$$;

-- ------- redeem_rewards: product-scoped redemptions -------
-- Option shape (platform_settings `rewards.redeem_options`):
--   { points, discount_type, discount_value, product_id? }
-- With product_id the issued coupon only discounts that product, so 100% turns
-- the redemption into "trade points for this item".
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
  v_days int;
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

  select coalesce((value #>> '{}')::int, 90) into v_days
    from public.platform_settings where key = 'rewards.coupon_days_valid';

  loop
    begin
      insert into public.coupons(code, user_id, source, discount_type, discount_value,
                                 product_id, expires_at)
      values (public._coupon_code('RW', 10), v_uid, 'reward',
              v_opt ->> 'discount_type', (v_opt ->> 'discount_value')::numeric,
              v_product, now() + make_interval(days => v_days))
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

-- ------- claim_offer_code: carry the campaign conditions onto the coupon -------
create or replace function public.claim_offer_code(p_code text)
returns public.coupons
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.offer_codes;
  v_coupon public.coupons;
  v_exists int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'Enter an offer code';
  end if;

  select * into v_offer from public.offer_codes
   where code = upper(trim(p_code))
   for update;
  if not found then
    raise exception 'Invalid offer code';
  end if;
  if not v_offer.is_active then
    raise exception 'Offer code is no longer active';
  end if;
  if v_offer.starts_at is not null and v_offer.starts_at > now() then
    raise exception 'Offer code is not active yet';
  end if;
  if v_offer.expires_at is not null and v_offer.expires_at <= now() then
    raise exception 'Offer code has expired';
  end if;
  if v_offer.max_claims is not null and v_offer.claims_count >= v_offer.max_claims then
    raise exception 'Offer code has been fully claimed';
  end if;

  select count(*) into v_exists from public.offer_claims
   where offer_code_id = v_offer.id and user_id = v_uid;
  if v_exists > 0 then
    raise exception 'You already claimed this offer code';
  end if;

  loop
    begin
      insert into public.coupons(code, user_id, source, discount_type, discount_value,
                                 min_subtotal, product_id, expires_at)
      values (public._coupon_code('OF', 10), v_uid, 'offer',
              v_offer.discount_type, v_offer.discount_value,
              v_offer.min_subtotal, v_offer.product_id,
              now() + make_interval(days => v_offer.coupon_valid_days))
      returning * into v_coupon;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  -- Row is locked (for update above): claim count and claim row stay consistent.
  insert into public.offer_claims(offer_code_id, user_id, coupon_id)
  values (v_offer.id, v_uid, v_coupon.id);

  update public.offer_codes
     set claims_count = claims_count + 1
   where id = v_offer.id;

  return v_coupon;
end;
$$;

revoke execute on function public.claim_offer_code(text) from public;
grant execute on function public.claim_offer_code(text) to authenticated;

-- ------- admin_generate_coupons -------
-- Creates p_count single-use codes in one call, retrying on the rare random
-- collision. p_user_id null makes them bearer codes (usable by guests too).
create or replace function public.admin_generate_coupons(
  p_count int,
  p_prefix text default null,
  p_discount_type text default 'fixed',
  p_discount_value numeric default 5,
  p_min_subtotal numeric default null,
  p_product_id uuid default null,
  p_expires_at timestamptz default null,
  p_user_id uuid default null
)
returns table (coupon_code text, coupon_id uuid)
language plpgsql security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_coupon public.coupons;
  i int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'Generate between 1 and 500 codes';
  end if;
  if coalesce(p_discount_type, '') not in ('percent','fixed') then
    raise exception 'Invalid discount type';
  end if;
  if p_discount_value is null or p_discount_value <= 0 or p_discount_value > 99999999 then
    raise exception 'Invalid discount amount';
  end if;
  if p_discount_type = 'percent' and p_discount_value > 100 then
    raise exception 'Percent discounts cannot exceed 100';
  end if;
  if p_min_subtotal is not null and (p_min_subtotal <= 0 or p_min_subtotal > 99999999) then
    raise exception 'Invalid minimum spend';
  end if;
  if p_product_id is not null and not exists (
    select 1 from public.premade_products where id = p_product_id
  ) then
    raise exception 'Product not found';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Choose a future expiration date';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.profiles where id = p_user_id
  ) then
    raise exception 'Customer not found';
  end if;

  v_prefix := upper(btrim(coalesce(p_prefix, '')));
  if length(v_prefix) > 12 or v_prefix !~ '^[A-Z0-9_-]*$' then
    raise exception 'Use a prefix of up to 12 letters, numbers, underscores, or hyphens';
  end if;
  -- Codes are at most 32 characters: prefix plus the 10 random characters.
  if length(v_prefix) + 10 > 32 then
    raise exception 'That prefix is too long';
  end if;

  for i in 1..p_count loop
    loop
      begin
        insert into public.coupons(code, user_id, source, discount_type, discount_value,
                                   min_subtotal, product_id, expires_at)
        values (public._coupon_code(v_prefix, 10), p_user_id, 'admin',
                p_discount_type, p_discount_value, p_min_subtotal, p_product_id, p_expires_at)
        returning * into v_coupon;
        exit;
      exception when unique_violation then
        continue;
      end;
    end loop;
    coupon_code := v_coupon.code;
    coupon_id := v_coupon.id;
    return next;
  end loop;
end;
$$;

revoke all on function public.admin_generate_coupons(int,text,text,numeric,numeric,uuid,timestamptz,uuid) from public;
grant execute on function public.admin_generate_coupons(int,text,text,numeric,numeric,uuid,timestamptz,uuid) to authenticated;
