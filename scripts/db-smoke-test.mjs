// Run every migration and exercise admin/checkout RPCs in an embedded Postgres.
// This stubs Supabase's auth/storage schemas; run `supabase test db` for the
// full service's pgTAP/RLS integration tests as well.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const db = new PGlite({ extensions: { pgcrypto, pg_trgm, uuid_ossp } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
const buyer = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002';
const location = '00000000-0000-0000-0000-000000000001';
const pla = '11111111-1111-1111-1111-000000000001';
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await rows(sql, params))[0];
const claims = async (id) => {
  await rows('select set_config($1,$2,false)', [
    'request.jwt.claims', id ? JSON.stringify({ sub: id, role: 'authenticated' }) : '',
  ]);
};
const cart = (items, extras = {}) => ({ location_id: location, user_id: buyer, items, ...extras });
const pricing = async (value) => (await one('select public.price_cart($1::jsonb) as value', [JSON.stringify(value)])).value;
const exampleProduct = (extras = {}) => ({
  slug: 'db-smoke-product', name: { en: 'Smoke test' }, description: { en: 'Test' },
  base_price: 9, default_material_id: pla, category: 'tool', tags: [],
  image_urls: [], source_model_path: 'admin/smoke.stl', is_featured: false,
  status: 'published', ...extras,
});
const saveProduct = async (product, materials) =>
  (await one('select id,slug,status from public.admin_save_product($1::jsonb,$2::jsonb)',
    [JSON.stringify(product), JSON.stringify(materials)]));
const materials = [{ material_id: pla, price_modifier: 2 }];

try {
  // Only the minimum Supabase-owned schemas needed for these migrations.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(
      id uuid primary key, instance_id uuid, aud varchar(255), role varchar(255),
      email text unique, encrypted_password varchar(255), email_confirmed_at timestamptz,
      raw_app_meta_data jsonb, raw_user_meta_data jsonb not null default '{}'::jsonb,
      confirmation_token varchar(255), recovery_token varchar(255),
      email_change varchar(255), email_change_token_new varchar(255),
      created_at timestamptz, updated_at timestamptz
    );
    create table auth.identities(
      id uuid primary key default gen_random_uuid(),
      provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
      identity_data jsonb not null, provider text not null,
      last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
      unique(provider_id,provider)
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text, metadata jsonb);
    alter table storage.objects enable row level security;
    create function storage.foldername(path text) returns text[] language sql immutable as $$
      select string_to_array(path,'/') $$;
  `);
  let migrationCount = 0;
  for (const file of (await readdir(join(root, 'supabase/migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    try {
      await db.exec(await readFile(join(root, 'supabase/migrations', file), 'utf8'));
      await db.exec('reset all'); // Supabase applies each migration in a fresh session.
      migrationCount++;
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }
  assert.ok(migrationCount >= 19, 'Expected the complete baseline and admin migration chain');
  console.log(`✓ ${migrationCount} migrations applied`);

  await db.exec(`insert into auth.users(id,email) values
    ('${admin}','db-admin@example.test'),('${buyer}','db-buyer@example.test');`);

  // An authenticated user cannot grant themselves a role, call the one-time
  // service-only bootstrap, or invoke admin RPCs before an admin exists.
  await db.exec('grant usage on schema auth to authenticated; grant select on public.profiles to authenticated');
  await claims(buyer);
  await db.exec('set role authenticated');
  await assert.rejects(rows('update public.profiles set role=$1 where id=$2', ['admin', buyer]), /permission denied/);
  await assert.rejects(one('select public.bootstrap_admin($1,$2)', [buyer, 'db-buyer@example.test']), /permission denied/);
  await assert.rejects(saveProduct(exampleProduct(), materials), /Admin only/);
  await assert.rejects(rows('select public.admin_update_user($1,$2,$3,$4)', [admin, 'customer', null, 'Fake']), /Admin only/);
  await assert.rejects(rows('select public.set_user_active($1,$2)', [admin, false]), /Admin only/);
  await db.exec('reset role');
  await db.exec('set role service_role');
  await assert.rejects(one('select public.bootstrap_admin($1,$2)', [admin, 'wrong@example.test']), /Eligible account not found/);
  await one('select public.bootstrap_admin($1,$2)', [admin, 'db-admin@example.test']);
  await assert.rejects(one('select public.bootstrap_admin($1,$2)', [buyer, 'db-buyer@example.test']), /active admin already exists/);
  await db.exec('reset role');
  await claims(admin);
  console.log('✓ verified one-time bootstrap requires the service role and correct account');
  assert.equal((await one('select public.is_admin() as admin')).admin, true);

  // These are the same RLS-protected table operations used by the admin forms.
  const newLocation = 'dddddddd-0000-0000-0000-000000000001';
  const newMaterial = 'eeeeeeee-0000-0000-0000-000000000001';
  const newFilament = 'ffffffff-0000-0000-0000-000000000001';
  await db.exec(`grant select,insert,update on public.locations,public.materials,
    public.filaments,public.location_filaments to authenticated`);
  await db.exec('set role authenticated');
  await rows(`insert into public.locations(id,name,timezone,hourly_machine_rate,tax_rate)
    values($1,'DB smoke location','Asia/Hong_Kong',10,0.05)`, [newLocation]);
  await rows(`insert into public.materials(id,slug,name,density_g_cm3)
    values($1,'db-smoke-pla',$2::jsonb,1.25)`, [newMaterial, '{"en":"Test PLA"}']);
  await rows(`insert into public.filaments(id,material_id,color,cost_per_gram)
    values($1,$2,$3::jsonb,0.04)`, [newFilament, newMaterial, '{"en":"Blue"}']);
  await rows(`insert into public.location_filaments(location_id,filament_id,in_stock)
    values($1,$2,true)`, [newLocation, newFilament]);
  await db.exec('reset role');
  await claims(buyer);
  const stocked = await rows('select filament_id from public.available_filaments($1,$2)', [newLocation, newMaterial]);
  assert.equal(stocked[0].filament_id, newFilament);
  await db.exec('set role authenticated');
  const blocked = await db.query(`update public.materials set density_g_cm3=8 where id=$1`, [newMaterial]);
  assert.equal(blocked.affectedRows, 0);
  await db.exec('reset role');
  await claims(admin);
  console.log('✓ admin forms can add locations, materials, filaments and per-location stock');

  const product = await saveProduct(exampleProduct(), materials);
  assert.equal(product.status, 'published');
  assert.equal((await pricing(cart([{ kind: 'premade', product_id: product.id,
    material_id: pla, quantity: 2, options: {} }]))).lines[0].unit_price, 11);
  await assert.rejects(saveProduct(exampleProduct({ id: product.id }),
    [{ material_id: '99999999-9999-9999-9999-999999999999', price_modifier: 0 }]),
  /Default material must be allowed/);
  assert.equal(Number((await one('select count(*) as n from public.product_materials where product_id=$1', [product.id])).n), 1);
  console.log('✓ privileged product save and atomic material validation');

  const [group, a, b] = [
    'aaaaaaaa-0000-0000-0000-000000000003',
    'aaaaaaaa-0000-0000-0000-000000000004',
    'aaaaaaaa-0000-0000-0000-000000000005',
  ];
  await db.exec(`
    insert into public.product_option_groups(id,product_id,label,option_type,required)
      values('${group}','${product.id}','{"en":"Accessories"}'::jsonb,'select_many',true);
    insert into public.product_option_choices(id,group_id,label,price_modifier)
      values('${a}','${group}','{"en":"First"}'::jsonb,1),
            ('${b}','${group}','{"en":"Second"}'::jsonb,2);
  `);
  const premade = { kind: 'premade', product_id: product.id, material_id: pla,
    quantity: 2, options: { [group]: { choice_ids: [a, b] } } };
  await assert.rejects(pricing(cart([{ ...premade, options: {} }])), /Required option missing/);
  const pricedOptions = await pricing(cart([premade]));
  assert.equal(pricedOptions.lines[0].unit_price, 14);
  assert.equal(pricedOptions.lines[0].item_snapshot.model_path, 'admin/smoke.stl');
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-options',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(cart([premade])), buyer, location]);
  await rows('select public.create_order_from_cart($1,$2,$3,$4,$5,$6)',
    ['smoke-options', buyer, location, 'db-buyer@example.test', 'Buyer', 'en']);
  assert.equal(Number((await one('select count(*) as n from public.order_item_option_values where option_group_id=$1', [group])).n), 2);
  console.log('✓ required options are priced and multi-select choices survive fulfillment');

  const fileGroup = 'aaaaaaaa-0000-0000-0000-000000000006';
  const filePath = `${buyer}/smoke.png`;
  await db.exec(`
    insert into public.product_option_groups(id,product_id,label,option_type,required)
      values('${fileGroup}','${product.id}','{"en":"Artwork"}'::jsonb,'file',true);
    insert into public.file_option_config(group_id,allowed_mime_types,max_size_bytes,required)
      values('${fileGroup}',array['image/png'],1024,true);
    insert into storage.objects(bucket_id,name,metadata)
      values('option-uploads','${filePath}','{"size":500,"mimetype":"image/png"}'::jsonb);
  `);
  await assert.rejects(pricing(cart([premade])), /Required option missing/);
  await assert.rejects(pricing(cart([{ ...premade, options: { ...premade.options,
    [fileGroup]: { file_path: `${admin}/other.png` } } }])), /Invalid file/);
  const withFile = { ...premade, options: { ...premade.options, [fileGroup]: { file_path: filePath } } };
  assert.equal((await pricing(cart([withFile]))).lines[0].unit_price, 14);
  await db.exec(`update storage.objects set metadata='{"size":2000,"mimetype":"image/png"}'::jsonb
    where bucket_id='option-uploads' and name='${filePath}'`);
  await assert.rejects(pricing(cart([withFile])), /File is not allowed/);
  console.log('✓ file option ownership, MIME and size checks');

  // Document rate edits are reflected by the same authoritative pricing RPC
  // that checkout and the admin settings panel use.
  const docPath = `${buyer}/smoke.pdf`;
  await db.exec(`insert into storage.objects(bucket_id,name) values('document-prints','${docPath}');
    update public.platform_settings set value='0.75'::jsonb where key='document.grayscale_per_side'`);
  const document = { kind: 'document', pages: 2, color: 'grayscale', duplex: false,
    quantity: 1, file_path: docPath };
  const docCart = cart([document]);
  assert.equal((await pricing(docCart)).lines[0].unit_price, 1.5);
  await assert.rejects(pricing({ ...docCart, user_id: null }), /Sign in to upload documents/);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-doc',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(docCart), buyer, location]);
  const orderParams = ['smoke-doc', buyer, location, 'db-buyer@example.test', 'Buyer', 'en'];
  const [order] = await rows('select id,total_amount from public.create_order_from_cart($1,$2,$3,$4,$5,$6)', orderParams);
  const retry = await one('select id from public.create_order_from_cart($1,$2,$3,$4,$5,$6)', orderParams);
  assert.equal(retry.id, order.id);
  assert.equal(Number((await one('select count(*) as n from public.orders where stripe_session_id=$1', ['smoke-doc'])).n), 1);
  console.log('✓ admin document rate, verified upload and idempotent order');

  await db.exec(`insert into public.coupons(code,source,discount_type,discount_value,user_id)
    values('SMOKEDISCOUNT','admin','fixed',5,'${buyer}')`);
  const couponCart = cart([{ ...premade, options: { ...premade.options,
    [fileGroup]: { file_path: filePath } } }], { coupon_code: 'SMOKEDISCOUNT' });
  await db.exec(`update storage.objects set metadata='{"size":500,"mimetype":"image/png"}'::jsonb
    where bucket_id='option-uploads' and name='${filePath}'`);
  assert.equal((await pricing(couponCart)).discount_amount, 5);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-coupon',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(couponCart), buyer, location]);
  const couponOrder = await one('select id from public.create_order_from_cart($1,$2,$3,$4,$5,$6)',
    ['smoke-coupon', buyer, location, 'db-buyer@example.test', 'Buyer', 'en']);
  assert.equal((await one('select status from public.coupons where code=$1', ['SMOKEDISCOUNT'])).status, 'used');
  assert.equal((await one('select discount_amount from public.orders where id=$1', [couponOrder.id])).discount_amount, '5.00');
  console.log('✓ coupon discount is consumed at fulfillment');

  const submissionId = 'cccccccc-0000-0000-0000-000000000001';
  await db.exec(`grant select,insert,update,delete on public.model_submissions to authenticated;
    grant select,insert,update,delete on public.model_submission_materials to authenticated;`);
  await claims(buyer);
  await db.exec('set role authenticated');
  await rows(`insert into public.model_submissions
    (id,submitter_id,status,title,license,ip_warranty,model_path,base_price)
    values ($1,$2,'draft',$3::jsonb,'CC0',true,$4,12)`,
  [submissionId, buyer, JSON.stringify({ en: 'Created by a customer' }), `${buyer}/test.stl`]);
  await rows(`insert into public.model_submission_materials(submission_id,material_id,price_modifier)
    values($1,$2,0)`, [submissionId, pla]);
  await rows(`update public.model_submissions set status='pending_review', submitted_at=now() where id=$1`, [submissionId]);
  const deletePending = await db.query('delete from public.model_submissions where id=$1', [submissionId]);
  assert.equal(deletePending.affectedRows, 0);
  await db.exec('reset role');
  await claims(admin);
  assert.equal((await one('select status from public.model_submissions where id=$1', [submissionId])).status, 'pending_review');
  console.log('✓ creators can add materials in draft but cannot delete submitted reviews');

  await one('select public.admin_update_user($1,$2,$3,$4)', [buyer, 'employee', location, 'Staff']);
  await one('select public.set_user_active($1,$2)', [buyer, false]);
  await claims(buyer);
  assert.equal((await one('select public.is_staff() as allowed')).allowed, false);
  assert.equal((await one('select public.is_staff_at($1) as allowed', [location])).allowed, false);
  await claims(admin);
  await assert.rejects(one('select public.set_user_active($1,$2)', [admin, false]), /own account/);
  await one('select public.set_user_active($1,$2)', [buyer, true]);
  assert.equal((await one('select is_active from public.profiles where id=$1', [buyer])).is_active, true);

  const payoutId = 'aaaaaaaa-0000-0000-0000-000000000099';
  await rows('insert into public.payouts(id,creator_id,amount) values($1,$2,$3)', [payoutId, buyer, 10]);
  await one('select public.admin_decide_payout($1,$2)', [payoutId, 'processing']);
  await one('select public.admin_decide_payout($1,$2,$3)', [payoutId, 'paid', 'bank-smoke']);
  assert.equal((await one('select processed_by from public.payouts where id=$1', [payoutId])).processed_by, admin);
  await assert.rejects(one('select public.admin_decide_payout($1,$2)', [payoutId, 'rejected']), /Invalid payout transition/);
  console.log('✓ inactive staff blocked, self-lockout prevented and payouts audited');

  await claims(buyer);
  await assert.rejects(one('select public.admin_decide_submission($1,$2,$3)',
    [submissionId, 'approve', '']), /Admin only/);
  await claims(admin);
  await assert.rejects(one('select public.admin_decide_submission($1,$2,$3)',
    [submissionId, 'reject', '']), /Review notes are required/);
  const reviewed = await one('select status,published_product_id from public.admin_decide_submission($1,$2,$3,$4::jsonb,$5)',
    [submissionId, 'approve', '', '{}', 'submitted-model.stl']);
  assert.equal(reviewed.status, 'approved');
  const credited = await one('select submitted_by,source_submission_id,status from public.premade_products where id=$1',
    [reviewed.published_product_id]);
  assert.equal(credited.submitted_by, buyer);
  assert.equal(credited.source_submission_id, submissionId);
  assert.equal(credited.status, 'published');
  assert.equal((await one('select is_creator from public.profiles where id=$1', [buyer])).is_creator, true);
  await assert.rejects(one('select public.admin_decide_submission($1,$2,$3,$4::jsonb,$5)',
    [submissionId, 'approve', '', '{}', 'second-model.stl']), /already been reviewed/);
  console.log('✓ submission approval publishes product, links creator and cannot repeat');

  // `supabase db reset` runs seed.sql only after migrations. It is deliberately
  // separate from the production migrations and safe to re-run locally.
  const localSeed = await readFile(join(root, 'supabase/seed.sql'), 'utf8');
  await db.exec(localSeed);
  await db.exec(localSeed);
  const seeded = await rows(`select u.id, u.email, u.encrypted_password,
    u.email_confirmed_at, u.raw_app_meta_data, u.raw_user_meta_data,
    p.role as profile_role, p.location_id, p.referral_code,
    i.provider, i.provider_id, i.identity_data,
    crypt('LocalTest123!',u.encrypted_password)=u.encrypted_password as valid_password
    from auth.users u join public.profiles p on p.id=u.id
    join auth.identities i on i.user_id=u.id and i.provider='email'
    where u.email in ('admin@example.test','employee@example.test','customer@example.test')
    order by u.email`);
  assert.equal(seeded.length, 3);
  const expectedRoles = { 'admin@example.test': 'admin',
    'employee@example.test': 'employee', 'customer@example.test': 'customer' };
  for (const user of seeded) {
    assert.equal(user.profile_role, expectedRoles[user.email]);
    assert.equal(user.email_confirmed_at !== null, true);
    assert.equal(user.valid_password, true);
    assert.equal(user.raw_app_meta_data.provider, 'email');
    assert.equal(user.provider_id, user.id);
    assert.equal(user.identity_data.sub, user.id);
    assert.equal(user.identity_data.email, user.email);
    assert.equal(user.identity_data.email_verified, true);
    assert.equal(user.location_id, user.email === 'employee@example.test' ? location : null);
    assert.equal(Number((await one('select count(*) as n from public.carts where user_id=$1', [user.id])).n), 1);
  }
  assert.equal(new Set(seeded.map((user) => user.referral_code)).size, 3);
  console.log('✓ local seed creates three sign-in identities, profiles, carts and assignments');

  console.log('All embedded Postgres admin/checkout smoke checks passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
