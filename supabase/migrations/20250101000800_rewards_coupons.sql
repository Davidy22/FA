-- Rewards program + coupons + offer codes.
--
-- - profiles.points_balance: points earned (1 per US$1 spent, configurable) and spent.
-- - reward_transactions: append-only ledger for earns/redemptions.
-- - coupons: single-use discount codes. Issued to a user (reward/offer) or unassigned
--   (admin/marketing). A coupon bound to a user can only be redeemed by that user;
--   unassigned coupons are bearer codes usable by anyone (incl. guests) at checkout.
-- - offer_codes: campaign codes entered on /offers; claiming one issues a coupon to
--   the signed-in user (one claim per user per code).
-- All issuance/deduction happens in SECURITY DEFINER RPCs; clients only read their own rows.
-- Checkout application lives in price_cart / create_order_from_cart (see next migration).

-- ------- points balance -------
alter table public.profiles
  add column if not exists points_balance integer not null default 0;

-- Lock down profile updates: RLS only gates rows, not columns, so column-level
-- grants are required to stop users from editing role/points_balance/etc. on their
-- own row. Client code may only touch its own presentation fields.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, locale, is_creator, creator_agreement_version, creator_agreed_at)
  on public.profiles to authenticated;

-- ------- coupons -------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code = upper(code) and char_length(code) between 6 and 32),
  user_id uuid references public.profiles(id) on delete set null,
  source text not null default 'admin'
    check (source in ('reward','offer','admin')),
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  constraint coupons_percent_le_100 check (discount_type <> 'percent' or discount_value <= 100),
  status text not null default 'active' check (status in ('active','used')),
  expires_at timestamptz,
  used_order_id uuid references public.orders(id),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger coupons_updated_at before update on public.coupons
  for each row execute function public.tg_set_updated_at();

create index coupons_user_status_idx on public.coupons(user_id, status, created_at desc);

-- ------- offer codes -------
create table public.offer_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code = upper(code) and char_length(code) between 4 and 32),
  description text,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  constraint offer_codes_percent_le_100 check (discount_type <> 'percent' or discount_value <= 100),
  max_claims integer check (max_claims is null or max_claims > 0),
  claims_count integer not null default 0 check (claims_count >= 0),
  coupon_valid_days integer not null default 90 check (coupon_valid_days > 0),
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger offer_codes_updated_at before update on public.offer_codes
  for each row execute function public.tg_set_updated_at();

create table public.offer_claims (
  id uuid primary key default gen_random_uuid(),
  offer_code_id uuid not null references public.offer_codes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  coupon_id uuid references public.coupons(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (offer_code_id, user_id)
);

create index offer_claims_user_idx on public.offer_claims(user_id, created_at desc);

-- ------- reward ledger -------
create table public.reward_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  points integer not null check (points <> 0),
  type text not null check (type in ('order_earn','redeem','adjustment')),
  order_id uuid references public.orders(id),
  coupon_id uuid references public.coupons(id),
  memo text,
  created_at timestamptz not null default now()
);

create index reward_transactions_user_idx on public.reward_transactions(user_id, created_at desc);

-- ------- orders: coupon discount snapshot -------
alter table public.orders
  add column if not exists discount_amount numeric(10,2) not null default 0;

-- ------- default settings -------
insert into public.platform_settings(key, value) values
 ('rewards.points_per_dollar', '1'::jsonb),
 ('rewards.coupon_days_valid', '90'::jsonb),
 ('rewards.redeem_options',
  '[{"points":100,"discount_type":"fixed","discount_value":5},
    {"points":200,"discount_type":"fixed","discount_value":10},
    {"points":500,"discount_type":"fixed","discount_value":30}]'::jsonb)
on conflict (key) do nothing;

-- ------- seed offer codes (demo/marketing) -------
insert into public.offer_codes(code, description, discount_type, discount_value, max_claims, coupon_valid_days) values
 ('WELCOME10', '10% off your first order', 'percent', 10, null, 90),
 ('HIGHFIVE', '$5 off, thanks for visiting', 'fixed', 5, null, 90)
on conflict (code) do nothing;

-- ------- RLS -------
alter table public.coupons enable row level security;
alter table public.offer_codes enable row level security;
alter table public.offer_claims enable row level security;
alter table public.reward_transactions enable row level security;

-- Coupons: the issued user (and admins) can read; issuance/consumption only via RPCs.
create policy coupons_owner_read on public.coupons
  for select using (user_id = auth.uid() or public.is_admin());
create policy coupons_admin_all on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());

-- Offer codes are deliberately NOT client-readable (that would publish every code).
-- Claiming goes through claim_offer_code(); admins via API/Studio.
create policy offer_codes_admin_all on public.offer_codes
  for all using (public.is_admin()) with check (public.is_admin());

create policy offer_claims_owner_read on public.offer_claims
  for select using (user_id = auth.uid() or public.is_admin());
create policy offer_claims_admin_all on public.offer_claims
  for all using (public.is_admin()) with check (public.is_admin());

create policy reward_transactions_owner_read on public.reward_transactions
  for select using (user_id = auth.uid() or public.is_admin());
create policy reward_transactions_admin_all on public.reward_transactions
  for all using (public.is_admin()) with check (public.is_admin());

-- ------- internal helpers -------

-- Unambiguous code alphabet (no 0/O/1/I). Not cryptographic on its own; callers
-- retry on the unique index, and codes are combined with per-user claims locks.
create or replace function public._coupon_code(p_prefix text default 'FA', p_len int default 10)
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
  return p_prefix || v_out;
end;
$$;

-- Fetch a redeemable coupon or raise. p_user_id is the (verified) buyer:
-- bound coupons are personal; unassigned coupons are bearer codes.
create or replace function public._active_coupon(p_code text, p_user_id uuid)
returns public.coupons
language plpgsql stable
set search_path = public
as $$
declare
  c public.coupons;
begin
  select * into c from public.coupons where code = upper(trim(coalesce(p_code,'')));
  if not found then
    raise exception 'Invalid coupon code';
  end if;
  if c.status <> 'active' then
    raise exception 'Coupon already used';
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    raise exception 'Coupon expired';
  end if;
  if c.user_id is not null and (p_user_id is null or c.user_id <> p_user_id) then
    raise exception 'Coupon is not valid for this account';
  end if;
  return c;
end;
$$;

-- Discount for a coupon against a subtotal, capped at the subtotal.
create or replace function public._coupon_discount(p_coupon public.coupons, p_subtotal numeric)
returns numeric
language sql immutable
set search_path = public
as $$
  select least(
    p_subtotal,
    case when p_coupon.discount_type = 'percent'
         then round(p_subtotal * p_coupon.discount_value / 100.0, 2)
         else p_coupon.discount_value
    end
  );
$$;

-- ------- points award trigger -------
create or replace function public.tg_award_reward_points()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rate numeric := 1;
  v_points int;
begin
  -- Only registered accounts earn points; guests have no account to credit.
  if new.user_id is null then
    return new;
  end if;

  select coalesce((value #>> '{}')::numeric, 1) into v_rate
    from public.platform_settings where key = 'rewards.points_per_dollar';
  v_points := floor(coalesce(new.total_amount, 0) * v_rate)::int;
  if v_points <= 0 then
    return new;
  end if;

  update public.profiles
     set points_balance = points_balance + v_points
   where id = new.user_id;

  insert into public.reward_transactions(user_id, points, type, order_id, memo)
  values (new.user_id, v_points, 'order_earn', new.id, 'Order ' || new.order_number);

  return new;
end;
$$;

drop trigger if exists orders_award_reward_points on public.orders;
create trigger orders_award_reward_points
after insert on public.orders
for each row execute function public.tg_award_reward_points();

-- ------- redeem_rewards RPC -------
-- Redeems the option at p_option_index (into rewards.redeem_options) for a fresh
-- coupon issued to the caller. Atomic: deduction and issuance commit together.
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
  v_coupon public.coupons;
  v_days int;
  v_prefix text;
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
  v_prefix := 'RW';

  loop
    begin
      insert into public.coupons(code, user_id, source, discount_type, discount_value, expires_at)
      values (public._coupon_code(v_prefix, 10), v_uid, 'reward',
              v_opt ->> 'discount_type', (v_opt ->> 'discount_value')::numeric,
              now() + make_interval(days => v_days))
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

-- ------- claim_offer_code RPC -------
-- Converts an offer code into a personal coupon for the signed-in user.
-- One claim per user per code; total claims capped by offer_codes.max_claims.
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
      insert into public.coupons(code, user_id, source, discount_type, discount_value, expires_at)
      values (public._coupon_code('OF', 10), v_uid, 'offer',
              v_offer.discount_type, v_offer.discount_value,
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
