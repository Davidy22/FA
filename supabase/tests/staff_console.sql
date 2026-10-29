-- pgTAP tests for the staff console: module permissions, admin-managed
-- product categories, membership tiers and model-submission feature flags.
-- Run via: supabase test db

create extension if not exists pgtap;

select plan(18);

-- ---------- fixtures ----------
delete from public.reward_transactions
  where order_id in (select id from public.orders where order_number = 'TIER-PGTAP');
delete from public.orders where order_number = 'TIER-PGTAP';
delete from public.product_categories where slug = 'pg-tap-category';
delete from auth.users where id in (
  'c0000000-0000-4000-8000-0000000000a1',
  'd0000000-0000-4000-8000-0000000000b2'
);

insert into auth.users(id, email) values
  ('c0000000-0000-4000-8000-0000000000a1', 'perm.admin@example.com'),
  ('d0000000-0000-4000-8000-0000000000b2', 'perm.staff@example.com');

update public.profiles set role = 'admin', is_active = true
 where id = 'c0000000-0000-4000-8000-0000000000a1';
update public.profiles set role = 'employee', is_active = true,
  location_id = '00000000-0000-0000-0000-000000000001'
 where id = 'd0000000-0000-4000-8000-0000000000b2';

-- (1) both new features ship switched off
select ok(
  public.feature_enabled('model_submissions') = false,
  'community submissions ship switched off'
);

-- (2) the six original categories are seeded as rows
select is(
  (select count(*)::int from public.product_categories
    where slug in ('toy','tool','art','gadget','replacement_part','other')),
  6,
  'the original product categories are seeded as editable rows'
);

-- (3) the fallback category cannot be deleted
select throws_ok(
  $$delete from public.product_categories where slug = 'other'$$,
  'P0001', 'The "other" category cannot be deleted',
  'the fallback category cannot be deleted'
);

-- (4) ...nor renamed
select throws_ok(
  $$update public.product_categories set slug = 'misc' where slug = 'other'$$,
  'P0001', 'The "other" category cannot be renamed',
  'the fallback category cannot be renamed'
);

-- (5) an unused category can be added and removed
select lives_ok(
  $$insert into public.product_categories(slug, name) values ('pg-tap-category', '{"en":"Temporary"}');
    delete from public.product_categories where slug = 'pg-tap-category'$$,
  'admins can add and remove their own categories'
);

-- (6) a plain employee holds no module permissions
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false);
select ok(
  public.is_staff() and not public.has_permission('products.manage'),
  'staff start with no module permissions'
);

-- (7) an admin assigns one module
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false);
select is(
  (select (public.admin_set_user_permissions(
    'd0000000-0000-4000-8000-0000000000b2'::uuid, array['products.manage']::text[]
  )).permissions),
  array['products.manage']::text[],
  'an admin can assign a module to an employee'
);

-- (8) that module applies to the employee and nothing else does
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false);
select ok(
  public.has_permission('products.manage')
  and not public.has_permission('coupons.manage')
  and not public.has_permission('admin.full'),
  'a module grant applies only to that module'
);

-- (9) the employee cannot hand out permissions
select throws_ok(
  $$select public.admin_set_user_permissions(
    'd0000000-0000-4000-8000-0000000000b2'::uuid, array['coupons.manage']::text[])$$,
  'P0001', 'Not permitted to change permissions',
  'module permissions cannot be self-assigned'
);

-- (10) full admin powers imply every module and is_admin()
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false);
select public.admin_set_user_permissions(
  'd0000000-0000-4000-8000-0000000000b2'::uuid, array['admin.full']::text[]);
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false);
select ok(
  public.is_admin() and public.has_permission('settings.manage')
  and public.has_permission('payouts.manage'),
  'full admin powers (admin.full) overshadow every other permission'
);

-- (11) a users.manage holder still cannot promote themselves to full admin
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false);
select public.admin_set_user_permissions(
  'd0000000-0000-4000-8000-0000000000b2'::uuid, array['users.manage']::text[]);
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false);
select throws_ok(
  $$select public.admin_set_user_permissions(
    'd0000000-0000-4000-8000-0000000000b2'::uuid, array['users.manage','admin.full']::text[])$$,
  'P0001', 'Only an admin can grant or revoke full admin powers',
  'only an admin may grant full admin powers'
);

-- (12-14) the tier ladder raises the multiplier with lifetime points
select is(public.reward_multiplier(0), 1::numeric, 'a new account earns the base rate');
select is(public.reward_multiplier(1000), 2::numeric, '2x applies from 1,000 lifetime points');
select is(public.reward_multiplier(5000), 3::numeric, '3x applies from 5,000 lifetime points');

-- (15) an order at the 2x tier credits twice the points and grows the lifetime total
delete from public.reward_transactions
  where order_id in (select id from public.orders where order_number = 'TIER-PGTAP');
delete from public.orders where order_number = 'TIER-PGTAP';
update public.profiles set points_balance = 0, lifetime_points = 1000
 where id = 'd0000000-0000-4000-8000-0000000000b2';
insert into public.orders(order_number, user_id, location_id, contact_email, subtotal, total_amount)
values ('TIER-PGTAP', 'd0000000-0000-4000-8000-0000000000b2',
        '00000000-0000-0000-0000-000000000001', 'perm.staff@example.com', 10, 10);
select ok(
  (select points_balance = 20 and lifetime_points = 1020 from public.profiles
    where id = 'd0000000-0000-4000-8000-0000000000b2'),
  'a 2x order credits twice the points and counts towards the lifetime total'
);

-- (16) every filament resolves to a seeded finish
select is(
  (select count(*)::int from public.filaments f
     left join public.filament_finishes ff on ff.slug = f.finish
    where ff.slug is null),
  0,
  'every filament has a known finish'
);

-- (17) an unknown finish is rejected
select throws_ok(
  $$update public.filaments set finish = 'unobtanium'
     where id = (select id from public.filaments order by id limit 1)$$,
  '23503', null,
  'a filament finish must exist in filament_finishes'
);

-- (18) job listings are protected by RLS
select ok(
  (select relrowsecurity from pg_catalog.pg_class
    where relname = 'job_listings' and relnamespace = 'public'::regnamespace),
  'job listings are protected by row level security'
);

select set_config('request.jwt.claims', '', false);

select * from finish();
