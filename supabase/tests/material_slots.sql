-- pgTAP tests for multi-material slots and sale prices.
-- Run via: supabase test db
--
-- Session note: jwt claims are set session-level (set_config(..., false)) so they
-- survive statement boundaries; the last statement clears them again.

create extension if not exists pgtap;

select plan(16);

-- ---------- fixtures ----------
-- Clean up leftovers from previous local runs (CI runs on a freshly reset DB).
-- Reward ledger rows reference orders with no cascade, so they go first.
delete from public.reward_transactions
 where user_id in ('bbbbbbbb-0000-0000-0000-0000000000c2');
delete from public.orders where contact_email in ('slots.buyer@example.test');
delete from public.checkout_sessions where session_id in ('slots-cs');
delete from public.premade_products where slug in ('slots-fixture','sale-fixture');
delete from auth.users where id in
  ('aaaaaaaa-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-0000000000c2');

insert into auth.users(id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'slots.admin@example.test'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'slots.buyer@example.test');
update public.profiles set role = 'admin', is_active = true
 where id = 'aaaaaaaa-0000-0000-0000-0000000000c1';

-- (1) the demo catalogue ships a two-material print and two running sales
select ok(
  (select count(*) = 2 from public.product_material_slots
    where product_id = '33333333-3333-3333-3333-000000000005')
  and (select count(*) = 4 from public.product_slot_materials sm
    join public.product_material_slots s on s.id = sm.slot_id
    where s.product_id = '33333333-3333-3333-3333-000000000005')
  and (select sale_price = 6.00 from public.premade_products
    where id = '33333333-3333-3333-3333-000000000002')
  and (select sale_price = 2.50 from public.product_option_choices
    where id = '55555555-5555-5555-5555-000000000002'),
  'the demo catalogue has a two-material print and sales on a product and a choice'
);

-- (2) slot tables are protected like the rest of the catalogue
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'product_material_slots')
  and (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'product_slot_materials')
  and exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'product_material_slots' and policyname = 'material_slots_read_published')
  and exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'product_slot_materials' and policyname = 'slot_materials_admin_all'),
  'slot tables enforce RLS with published-read and admin-write policies'
);

-- (3) sale helpers: a missing bound is open ended, the end bound is exclusive
select ok(
  public.sale_window_open(null, null)
  and not public.sale_window_open(now() + interval '1 hour', null)
  and not public.sale_window_open(null, now())
  and public.sale_window_open(now() - interval '1 hour', now() + interval '1 hour')
  and public.effective_price(8, 6, null, null) = 6
  and public.effective_price(8, 6, now() + interval '1 day', null) = 8
  and public.effective_price(8, null, null, null) = 8
  and not public.sale_is_active(null, null, null),
  'sale helpers treat missing bounds as open ended and the end as exclusive'
);

-- (4) an admin can publish a product made of slots alone
create or replace function tap_save_slots() returns text
language plpgsql as $$
declare
  saved public.premade_products;
  slot_count int;
  material_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
  saved := public.admin_save_product(
    jsonb_build_object('slug','slots-fixture','name',jsonb_build_object('en','Slots fixture'),
      'description',null,'base_price',20,'default_material_id',null,
      'category','toy','tags',jsonb_build_array('test'),'image_urls','[]'::jsonb,
      'source_model_path','slots-fixture.stl','is_featured',false,'status','published'),
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('name',jsonb_build_object('en','Body'),'sort_order',0,
        'default_material_id','11111111-1111-1111-1111-000000000004',
        'default_filament_id','22222222-2222-2222-2222-000000000008',
        'materials',jsonb_build_array(
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000004','price_modifier',0),
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000001','price_modifier',-2))),
      jsonb_build_object('name',jsonb_build_object('en','Accent'),'sort_order',1,
        'default_material_id','11111111-1111-1111-1111-000000000001',
        'default_filament_id','22222222-2222-2222-2222-000000000003',
        'materials',jsonb_build_array(
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000001','price_modifier',0),
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000002','price_modifier',1.5)))));
  -- A new product takes its id as slug; the later checks address it by name.
  update public.premade_products set slug = 'slots-fixture' where id = saved.id;
  select count(*) into slot_count from public.product_material_slots where product_id = saved.id;
  select count(*) into material_count from public.product_slot_materials sm
    join public.product_material_slots s on s.id = sm.slot_id
   where s.product_id = saved.id;
  -- With slots the product-level default material is no longer required to publish.
  return ok(saved.status = 'published' and saved.default_material_id is null
        and slot_count = 2 and material_count = 4,
    'admin_save_product stores every slot with its own eligible materials ('
      ||slot_count||' slots, '||material_count||' materials)');
end;$$;
select tap_save_slots();

-- (5) slot payloads are validated before anything is written
create or replace function tap_slot_validation() returns text
language plpgsql as $$
declare
  pid uuid;
  base jsonb;
  bad_default text; bad_color text; no_materials text; no_name text;
begin
  select id into pid from public.premade_products where slug = 'slots-fixture';
  base := jsonb_build_object('id',pid,'slug','slots-fixture',
    'name',jsonb_build_object('en','Slots fixture'),'base_price',20,
    'category','toy','tags',jsonb_build_array('test'),'image_urls','[]'::jsonb,
    'source_model_path','slots-fixture.stl','is_featured',false,'status','draft');

  begin
    perform public.admin_save_product(base, '[]'::jsonb, jsonb_build_array(
      jsonb_build_object('name',jsonb_build_object('en','Body'),
        'default_material_id','11111111-1111-1111-1111-000000000002',
        'materials',jsonb_build_array(
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000004','price_modifier',0)))));
    bad_default := 'no error';
  exception when raise_exception then bad_default := SQLERRM;
  end;

  begin
    perform public.admin_save_product(base, '[]'::jsonb, jsonb_build_array(
      jsonb_build_object('name',jsonb_build_object('en','Body'),
        'default_material_id','11111111-1111-1111-1111-000000000004',
        'default_filament_id','22222222-2222-2222-2222-000000000003',
        'materials',jsonb_build_array(
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000004','price_modifier',0)))));
    bad_color := 'no error';
  exception when raise_exception then bad_color := SQLERRM;
  end;

  begin
    perform public.admin_save_product(base, '[]'::jsonb, jsonb_build_array(
      jsonb_build_object('name',jsonb_build_object('en','Body'),'materials','[]'::jsonb)));
    no_materials := 'no error';
  exception when raise_exception then no_materials := SQLERRM;
  end;

  begin
    perform public.admin_save_product(base, '[]'::jsonb, jsonb_build_array(
      jsonb_build_object('name',jsonb_build_object('zh-Hant','身體'),
        'materials',jsonb_build_array(
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000004','price_modifier',0)))));
    no_name := 'no error';
  exception when raise_exception then no_name := SQLERRM;
  end;

  return ok(bad_default = 'Default material must be eligible for the slot'
        and bad_color = 'Default color must be a color of the default material'
        and no_materials = 'Every material slot needs at least one eligible material'
        and no_name = 'Every material slot needs an English name',
    'slot names, materials and defaults are all validated ('||bad_default||')');
end;$$;
select tap_slot_validation();

-- (6) pricing uses the slot defaults, or what the customer picked
create or replace function tap_price_slots() returns text
language plpgsql as $$
declare
  pid uuid; body uuid; accent uuid;
  defaults jsonb; picked jsonb;
begin
  select id into pid from public.premade_products where slug = 'slots-fixture';
  select id into body from public.product_material_slots
   where product_id = pid and name->>'en' = 'Body';
  select id into accent from public.product_material_slots
   where product_id = pid and name->>'en' = 'Accent';
  perform set_config('request.jwt.claims', '', false);

  defaults := public.price_cart(jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001',
    'items',jsonb_build_array(jsonb_build_object(
      'kind','premade','product_id',pid,'quantity',1,'options','{}'::jsonb))));
  picked := public.price_cart(jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001',
    'items',jsonb_build_array(jsonb_build_object(
      'kind','premade','product_id',pid,'quantity',2,'options','{}'::jsonb,
      'slots',jsonb_build_object(
        body::text, jsonb_build_object(
          'material_id','11111111-1111-1111-1111-000000000001',
          'color_filament_id','22222222-2222-2222-2222-000000000003'),
        accent::text, jsonb_build_object(
          'material_id','11111111-1111-1111-1111-000000000002',
          'color_filament_id','22222222-2222-2222-2222-000000000005'))))));

  return ok((defaults->'lines'->0->>'unit_price')::numeric = 20
        and jsonb_array_length(defaults->'lines'->0->'item_snapshot'->'slots') = 2
        and (defaults->'lines'->0->'item_snapshot'->'slots'->0->'color'->>'id')
            = '22222222-2222-2222-2222-000000000008'
        and (defaults->'lines'->0->'item_snapshot'->'material'->>'slug') = 'tpu'
        and (picked->'lines'->0->>'unit_price')::numeric = 19.5
        and (picked->'lines'->0->>'line_total')::numeric = 39
        and (picked->'lines'->0->'item_snapshot'->'slots'->1->'material'->>'slug') = 'petg',
    'slots are priced from their defaults or from the customer''s picks (defaults '
      ||(defaults->'lines'->0->>'unit_price')||', picked '||(picked->'lines'->0->>'unit_price')||')');
end;$$;
select tap_price_slots();

-- (7) a slot only accepts its own materials, in their own colours
create or replace function tap_slot_pick_errors() returns text
language plpgsql as $$
declare
  pid uuid; body uuid; cart jsonb;
  not_allowed text; mismatch text;
begin
  select id into pid from public.premade_products where slug = 'slots-fixture';
  select id into body from public.product_material_slots
   where product_id = pid and name->>'en' = 'Body';
  perform set_config('request.jwt.claims', '', false);

  begin
    perform public.price_cart(jsonb_build_object(
      'location_id','00000000-0000-0000-0000-000000000001',
      'items',jsonb_build_array(jsonb_build_object('kind','premade','product_id',pid,
        'quantity',1,'options','{}'::jsonb,
        'slots',jsonb_build_object(body::text,
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000002'))))));
    not_allowed := 'no error';
  exception when raise_exception then not_allowed := SQLERRM;
  end;

  begin
    perform public.price_cart(jsonb_build_object(
      'location_id','00000000-0000-0000-0000-000000000001',
      'items',jsonb_build_array(jsonb_build_object('kind','premade','product_id',pid,
        'quantity',1,'options','{}'::jsonb,
        'slots',jsonb_build_object(body::text, jsonb_build_object(
          'material_id','11111111-1111-1111-1111-000000000004',
          'color_filament_id','22222222-2222-2222-2222-000000000003'))))));
    mismatch := 'no error';
  exception when raise_exception then mismatch := SQLERRM;
  end;

  return ok(not_allowed = 'Material not allowed for Body'
        and mismatch = 'Color/material mismatch for Body',
    'a slot rejects materials outside its list and colours of another material ('
      ||not_allowed||' / '||mismatch||')');
end;$$;
select tap_slot_pick_errors();

-- (8) fulfilment keeps every slot the customer chose
create or replace function tap_slot_fulfilment() returns text
language plpgsql as $$
declare
  pid uuid; accent uuid; oid uuid; stored jsonb; legacy uuid;
begin
  select id into pid from public.premade_products where slug = 'slots-fixture';
  select id into accent from public.product_material_slots
   where product_id = pid and name->>'en' = 'Accent';
  perform set_config('request.jwt.claims', '', false);

  insert into public.checkout_sessions(session_id, cart, user_id, location_id, contact_email, contact_name, locale)
  values ('slots-cs', jsonb_build_object(
      'location_id','00000000-0000-0000-0000-000000000001',
      'user_id','bbbbbbbb-0000-0000-0000-0000000000c2',
      'items',jsonb_build_array(jsonb_build_object('kind','premade','product_id',pid,
        'quantity',1,'options','{}'::jsonb,
        'slots',jsonb_build_object(accent::text,
          jsonb_build_object('material_id','11111111-1111-1111-1111-000000000002'))))),
    'bbbbbbbb-0000-0000-0000-0000000000c2',
    '00000000-0000-0000-0000-000000000001','slots.buyer@example.test','Slots Buyer','en');

  select id into oid from public.create_order_from_cart('slots-cs',
    'bbbbbbbb-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000001',
    'slots.buyer@example.test','Slots Buyer','en');
  select material_slots, material_id into stored, legacy
    from public.order_items where order_id = oid;

  return ok(stored is not null and jsonb_array_length(stored) = 2
        and (stored->1->'material'->>'slug') = 'petg'
        and (stored->1->'name'->>'en') = 'Accent'
        and legacy = '11111111-1111-1111-1111-000000000004',
    'an order line stores every slot and keeps the first one as the headline material');
end;$$;
select tap_slot_fulfilment();

-- (9) the slot triggers guard the defaults directly, not just through the RPC
select throws_ok(
  $$update public.product_material_slots
      set default_filament_id = '22222222-2222-2222-2222-000000000003'
    where name->>'en' = 'Body'
      and product_id = (select id from public.premade_products where slug = 'slots-fixture')$$,
  'P0001', 'Default color must be a color of the default material',
  'a slot default colour must belong to the slot default material'
);
select throws_ok(
  $$delete from public.product_slot_materials
    where material_id = '11111111-1111-1111-1111-000000000001'
      and slot_id = (select s.id from public.product_material_slots s
                      join public.premade_products p on p.id = s.product_id
                     where p.slug = 'slots-fixture' and s.name->>'en' = 'Accent')$$,
  'P0001', 'Default material must be eligible for the slot',
  'a slot default material cannot be removed from its own list'
);

-- (10) a product sale is charged inside its window only, and reports the saving
create or replace function tap_sale_pricing() returns text
language plpgsql as $$
declare
  saved public.premade_products;
  items jsonb;
  on_sale jsonb; future jsonb; expired jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
  saved := public.admin_save_product(
    jsonb_build_object('slug','sale-fixture','name',jsonb_build_object('en','Sale fixture'),
      'description',null,'base_price',30,
      'default_material_id','11111111-1111-1111-1111-000000000001',
      'category','toy','tags','[]'::jsonb,'image_urls','[]'::jsonb,
      'source_model_path','sale-fixture.stl','is_featured',false,'status','published',
      'sale_price',24),
    jsonb_build_array(jsonb_build_object(
      'material_id','11111111-1111-1111-1111-000000000001','price_modifier',2)),
    '[]'::jsonb);
  update public.premade_products set slug = 'sale-fixture' where id = saved.id;
  perform set_config('request.jwt.claims', '', false);

  items := jsonb_build_array(jsonb_build_object('kind','premade','product_id',saved.id,
    'material_id','11111111-1111-1111-1111-000000000001','quantity',2,'options','{}'::jsonb));
  on_sale := public.price_cart(jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001','items',items));

  update public.premade_products set sale_starts_at = now() + interval '1 day' where id = saved.id;
  future := public.price_cart(jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001','items',items));

  update public.premade_products
     set sale_starts_at = now() - interval '2 days', sale_ends_at = now() - interval '1 day'
   where id = saved.id;
  expired := public.price_cart(jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001','items',items));

  return ok((on_sale->'lines'->0->>'unit_price')::numeric = 26      -- 24 sale + 2 material
        and (on_sale->>'sale_savings')::numeric = 12                -- (30 - 24) x 2
        and (on_sale->'lines'->0->'item_snapshot'->>'regular_price')::numeric = 30
        and (on_sale->'lines'->0->'item_snapshot'->>'sale_price')::numeric = 24
        and (future->'lines'->0->>'unit_price')::numeric = 32
        and (future->>'sale_savings')::numeric = 0
        and (expired->'lines'->0->>'unit_price')::numeric = 32
        and (expired->'lines'->0->'item_snapshot'->>'sale_price') is null,
    'a sale is charged inside its window only and the saving is reported ('
      ||(on_sale->'lines'->0->>'unit_price')||' on sale, '
      ||(future->'lines'->0->>'unit_price')||' before it starts)');
end;$$;
select tap_sale_pricing();

-- (11) an option choice can be on sale too
create or replace function tap_choice_sale() returns text
language plpgsql as $$
declare priced jsonb;
begin
  perform set_config('request.jwt.claims', '', false);
  priced := public.price_cart(jsonb_build_object(
    'location_id','00000000-0000-0000-0000-000000000001',
    'items',jsonb_build_array(jsonb_build_object('kind','premade',
      'product_id','33333333-3333-3333-3333-000000000003',
      'material_id','11111111-1111-1111-1111-000000000001','quantity',1,
      'options',jsonb_build_object('44444444-4444-4444-4444-000000000001',
        jsonb_build_object('choice_id','55555555-5555-5555-5555-000000000002'))))));
  return ok((priced->'lines'->0->>'unit_price')::numeric = 14.5   -- 12 + 2.50 instead of 12 + 5
        and (priced->>'sale_savings')::numeric = 2.5,
    'a discounted option choice is charged at its sale modifier ('
      ||(priced->'lines'->0->>'unit_price')||')');
end;$$;
select tap_choice_sale();

-- (12-14) sale triggers refuse a price that is not a discount, and a window that ends early
select throws_ok(
  $$update public.premade_products set sale_price = base_price where slug = 'sale-fixture'$$,
  'P0001', 'Sale price must be lower than the regular price',
  'a product sale must undercut its regular price'
);
select throws_ok(
  $$update public.premade_products
      set sale_starts_at = now() + interval '2 days', sale_ends_at = now() + interval '1 day'
    where slug = 'sale-fixture'$$,
  'P0001', 'Sale must end after it starts',
  'a sale window cannot end before it starts'
);
select throws_ok(
  $$update public.product_option_choices set sale_price = price_modifier
    where id = '55555555-5555-5555-5555-000000000002'$$,
  'P0001', 'Sale price must be lower than the regular price',
  'an option sale must undercut its regular modifier'
);

-- (15) a sale that is not running changes nothing on the storefront price
select is(
  (select public.effective_price(base_price, sale_price, sale_starts_at, sale_ends_at)
     from public.premade_products where slug = 'sale-fixture'),
  (select base_price from public.premade_products where slug = 'sale-fixture'),
  'an expired sale charges the regular price again'
);

-- ---------- cleanup ----------
select set_config('request.jwt.claims', '', false);
delete from public.reward_transactions
 where user_id in ('bbbbbbbb-0000-0000-0000-0000000000c2');
delete from public.orders where contact_email in ('slots.buyer@example.test');
delete from public.checkout_sessions where session_id in ('slots-cs');
delete from public.premade_products where slug in ('slots-fixture','sale-fixture');
delete from auth.users where id in
  ('aaaaaaaa-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-0000000000c2');
drop function if exists tap_save_slots();
drop function if exists tap_slot_validation();
drop function if exists tap_price_slots();
drop function if exists tap_slot_pick_errors();
drop function if exists tap_slot_fulfilment();
drop function if exists tap_sale_pricing();
drop function if exists tap_choice_sale();

select * from finish();
