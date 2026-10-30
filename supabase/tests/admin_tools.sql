-- Admin RPC authorization and write-through behavior. Run: supabase test db.
create extension if not exists pgtap;
select plan(18);

select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_admin(uuid,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.bootstrap_admin(uuid,text)', 'EXECUTE'),
  'initial admin bootstrap can only be called by the server-side service role'
);

insert into auth.users(id,email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001','admin-tools@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000002','staff-tools@example.com');
update public.profiles set role='admin' where id='aaaaaaaa-aaaa-aaaa-aaaa-000000000001';

-- A normal account cannot call any privileged SECURITY DEFINER RPC.
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-000000000002","role":"authenticated"}', false);
select throws_ok($$select public.admin_save_product('{}'::jsonb,'[]'::jsonb)$$,
  'P0001','Not permitted to manage products','customers cannot save products');
select throws_ok($$select public.admin_update_user('aaaaaaaa-aaaa-aaaa-aaaa-000000000001','customer',null,null)$$,
  'P0001','Not permitted to change users','customers cannot change roles');
select throws_ok($$select public.set_user_active('aaaaaaaa-aaaa-aaaa-aaaa-000000000001',false)$$,
  'P0001','Not permitted to change users','customers cannot deactivate admins');
select throws_ok($$select public.admin_decide_payout(gen_random_uuid(),'paid','abc')$$,
  'P0001','Not permitted to manage payouts','customers cannot process payouts');

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000001","role":"authenticated"}', false);
select ok(public.is_admin(), 'an active admin has admin access');

select public.admin_save_product(
  jsonb_build_object('slug','admin-tools-fixture','name',jsonb_build_object('en','Test product'),
    'description',null,'base_price',9,'default_material_id','11111111-1111-1111-1111-000000000001',
    'category','tool','tags',jsonb_build_array('test'),'image_urls','[]'::jsonb,
    'source_model_path','admin-tools-fixture.stl','is_featured',false,'status','published'),
  jsonb_build_array(jsonb_build_object('material_id','11111111-1111-1111-1111-000000000001','price_modifier',2))
);
-- A new product's slug is its id (the storefront URLs are /product/?slug=<id>).
select ok((select p.status='published' and pm.price_modifier=2 and p.slug = p.id::text
  from public.premade_products p join public.product_materials pm on pm.product_id=p.id
  where p.name->>'en'='Test product'), 'product and allowed materials saved together');
select throws_ok($$select public.admin_save_product(to_jsonb(p),
  '[{"material_id":"99999999-9999-9999-9999-999999999999","price_modifier":0}]'::jsonb)
  from public.premade_products p where p.name->>'en'='Test product'$$,
  'P0001','Default material must be allowed','invalid material changes are rejected before writes');
select is((select count(*)::int from public.product_materials pm
  join public.premade_products p on p.id=pm.product_id where p.name->>'en'='Test product'),
  1, 'failed save leaves material mappings intact');

select ok((select role='employee' and location_id='00000000-0000-0000-0000-000000000001'
  from public.admin_update_user('bbbbbbbb-bbbb-bbbb-bbbb-000000000002','employee',
    '00000000-0000-0000-0000-000000000001','Test staff')),
  'admin assigns a staff role and active location');
select throws_ok($$select public.admin_update_user('aaaaaaaa-aaaa-aaaa-aaaa-000000000001','customer',null,'Admin')$$,
  'P0001','You cannot remove your own admin role','admins cannot demote themselves');
select throws_ok($$select public.set_user_active('aaaaaaaa-aaaa-aaaa-aaaa-000000000001',false)$$,
  'P0001','You cannot deactivate your own account','admins cannot deactivate themselves');

select public.set_user_active('bbbbbbbb-bbbb-bbbb-bbbb-000000000002',false);
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-000000000002","role":"authenticated"}', false);
select is(public.is_staff(), false, 'inactive staff lose RLS staff privileges');
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000001","role":"authenticated"}', false);
select public.set_user_active('bbbbbbbb-bbbb-bbbb-bbbb-000000000002',true);
select ok((select is_active from public.profiles where id='bbbbbbbb-bbbb-bbbb-bbbb-000000000002'),
  'admin can reactivate a staff account');

insert into public.payouts(id,creator_id,amount) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-000000000002',10);
select is((select status from public.admin_decide_payout('aaaaaaaa-aaaa-aaaa-aaaa-000000000003','processing')),
  'processing','payout can move to processing');
select ok((select status='paid' and reference='bank-123' and processed_by='aaaaaaaa-aaaa-aaaa-aaaa-000000000001'
  from public.admin_decide_payout('aaaaaaaa-aaaa-aaaa-aaaa-000000000003','paid','bank-123')),
  'paid payouts record an admin and a transfer reference');
select throws_ok($$select public.admin_decide_payout('aaaaaaaa-aaaa-aaaa-aaaa-000000000003','rejected')$$,
  'P0001','Invalid payout transition','a paid payout cannot be changed again');
select set_config('request.jwt.claims','',false);
select throws_ok($$select public.price_cart(jsonb_build_object(
  'location_id','00000000-0000-0000-0000-000000000001',
  'items',jsonb_build_array(jsonb_build_object('kind','document','pages',1,'color','grayscale',
    'duplex',false,'quantity',1,'file_path','missing/document.pdf'))))$$,
  'P0001','Invalid document path','document pricing requires an owned or guest upload path');

select set_config('request.jwt.claims','',false);
delete from public.payouts where id='aaaaaaaa-aaaa-aaaa-aaaa-000000000003';
delete from public.premade_products where name->>'en'='Test product';
delete from auth.users where id in ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-000000000002');
select * from finish();
