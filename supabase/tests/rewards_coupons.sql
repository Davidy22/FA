-- pgTAP tests for the rewards program, coupons, and offer codes.
-- Run via: supabase test db
--
-- Session note: jwt claims are set session-level (set_config(..., false)) so they
-- survive statement boundaries whether the harness runs this file autocommit or
-- in one transaction; the final statement clears them.

create extension if not exists pgtap;

select plan(25);

-- ---------- fixtures ----------
-- Clean up leftovers from previous local runs (CI runs on a freshly reset DB).
delete from public.reward_transactions
  where user_id in ('aaaaaaaa-0000-0000-0000-0000000000f1','bbbbbbbb-0000-0000-0000-0000000000f2');
delete from public.coupons
  where user_id in ('aaaaaaaa-0000-0000-0000-0000000000f1','bbbbbbbb-0000-0000-0000-0000000000f2')
     or code = 'RWBEARERTEST';
delete from public.orders where contact_email in ('rw.bob@example.com','guest@example.com');
delete from public.checkout_sessions where session_id in ('rw-cs-bob','rw-cs-guest');
delete from auth.users
  where id in ('aaaaaaaa-0000-0000-0000-0000000000f1','bbbbbbbb-0000-0000-0000-0000000000f2');

insert into auth.users(id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'rw.alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-0000000000f2', 'rw.bob@example.com');

-- (1) profiles auto-created with a zero balance
select ok(
  (select count(*) = 2 from public.profiles
    where id in ('aaaaaaaa-0000-0000-0000-0000000000f1','bbbbbbbb-0000-0000-0000-0000000000f2')
      and points_balance = 0),
  'profiles are auto-created with zero reward points'
);

-- anonymous session
do $$ begin
  perform set_config('request.jwt.claims', '', false);
end $$;

-- (2)
select throws_ok(
  $$select public.claim_offer_code('WELCOME10')$$,
  'P0001', 'Not authenticated',
  'anonymous visitors cannot claim offer codes'
);

-- alice session
do $$ begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','aaaaaaaa-0000-0000-0000-0000000000f1','role','authenticated')::text, false);
end $$;

-- (3)
select ok(
  (select user_id = 'aaaaaaaa-0000-0000-0000-0000000000f1'
          and source = 'offer' and status = 'active'
          and discount_type = 'percent' and discount_value = 10
          and code like 'OF%'
     from public.claim_offer_code('welcome10')),
  'claiming an offer code issues a bound 10% coupon'
);

-- (4)
select throws_ok(
  $$select public.claim_offer_code('WELCOME10')$$,
  'P0001', 'You already claimed this offer code',
  'each user can claim an offer code only once'
);

-- (5)
select throws_ok(
  $$select public.claim_offer_code('NO-SUCH-CODE')$$,
  'P0001', 'Invalid offer code',
  'unknown offer codes are rejected'
);

-- (6) guest pricing without a coupon (2 x $6 = $12 + 5% tax = $12.60)
select ok(
  (select (p ->> 'subtotal')::numeric = 12.00
      and (p ->> 'discount_amount')::numeric = 0
      and (p ->> 'total_amount')::numeric = 12.60
     from (select public.price_cart(jsonb_build_object(
       'location_id','00000000-0000-0000-0000-000000000001',
       'items', jsonb_build_array(jsonb_build_object(
         'kind','premade','product_id','33333333-3333-3333-3333-000000000001',
         'material_id','11111111-1111-1111-1111-000000000001',
         'quantity',2,'options','{}'::jsonb)))) as p) s),
  'pricing works for guests without a coupon'
);

-- (7)
select throws_ok(
  $$select public.price_cart(jsonb_build_object(
       'location_id','00000000-0000-0000-0000-000000000001',
       'coupon_code','NOSUCHCOUPON',
       'items', jsonb_build_array(jsonb_build_object(
         'kind','premade','product_id','33333333-3333-3333-3333-000000000001',
         'material_id','11111111-1111-1111-1111-000000000001',
         'quantity',1,'options','{}'::jsonb))))$$,
  'P0001', 'Invalid coupon code',
  'unknown coupon codes are rejected at pricing'
);

-- (8) alice prices her own coupon: 10% of $12 = $1.20 discount, tax on $10.80 = $0.54
select ok(
  (select (p ->> 'subtotal')::numeric = 12.00
      and (p ->> 'discount_amount')::numeric = 1.20
      and (p ->> 'tax_amount')::numeric = 0.54
      and (p ->> 'total_amount')::numeric = 11.34
      and (p -> 'coupon' ->> 'code') is not null
     from (select public.price_cart(jsonb_build_object(
       'location_id','00000000-0000-0000-0000-000000000001',
       'user_id','aaaaaaaa-0000-0000-0000-0000000000f1',
       'coupon_code', (select code from public.coupons
                        where user_id = 'aaaaaaaa-0000-0000-0000-0000000000f1' limit 1),
       'items', jsonb_build_array(jsonb_build_object(
         'kind','premade','product_id','33333333-3333-3333-3333-000000000001',
         'material_id','11111111-1111-1111-1111-000000000001',
         'quantity',2,'options','{}'::jsonb)))) as p) s),
  'a bound coupon discounts the cart for its owner'
);

-- (9) someone else (Bob) cannot use Alice's coupon even though they know the code
select throws_ok(
  $$select public.price_cart(jsonb_build_object(
       'location_id','00000000-0000-0000-0000-000000000001',
       'user_id','bbbbbbbb-0000-0000-0000-0000000000f2',
       'coupon_code', (select code from public.coupons
                        where user_id = 'aaaaaaaa-0000-0000-0000-0000000000f1' limit 1),
       'items', jsonb_build_array(jsonb_build_object(
         'kind','premade','product_id','33333333-3333-3333-3333-000000000001',
         'material_id','11111111-1111-1111-1111-000000000001',
         'quantity',1,'options','{}'::jsonb))))$$,
  'P0001', 'Coupon is not valid for this account',
  'bound coupons cannot be used by another account'
);

-- bob session
do $$ begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','bbbbbbbb-0000-0000-0000-0000000000f2','role','authenticated')::text, false);
end $$;

-- (10)
select ok(
  (select user_id = 'bbbbbbbb-0000-0000-0000-0000000000f2'
          and source = 'offer' and discount_type = 'fixed' and discount_value = 5
     from public.claim_offer_code('HIGHFIVE')),
  'second offer code issues a $5 coupon'
);

-- Bob checks out 3 x $6 with his $5 coupon: subtotal $18, discount $5, tax $0.65, total $13.65
insert into public.checkout_sessions(session_id, cart, user_id, location_id, contact_email, contact_name, locale)
values ('rw-cs-bob',
  jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001',
    'user_id','bbbbbbbb-0000-0000-0000-0000000000f2',
    'coupon_code', (select code from public.coupons
                     where user_id = 'bbbbbbbb-0000-0000-0000-0000000000f2' limit 1),
    'items', jsonb_build_array(jsonb_build_object(
      'kind','premade','product_id','33333333-3333-3333-3333-000000000001',
      'material_id','11111111-1111-1111-1111-000000000001',
      'quantity',3,'options','{}'::jsonb))),
  'bbbbbbbb-0000-0000-0000-0000000000f2',
  '00000000-0000-0000-0000-000000000001', 'rw.bob@example.com', 'Bob', 'en');

-- (11) fulfilment snapshots the discount and prices the order
select ok(
  (select o.subtotal = 18.00 and o.discount_amount = 5.00
      and o.tax_amount = 0.65 and o.total_amount = 13.65
      and o.user_id = 'bbbbbbbb-0000-0000-0000-0000000000f2'
     from public.create_order_from_cart('rw-cs-bob',
       'bbbbbbbb-0000-0000-0000-0000000000f2',
       '00000000-0000-0000-0000-000000000001',
       'rw.bob@example.com', 'Bob', 'en') o),
  'order is created with the coupon discount applied'
);

-- (12) the coupon is consumed and linked to the order
select ok(
  (select status = 'used' and used_order_id is not null and used_at is not null
     from public.coupons
    where user_id = 'bbbbbbbb-0000-0000-0000-0000000000f2' and source = 'offer'),
  'fulfilment consumes the coupon'
);

-- (13) points earned = floor(total paid)
select is(
  (select points_balance from public.profiles where id = 'bbbbbbbb-0000-0000-0000-0000000000f2'),
  13,
  'one point per dollar spent (floor of paid total)'
);

-- (14) ledger records the earn
select ok(
  (select count(*) = 1 and sum(points) = 13
     from public.reward_transactions
    where user_id = 'bbbbbbbb-0000-0000-0000-0000000000f2' and type = 'order_earn'),
  'reward ledger records the order earn'
);

-- (15) a consumed coupon cannot be reused
select throws_ok(
  $$select public.create_order_from_cart('rw-cs-bob',
       'bbbbbbbb-0000-0000-0000-0000000000f2',
       '00000000-0000-0000-0000-000000000001',
       'rw.bob@example.com', 'Bob', 'en')$$,
  'P0001', 'Coupon already used',
  'a consumed coupon cannot be reused'
);

-- (16) not enough points to redeem yet (balance 13 < 100)
select throws_ok(
  $$select public.redeem_rewards(0)$$,
  'P0001', 'Not enough points',
  'redemption requires a sufficient balance'
);

-- top up Bob to 150 points for a redemption test
update public.profiles set points_balance = 150 where id = 'bbbbbbbb-0000-0000-0000-0000000000f2';

-- (17)
select ok(
  (select source = 'reward' and status = 'active'
          and discount_type = 'fixed' and discount_value = 5
          and code like 'RW%' and user_id = 'bbbbbbbb-0000-0000-0000-0000000000f2'
     from public.redeem_rewards(0)),
  'redeeming 100 points issues a $5 reward coupon'
);

-- (18)
select is(
  (select points_balance from public.profiles where id = 'bbbbbbbb-0000-0000-0000-0000000000f2'),
  50,
  'redemption deducts the spent points'
);

-- (19) guest checkout: no account, no coupon
insert into public.checkout_sessions(session_id, cart, user_id, location_id, contact_email, contact_name, locale)
values ('rw-cs-guest',
  jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001',
    'items', jsonb_build_array(jsonb_build_object(
      'kind','premade','product_id','33333333-3333-3333-3333-000000000001',
      'material_id','11111111-1111-1111-1111-000000000001',
      'quantity',1,'options','{}'::jsonb))),
  null, '00000000-0000-0000-0000-000000000001', 'guest@example.com', 'Guest', 'en');

-- (20)
select ok(
  (select o.user_id is null and o.total_amount = 6.30
     from public.create_order_from_cart('rw-cs-guest', null,
       '00000000-0000-0000-0000-000000000001',
       'guest@example.com', 'Guest', 'en') o),
  'customers can purchase without an account (guest order)'
);

-- (21) guests earn no points (nothing to credit)
select ok(
  (select count(*) = 0 from public.reward_transactions where user_id is null),
  'guest orders do not credit reward points'
);

-- (22) unassigned (bearer) coupons are usable by anyone, guests included
insert into public.coupons(code, user_id, source, discount_type, discount_value)
values ('RWBEARERTEST', null, 'admin', 'fixed', 2)
on conflict (code) do nothing;

select ok(
  (select (p ->> 'discount_amount')::numeric = 2
     from (select public.price_cart(jsonb_build_object(
       'location_id','00000000-0000-0000-0000-000000000001',
       'coupon_code','RWBEARERTEST',
       'items', jsonb_build_array(jsonb_build_object(
         'kind','premade','product_id','33333333-3333-3333-3333-000000000001',
         'material_id','11111111-1111-1111-1111-000000000001',
         'quantity',1,'options','{}'::jsonb)))) as p) s),
  'unassigned coupons work as bearer codes at checkout'
);

-- (23) invalid redemption option
select throws_ok(
  $$select public.redeem_rewards(99)$$,
  'P0001', 'Invalid redemption option',
  'unknown redemption options are rejected'
);

-- (24) column lockdown: points_balance and role are not client-updatable
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'points_balance', 'UPDATE') = false
  and has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') = false,
  'clients cannot update points_balance or role on profiles'
);

-- (25)
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE') = true,
  'clients can still update their profile presentation fields'
);

-- (26) reward tables expose read policies to their owners and admins
select ok(
  (select count(*) = 3 from pg_policies
    where schemaname = 'public'
      and policyname in ('coupons_owner_read','offer_claims_owner_read','reward_transactions_owner_read'))
  and (select count(*) = 4 from pg_policies
    where schemaname = 'public'
      and policyname in ('coupons_admin_all','offer_codes_admin_all','offer_claims_admin_all','reward_transactions_admin_all')),
  'RLS policies exist on the rewards tables'
);

-- clear the session jwt claims
do $$ begin
  perform set_config('request.jwt.claims', '', false);
end $$;

select * from finish();
