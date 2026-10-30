// Run every migration and exercise admin/checkout RPCs in an embedded Postgres.
// This stubs Supabase's auth/storage schemas; run `supabase test db` for the
// full service's pgTAP/RLS integration tests as well.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEmbeddedDb, applySchema, ROOT } from './lib/embedded-db.mjs';

const db = createEmbeddedDb();
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
  const migrationCount = await applySchema(db);
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
  await assert.rejects(saveProduct(exampleProduct(), materials), /Not permitted to manage products/);
  await assert.rejects(rows('select public.admin_update_user($1,$2,$3,$4)', [admin, 'customer', null, 'Fake']), /Not permitted to change users/);
  await assert.rejects(rows('select public.set_user_active($1,$2)', [admin, false]), /Not permitted to change users/);
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
  // Country defaults to HK, so the trigger drops the rate the form tried to set.
  assert.equal(Number((await one('select tax_rate from public.locations where id=$1',
    [newLocation])).tax_rate), 0);
  await rows(`insert into public.materials(id,slug,name,density_g_cm3,cost_per_gram)
    values($1,'db-smoke-pla',$2::jsonb,1.25,0.31)`, [newMaterial, '{"en":"Test PLA"}']);
  await rows(`insert into public.filaments(id,material_id,color)
    values($1,$2,$3::jsonb)`, [newFilament, newMaterial, '{"en":"Blue"}']);
  await rows(`insert into public.location_filaments(location_id,filament_id,in_stock)
    values($1,$2,true)`, [newLocation, newFilament]);
  await db.exec('reset role');
  await claims(buyer);
  const stocked = await rows('select filament_id,cost_per_gram from public.available_filaments($1,$2)', [newLocation, newMaterial]);
  assert.equal(stocked[0].filament_id, newFilament);
  assert.equal(Number(stocked[0].cost_per_gram), 0.31);
  await db.exec('set role authenticated');
  const blocked = await db.query(`update public.materials set density_g_cm3=8 where id=$1`, [newMaterial]);
  assert.equal(blocked.affectedRows, 0);
  await db.exec('reset role');
  await claims(admin);
  console.log('✓ admin forms can add locations, materials, filaments and per-location stock');

  const product = await saveProduct(exampleProduct(), materials);
  assert.equal(product.slug, product.id, 'new product slugs are generated from their IDs');
  assert.equal(product.status, 'published');
  const productChoices = await rows('select id,slug from public.search_product_choices($1,$2)', ['Smoke test', true]);
  assert.equal(productChoices.some((row) => row.id === product.id), true,
    'staff product search returns matching published choices');
  await claims(buyer);
  assert.equal((await rows('select id from public.search_product_choices($1,$2)', ['Smoke test', false])).length, 0,
    'product search does not disclose choices to customers');
  await claims(admin);

  // The catalog is public: explicit anon table grants plus the published-only
  // RLS policy return products without exposing drafts or requiring a session.
  await claims(null);
  await db.exec('set role anon');
  const anonymousCatalog = await rows('select id,slug from public.premade_products where id=$1 and status=\'published\'', [product.id]);
  assert.equal(anonymousCatalog.length, 1);
  assert.equal(anonymousCatalog[0].slug, product.slug);
  const anonymousDrafts = await rows('select id from public.premade_products where status<>\'published\'');
  assert.equal(anonymousDrafts.length, 0);
  await db.exec('reset role');
  await claims(admin);
  console.log('✓ anonymous visitors can read published catalog products only');

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
  assert.equal(pricedOptions.lines[0].item_snapshot.model_path, null);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-options',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(cart([premade])), buyer, location]);
  await rows('select public.create_order_from_cart($1,$2,$3,$4,$5,$6)',
    ['smoke-options', buyer, location, 'db-buyer@example.test', 'Buyer', 'en']);
  assert.equal(Number((await one('select count(*) as n from public.order_item_option_values where option_group_id=$1', [group])).n), 2);
  console.log('✓ required options persist and used choices can be deleted without deleting order history');

  // A print can combine materials: named slots, each with its own eligible
  // materials, price modifiers and default material/colour.
  const petg = '11111111-1111-1111-1111-000000000002';
  const tpu = '11111111-1111-1111-1111-000000000004';
  const plaRed = '22222222-2222-2222-2222-000000000003';
  const petgClear = '22222222-2222-2222-2222-000000000005';
  const tpuBlack = '22222222-2222-2222-2222-000000000008';
  const slotsPayload = [
    { name: { en: 'Body' }, sort_order: 0, default_material_id: tpu, default_filament_id: tpuBlack,
      materials: [{ material_id: tpu, price_modifier: 0 }, { material_id: pla, price_modifier: -2 }] },
    { name: { en: 'Accent' }, sort_order: 1, default_material_id: pla, default_filament_id: plaRed,
      materials: [{ material_id: pla, price_modifier: 0 }, { material_id: petg, price_modifier: 1.5 }] },
    { name: { en: 'Arms' }, sort_order: 2, linked_ordinal: 1, default_material_id: tpu,
      default_filament_id: tpuBlack, materials: [{ material_id: tpu, price_modifier: 0 },
        { material_id: pla, price_modifier: -2 }] },
  ];
  const slotProduct = await one('select id,slug from public.admin_save_product($1::jsonb,$2::jsonb,$3::jsonb)',
    [JSON.stringify(exampleProduct({ slug: 'db-smoke-slots', name: { en: 'Smoke slots' }, base_price: 20 })),
     JSON.stringify([]), JSON.stringify(slotsPayload)]);
  const slotIds = await rows('select id from public.product_material_slots where product_id=$1 order by sort_order',
    [slotProduct.id]);
  assert.equal(slotIds.length, 3);

  // No slots in the cart line: the slot defaults are used and priced.
  const slotLine = { kind: 'premade', product_id: slotProduct.id, quantity: 1, options: {} };
  const defaultSlots = await pricing(cart([slotLine]));
  assert.equal(Number(defaultSlots.lines[0].unit_price), 20); // 20 + TPU 0 + PLA 0
  assert.equal(defaultSlots.lines[0].item_snapshot.slots.length, 3);
  assert.equal(defaultSlots.lines[0].item_snapshot.slots[0].name.en, 'Body');
  assert.equal(defaultSlots.lines[0].item_snapshot.slots[0].color.id, tpuBlack);
  assert.equal(defaultSlots.lines[0].item_snapshot.slots[1].color.id, plaRed);
  assert.equal(defaultSlots.lines[0].item_snapshot.slots[2].material.id, tpu);

  // Picking another eligible material per slot moves the price by its modifier.
  const customSlots = await pricing(cart([{ ...slotLine, quantity: 2, slots: {
    [slotIds[0].id]: { material_id: pla, color_filament_id: plaRed },
    [slotIds[1].id]: { material_id: petg, color_filament_id: petgClear },
  } }]));
  assert.equal(Number(customSlots.lines[0].unit_price), 17.5); // 20 - 2 + 1.5 - 2 for linked Arms
  assert.equal(customSlots.lines[0].item_snapshot.slots[1].color.color_hex, '#e0f7ff');

  // A material outside the slot's list, or a colour of another material, is refused.
  await assert.rejects(pricing(cart([{ ...slotLine, slots: { [slotIds[0].id]: { material_id: petg } } }])),
    /Material not allowed for Body/);
  await assert.rejects(pricing(cart([{ ...slotLine, slots: {
    [slotIds[0].id]: { material_id: tpu, color_filament_id: plaRed } } }])),
    /Color\/material mismatch for Body/);
  const linkedSelection = await pricing(cart([{ ...slotLine, slots: {
    [slotIds[0].id]: { material_id: pla, color_filament_id: plaRed },
  } }]));
  assert.equal(linkedSelection.lines[0].item_snapshot.slots[0].material.id, pla);
  assert.equal(linkedSelection.lines[0].item_snapshot.slots[2].material.id, pla);
  assert.equal(linkedSelection.lines[0].item_snapshot.slots[2].color.id, plaRed);

  // Fulfilment keeps every slot selection so the print can be made as ordered.
  const slotCart = cart([{ ...slotLine, slots: { [slotIds[1].id]: { material_id: petg } } }]);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-slots',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(slotCart), buyer, location]);
  const slotOrder = await one('select id from public.create_order_from_cart($1,$2,$3,$4,$5,$6)',
    ['smoke-slots', buyer, location, 'db-buyer@example.test', 'Buyer', 'en']);
  const slotItem = await one('select material_id,material_slots from public.order_items where order_id=$1', [slotOrder.id]);
  assert.equal(slotItem.material_slots.length, 3);
  assert.equal(slotItem.material_slots[1].material.name.en, 'PETG');
  assert.equal(slotItem.material_id, tpu); // the first slot keeps the legacy column
  await assert.rejects(one('select id from public.admin_save_product($1::jsonb,$2::jsonb,$3::jsonb)',
    [JSON.stringify(exampleProduct({ id: slotProduct.id, slug: 'db-smoke-slots', base_price: 20 })),
     JSON.stringify([]),
     JSON.stringify([{ name: { en: 'Body' }, default_material_id: petg, materials: [{ material_id: tpu, price_modifier: 0 }] }])]),
  /Default material must be eligible for the slot/);
  console.log('✓ material slots share choices when linked, price per part and survive fulfillment');

  // Sale prices: a product and an option choice can both be discounted, with an
  // optional window, and price_cart reports the saving.
  const saleProduct = await saveProduct(exampleProduct({ slug: 'db-smoke-sale', base_price: 30, sale_price: 24 }), materials);
  const onSale = await pricing(cart([{ kind: 'premade', product_id: saleProduct.id, material_id: pla,
    quantity: 2, options: {} }]));
  assert.equal(Number(onSale.lines[0].unit_price), 26); // 24 sale + 2 material
  assert.equal(Number(onSale.sale_savings), 12);        // (30 - 24) x 2
  assert.equal(Number(onSale.lines[0].item_snapshot.regular_price), 30);
  assert.equal(Number(onSale.lines[0].item_snapshot.sale_price), 24);

  const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
  const day = 86400000;
  const futureSale = await saveProduct(exampleProduct({ slug: 'db-smoke-sale-future', base_price: 30,
    sale_price: 20, sale_starts_at: iso(day) }), materials);
  const expiredSale = await saveProduct(exampleProduct({ slug: 'db-smoke-sale-expired', base_price: 30,
    sale_price: 20, sale_starts_at: iso(-2 * day), sale_ends_at: iso(-day) }), materials);
  const windowSale = await saveProduct(exampleProduct({ slug: 'db-smoke-sale-window', base_price: 30,
    sale_price: 20, sale_starts_at: iso(-day), sale_ends_at: iso(day) }), materials);
  for (const [row, expected, savings] of [[futureSale, 32, 0], [expiredSale, 32, 0], [windowSale, 22, 10]]) {
    const priced = await pricing(cart([{ kind: 'premade', product_id: row.id, material_id: pla,
      quantity: 1, options: {} }]));
    assert.equal(Number(priced.lines[0].unit_price), expected);
    assert.equal(Number(priced.sale_savings), savings);
  }
  await assert.rejects(saveProduct(exampleProduct({ slug: 'db-smoke-sale-bad', base_price: 10, sale_price: 12 }),
    materials), /Sale price must be lower than the regular price/);
  await assert.rejects(saveProduct(exampleProduct({ slug: 'db-smoke-sale-window-bad', base_price: 10,
    sale_price: 8, sale_starts_at: iso(day), sale_ends_at: iso(-day) }), materials), /Sale must end after it starts/);

  // The seeded demo sale: phone stand HK$8 -> HK$6, and the planter's Large
  // option HK$5 -> HK$2.50.
  const demoSale = await pricing(cart([{ kind: 'premade', product_id: '33333333-3333-3333-3333-000000000002',
    material_id: pla, quantity: 1, options: {} }]));
  assert.equal(Number(demoSale.lines[0].unit_price), 6);
  const demoChoiceSale = await pricing(cart([{ kind: 'premade', product_id: '33333333-3333-3333-3333-000000000003',
    material_id: pla, quantity: 1,
    options: { '44444444-4444-4444-4444-000000000001': { choice_id: '55555555-5555-5555-5555-000000000002' } } }]));
  assert.equal(Number(demoChoiceSale.lines[0].unit_price), 14.5); // 12 + 0 + 2.50 sale on Large
  assert.equal(Number(demoChoiceSale.sale_savings), 2.5);
  console.log('✓ sale prices apply within their window and report the saving');

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
  // Another account's owner path is not a capability, but a random guest path
  // is orderable with user_id null and prices through the same authoritative RPC.
  await assert.rejects(pricing({ ...docCart, user_id: null }), /Invalid document path/);
  const guestDocPath = 'guest/123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174001.pdf';
  await rows('insert into storage.objects(bucket_id,name) values(\'document-prints\',$1)', [guestDocPath]);
  const guestDocument = { ...document, file_path: guestDocPath };
  const guestDocCart = { ...docCart, user_id: null, items: [guestDocument] };
  assert.equal((await pricing(guestDocCart)).lines[0].unit_price, 1.5);
  assert.equal((await one('select public._document_path_allowed($1,null) as allowed',
    [`${buyer}/someone-else.pdf`])).allowed, false);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-doc',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(docCart), buyer, location]);
  const orderParams = ['smoke-doc', buyer, location, 'db-buyer@example.test', 'Buyer', 'en'];
  const [order] = await rows('select id,total_amount from public.create_order_from_cart($1,$2,$3,$4,$5,$6)', orderParams);
  const retry = await one('select id from public.create_order_from_cart($1,$2,$3,$4,$5,$6)', orderParams);
  assert.equal(retry.id, order.id);
  assert.equal(Number((await one('select count(*) as n from public.orders where stripe_session_id=$1', ['smoke-doc'])).n), 1);
  console.log('✓ admin document rate, owner/guest uploads and idempotent order');

  await db.exec(`insert into public.coupons(code,source,discount_type,discount_value,user_id)
    values('SMOKEDISCOUNT','admin','fixed',5,'${buyer}')`);
  const couponCart = cart([{ ...premade, options: { ...premade.options,
    [fileGroup]: { file_path: filePath } } }], { coupon_code: 'SMOKEDISCOUNT', note: 'Please include the assembly instructions.' });
  await db.exec(`update storage.objects set metadata='{"size":500,"mimetype":"image/png"}'::jsonb
    where bucket_id='option-uploads' and name='${filePath}'`);
  assert.equal((await pricing(couponCart)).discount_amount, 5);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-coupon',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(couponCart), buyer, location]);
  const couponOrder = await one('select id from public.create_order_from_cart($1,$2,$3,$4,$5,$6)',
    ['smoke-coupon', buyer, location, 'db-buyer@example.test', 'Buyer', 'en']);
  assert.equal((await one('select status from public.coupons where code=$1', ['SMOKEDISCOUNT'])).status, 'used');
  const customerNote = await one('select body,kind,author_id from public.order_notes where order_id=$1', [couponOrder.id]);
  assert.deepEqual(customerNote, { body: 'Please include the assembly instructions.', kind: 'customer', author_id: buyer });
  assert.equal((await one('select discount_amount from public.orders where id=$1', [couponOrder.id])).discount_amount, '5.00');
  console.log('✓ coupon discount is consumed at fulfillment');

  // Delivery: a flat fee below the free-shipping threshold, waived above it,
  // and the entered address is snapshotted onto the order.
  const deliveryAddress = { recipient: 'Ada', phone: '1234 5678', line1: '1 Example Road', district: 'Central' };
  await assert.rejects(pricing({ ...docCart, fulfilment: 'delivery' }), /delivery address is required/);
  const deliveryDocCart = { ...docCart, fulfilment: 'delivery', shipping_address: deliveryAddress };
  const deliveryDoc = await pricing(deliveryDocCart);
  assert.equal(Number(deliveryDoc.shipping_amount), 50);
  assert.equal(Number(deliveryDoc.total_amount), 51.5);
  const deliveryBulk = await pricing(cart([{ ...premade, quantity: 99,
    options: { ...premade.options, [fileGroup]: { file_path: filePath } } }],
    { fulfilment: 'delivery', shipping_address: deliveryAddress }));
  assert.equal(Number(deliveryBulk.shipping_amount), 0);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-delivery',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(deliveryDocCart), buyer, location]);
  const deliveryOrderRow = await one('select id from public.create_order_from_cart($1,$2,$3,$4,$5,$6)',
    ['smoke-delivery', buyer, location, 'db-buyer@example.test', 'Buyer', 'en']);
  const placedDelivery = await one(
    'select fulfilment,shipping_amount,shipping_address from public.orders where id=$1', [deliveryOrderRow.id]);
  assert.equal(placedDelivery.fulfilment, 'delivery');
  assert.equal(Number(placedDelivery.shipping_amount), 50);
  assert.equal(placedDelivery.shipping_address.district, 'Central');
  console.log('✓ delivery fee, free-shipping threshold and saved address');

  // The shop is Hong Kong based: the seeded pickup point prices in HKD on Hong
  // Kong time and adds no sales tax, and a small cart is no longer raised to a
  // minimum order fee.
  const seededLocation = await one(
    'select name,country,currency,timezone,tax_rate from public.locations where id=$1', [location]);
  // The one shop's branches are named after their neighbourhood only.
  assert.equal(seededLocation.name, 'Central');
  assert.equal(seededLocation.country, 'HK');
  assert.equal(seededLocation.currency, 'HKD');
  assert.equal(seededLocation.timezone, 'Asia/Hong_Kong');
  assert.equal(Number(seededLocation.tax_rate), 0);
  assert.equal(Number((await pricing(docCart)).total_amount), 1.5);

  // Sales tax is a property of the location's country, so a new Hong Kong row is
  // forced to zero even when the admin types a rate.
  const hkLocation = 'dddddddd-0000-0000-0000-000000000002';
  await rows(`insert into public.locations(id,name,timezone,hourly_machine_rate,tax_rate,country)
    values($1,'DB smoke Hong Kong','Asia/Hong_Kong',10,0.05,'hk')`, [hkLocation]);
  const hkLocationRow = await one('select country,tax_rate from public.locations where id=$1', [hkLocation]);
  assert.equal(hkLocationRow.country, 'HK');
  assert.equal(Number(hkLocationRow.tax_rate), 0);
  const hkDocPricing = await pricing({ ...docCart, location_id: hkLocation });
  assert.equal(Number(hkDocPricing.tax_amount), 0);
  assert.equal(Number(hkDocPricing.total_amount), 1.5);

  // The tax feature itself is kept for the speculative expansion abroad: a
  // taxable country still charges its own rate, in its own currency.
  const abroadLocation = 'dddddddd-0000-0000-0000-000000000003';
  await rows(`insert into public.locations(id,name,timezone,hourly_machine_rate,tax_rate,currency,country)
    values($1,'DB smoke abroad','Asia/Taipei',10,0.05,'USD','TW')`, [abroadLocation]);
  const abroadPricing = await pricing({ ...docCart, location_id: abroadLocation });
  assert.equal(abroadPricing.country, 'TW');
  assert.equal(abroadPricing.currency, 'USD');
  assert.equal(Number(abroadPricing.tax_amount), 0.08);
  assert.equal(Number(abroadPricing.total_amount), 1.58);
  console.log('✓ Hong Kong prices tax-free in HKD while a taxable country still charges');

  // Coupons can require a minimum spend or discount a single product only.
  const keychain = await saveProduct(exampleProduct({ slug: 'db-smoke-keychain',
    name: { en: 'Smoke keychain' }, base_price: 20 }), [{ material_id: pla, price_modifier: 0 }]);
  const keychainLine = { kind: 'premade', product_id: keychain.id, material_id: pla, quantity: 1, options: {} };
  await rows(`insert into public.coupons(code,source,discount_type,discount_value,min_subtotal,user_id)
    values('SMOKEMINIMUM','admin','fixed',5,50,$1)`, [buyer]);
  await assert.rejects(pricing(cart([withFile], { coupon_code: 'SMOKEMINIMUM' })), /Spend at least 50/);
  await rows(`update public.coupons set min_subtotal=20 where code='SMOKEMINIMUM'`);
  assert.equal((await pricing(cart([withFile], { coupon_code: 'SMOKEMINIMUM' }))).discount_amount, 5);
  await rows(`insert into public.coupons(code,source,discount_type,discount_value,product_id,user_id)
    values('SMOKEITEM','admin','percent',50,$1,$2)`, [keychain.id, buyer]);
  const mixedCart = await pricing(cart([withFile, keychainLine], { coupon_code: 'SMOKEITEM' }));
  assert.equal(mixedCart.subtotal, 48);        // (9 + 2 + 3) x 2 + 20
  assert.equal(mixedCart.discount_amount, 10); // half of the keychain only
  assert.equal(Number(mixedCart.tax_amount), 0); // Hong Kong adds no sales tax
  assert.equal(Number(mixedCart.total_amount), 38);
  await assert.rejects(pricing(cart([withFile], { coupon_code: 'SMOKEITEM' })),
    /only applies to Smoke keychain/);
  console.log('✓ coupons can require a minimum spend or discount one product only');

  const historicalChoice = await one('select id from public.order_item_option_values where selected_choice_id=$1 limit 1', [a]);
  await rows('delete from public.product_option_choices where id=$1', [a]);
  assert.equal((await one('select selected_choice_id from public.order_item_option_values where id=$1', [historicalChoice.id])).selected_choice_id, null);
  console.log('✓ choices referenced by placed orders can be deleted while snapshots remain');


  // A batch of single-use codes comes from one admin-only call.
  const batch = await rows('select coupon_code from public.admin_generate_coupons($1,$2,$3,$4)',
    [40, 'SMOKE', 'fixed', 3]);
  assert.equal(batch.length, 40);
  assert.equal(new Set(batch.map((row) => row.coupon_code)).size, 40);
  assert.ok(batch.every((row) => /^SMOKE[A-Z2-9]{10}$/.test(row.coupon_code)));
  await assert.rejects(rows(`insert into public.coupons(code,source,discount_type,discount_value,min_subtotal)
    values('SMOKEBAD','admin','fixed',5,-1)`), /min_subtotal_check/);
  await claims(buyer);
  await assert.rejects(rows('select coupon_code from public.admin_generate_coupons($1,$2,$3,$4)',
    [5, 'SMOKE', 'fixed', 3]), /Not permitted to manage coupons/);
  console.log('✓ admins can generate a batch of single-use coupon codes');

  // Points can be redeemed for a coupon scoped to one product: a free item.
  await rows(`update public.platform_settings set value=$1::jsonb where key='rewards.redeem_options'`,
    [JSON.stringify([{ points: 300, discount_type: 'percent', discount_value: 100, product_id: keychain.id }])]);
  await rows('update public.profiles set points_balance=400 where id=$1', [buyer]);
  const redeemed = await one('select code,product_id from public.redeem_rewards(0)');
  assert.equal(redeemed.product_id, keychain.id);
  assert.equal((await one('select expires_at = created_at + interval \'1 year\' as annual from public.coupons where code=$1',
    [redeemed.code])).annual, true);
  assert.equal(Number((await one('select points_balance from public.profiles where id=$1', [buyer])).points_balance), 100);
  const freeItem = await pricing(cart([keychainLine], { coupon_code: redeemed.code }));
  assert.equal(freeItem.discount_amount, 20);
  assert.equal(Number(freeItem.total_amount), 0);
  console.log('✓ points can be redeemed for a specific product');
  await claims(admin);

  const submissionId = 'cccccccc-0000-0000-0000-000000000001';
  await db.exec(`grant select,insert,update,delete on public.model_submissions to authenticated;
    grant select,insert,update,delete on public.model_submission_materials to authenticated;`);
  await claims(buyer);
  await db.exec('set role authenticated');
  // Submissions ship switched off: the RLS insert policy refuses a draft while
  // the feature is disabled, and an admin turns it on when reviewers are ready.
  await assert.rejects(rows(`insert into public.model_submissions
    (id,submitter_id,status,title,license,ip_warranty,model_path,base_price)
    values ($1,$2,'draft',$3::jsonb,'CC0',true,$4,12)`,
    [submissionId, buyer, JSON.stringify({ en: 'Blocked draft' }), `${buyer}/blocked.stl`]),
  /row-level security/);
  await db.exec('reset role');
  await rows(`update public.platform_settings set value='true'::jsonb where key='features.model_submissions'`);
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
  assert.equal((await one("select public.feature_enabled('model_submissions') as on")).on, true);
  await db.exec(`update public.platform_settings set value='false'::jsonb where key='features.model_submissions'`);
  assert.equal((await one("select public.feature_enabled('model_submissions') as on")).on, false);
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
    [submissionId, 'approve', '']), /Not permitted to review submissions/);
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

  // The dashboard aggregate returns only the caller's ledger totals and never
  // needs to transfer every historical earning row to the browser.
  await rows(`insert into public.creator_earnings(creator_id,type,amount)
    values($1,'sale',12.50),($1,'sale',7.50)`, [buyer]);
  await rows(`insert into public.platform_settings(key,value) values('payouts.min_amount','1')
    on conflict(key) do update set value=excluded.value`);
  await claims(buyer);
  await db.exec('set role authenticated');
  const creatorSummary = (await one('select public.creator_dashboard_summary() as value')).value;
  assert.equal(Number(creatorSummary.balance), 10); // 20 earned - 10 already paid
  assert.equal(Number(creatorSummary.sales), 2);
  await assert.rejects(one('select public.request_payout(20)'), /Insufficient balance/);
  await one('select public.request_payout(10)');
  const reservedSummary = (await one('select public.creator_dashboard_summary() as value')).value;
  assert.equal(Number(reservedSummary.balance), 0);
  await assert.rejects(one('select public.request_payout(10)'), /open payout already exists/);
  await db.exec('reset role');
  await claims(admin);
  console.log('✓ creator dashboard and payouts use an atomic available balance');

  // Staff permissions: a module grant is enough for that module's RPCs and
  // table writes, while everything else stays closed. 'admin.full' implies all.
  await claims(admin);
  await db.exec(`grant select,insert,update,delete on public.product_categories to authenticated;
    grant select,insert,update,delete on public.filament_finishes to authenticated;`);
  await assert.rejects(one('select public.admin_set_user_permissions($1,$2)',
    [buyer, ['products.manage', 'not.real']]), /Unknown permission/);
  await one('select public.admin_set_user_permissions($1,$2)', [buyer, ['products.manage']]);
  await claims(buyer);
  await db.exec('set role authenticated');
  assert.equal((await one("select public.has_permission('products.manage') as allowed")).allowed, true);
  assert.equal((await one("select public.has_permission('coupons.manage') as allowed")).allowed, false);
  assert.equal((await one('select public.is_admin() as allowed')).allowed, false);
  const ownedCategory = await one(`insert into public.product_categories(slug,name,sort_order)
    values('desk-gadget','{"en":"Desk gadget"}'::jsonb,55) returning slug`);
  assert.equal(ownedCategory.slug, 'desk-gadget');
  await assert.rejects(rows("delete from public.product_categories where slug='other'"),
    /cannot be deleted/);
  await assert.rejects(rows('select public.admin_generate_coupons(2,NULL,\'fixed\',5)'),
    /Not permitted to manage coupons/);
  await assert.rejects(rows('select public.admin_set_user_permissions($1,$2)', [buyer, ['admin.full']]),
    /Not permitted to change permissions/);
  const permProduct = await saveProduct(exampleProduct({ slug: 'db-smoke-perm', name: { en: 'Perm product' } }), materials);
  assert.equal(permProduct.status, 'published');
  await db.exec('reset role');
  await claims(admin);
  await one('select public.admin_set_user_permissions($1,$2)', [buyer, ['admin.full']]);
  await claims(buyer);
  assert.equal((await one('select public.is_admin() as allowed')).allowed, true);
  assert.equal((await one("select public.has_permission('jobs.manage') as allowed")).allowed, true);
  await claims(admin);
  await one('select public.admin_set_user_permissions($1,$2::text[])', [buyer, []]);
  console.log('✓ module permissions grant only their own area and admin.full grants all');

  // Finishes describe how a filament looks, not just its colour.
  await rows(`update public.filaments set finish='wood', color_hex_2='#8b5a2b' where id=$1`, [newFilament]);
  const finished = await rows('select finish,finish_name,color_hex_2 from public.available_filaments($1,$2)',
    [newLocation, newMaterial]);
  assert.equal(finished[0].finish, 'wood');
  assert.equal(finished[0].finish_name.en, 'Wood fill');
  assert.equal(finished[0].color_hex_2, '#8b5a2b');
  await assert.rejects(rows(`update public.filaments set finish='unobtanium' where id=$1`, [newFilament]),
    /filaments_finish_fkey/);
  console.log('✓ filaments carry a finish and optional second colour');

  // Membership tiers: lifetime points multiply the base earn rate, and the
  // lifetime total is never reduced by redemptions.
  await rows(`update public.profiles set lifetime_points=0, points_balance=0 where id=$1`, [buyer]);
  const tierOrder = async (label, total) => {
    await rows(`insert into public.orders(order_number,user_id,location_id,contact_email,subtotal,total_amount)
      values($1,$2,$3,'db-buyer@example.test',$4,$4)`, [label, buyer, location, total]);
  };
  await tierOrder('TIER-BASE', 10);
  let tierProfile = await one('select points_balance,lifetime_points from public.profiles where id=$1', [buyer]);
  assert.equal(tierProfile.points_balance, 10);       // 1x at 0 lifetime points
  assert.equal(tierProfile.lifetime_points, 10);
  await rows(`update public.profiles set lifetime_points=1000 where id=$1`, [buyer]);
  await tierOrder('TIER-SILVER', 10);
  tierProfile = await one('select points_balance,lifetime_points from public.profiles where id=$1', [buyer]);
  assert.equal(tierProfile.points_balance, 30);       // +20 at 2x
  assert.equal(tierProfile.lifetime_points, 1020);
  await rows(`update public.profiles set lifetime_points=5000 where id=$1`, [buyer]);
  await tierOrder('TIER-GOLD', 10);
  tierProfile = await one('select points_balance,lifetime_points from public.profiles where id=$1', [buyer]);
  assert.equal(tierProfile.points_balance, 60);       // +30 at 3x
  assert.equal(tierProfile.lifetime_points, 5030);
  assert.equal((await one(`select memo from public.reward_transactions
    where order_id=(select id from public.orders where order_number='TIER-GOLD')`)).memo, 'Order TIER-GOLD (3× tier)');
  await rows(`update public.profiles set lifetime_points=20000 where id=$1`, [buyer]);
  await tierOrder('TIER-PLATINUM', 10);
  tierProfile = await one('select points_balance,lifetime_points from public.profiles where id=$1', [buyer]);
  assert.equal(tierProfile.points_balance, 100);      // +40 at Platinum 4x
  assert.equal(tierProfile.lifetime_points, 20040);
  await rows(`update public.platform_settings set value=$1::jsonb where key='rewards.tiers'`,
    [JSON.stringify([{ name: 'Member', min_lifetime_points: 0, multiplier: 1 }])]);
  // Deleting rows cannot delete fixed tiers or move their thresholds.
  assert.equal(Number((await one('select public.reward_multiplier(999999) as m')).m), 4);
  console.log('✓ fixed membership tiers include Platinum at 20k / 4x');

  await rows(`insert into public.coupons(code,source,discount_type,discount_value,grant_points)
    values('SMOKEPOINTS','admin','fixed',0,75)`);
  const pointsCoupon = cart([{ kind: 'premade', product_id: saleProduct.id, material_id: pla, quantity: 1, options: {} }], { coupon_code: 'SMOKEPOINTS' });
  assert.equal((await pricing(pointsCoupon)).coupon.grant_points, 75);
  await assert.rejects(pricing({ ...pointsCoupon, user_id: null }), /Sign in to use this points coupon/);
  await rows(`insert into public.checkout_sessions(session_id,cart,user_id,location_id,contact_email,contact_name,locale)
      values('smoke-points',$1::jsonb,$2,$3,'db-buyer@example.test','Buyer','en')`,
    [JSON.stringify(pointsCoupon), buyer, location]);
  const pointsOrder = await one('select id from public.create_order_from_cart($1,$2,$3,$4,$5,$6)',
    ['smoke-points', buyer, location, 'db-buyer@example.test', 'Buyer', 'en']);
  assert.equal((await one('select points_balance from public.profiles where id=$1', [buyer])).points_balance, 279);
  assert.equal((await one('select lifetime_points from public.profiles where id=$1', [buyer])).lifetime_points, 20219);
  assert.equal((await one("select points from public.reward_transactions where order_id=$1 and type='grant'", [pointsOrder.id])).points, 75);
  assert.equal((await one("select status from public.coupons where code='SMOKEPOINTS'")).status, 'used');
  console.log('✓ points-only coupons require an account and award points once at checkout');

  await rows(`insert into public.product_categories(slug,name) values
    ('smoke-category','{"en":"Smoke category"}'::jsonb),
    ('smoke-subcategory','{"en":"Smoke subcategory"}'::jsonb)`);
  await rows("update public.product_categories set parent_id='smoke-category' where slug='smoke-subcategory'");
  assert.equal((await one("select parent_id from public.product_categories where slug='smoke-subcategory'")).parent_id, 'smoke-category');
  await assert.rejects(rows("update public.product_categories set parent_id='smoke-subcategory' where slug='smoke-category'"), /Category hierarchy would form a cycle/);
  assert.ok((await one("select count(*) as n from public.product_option_types where slug in ('size','color')")).n >= 2);
  console.log('✓ subcategories reject hierarchy cycles and common option types are seeded');

  // Postgres grants EXECUTE on every new function to PUBLIC. A migration that
  // forgets `revoke all ... from public` hands staff-only logic to anonymous
  // visitors, and nothing in the frontend build can see that. This allowlist is
  // the full anon surface: storefront RPCs plus the helpers RLS policies call.
  const anonAllowlist = [
    'available_filaments(p_location_id uuid, p_material_id uuid)', // catalog colour picker
    'effective_price(p_regular numeric, p_sale numeric, p_starts timestamp with time zone, p_ends timestamp with time zone, p_now timestamp with time zone)', // pure arithmetic, used by price_cart
    'feature_enabled(p_key text)',                                 // read inside RLS policies
    'get_setting(p_key text)',                                     // public site settings
    'has_permission(p_key text)',                                  // RLS policies
    'is_admin()',                                                  // RLS policies
    'is_staff()',                                                  // RLS policies
    'is_staff_at(loc uuid)',                                       // RLS policies
    'my_location()',                                               // RLS policies
    'no_sales_tax_countries()',                                    // pure helper for sales_tax_rate
    'permission_keys()',                                           // pure list of permission keys
    'price_cart(p_cart jsonb)',                                    // anonymous cart pricing
    'reward_multiplier(p_lifetime_points integer)',                // pure arithmetic
    'sale_is_active(p_sale numeric, p_starts timestamp with time zone, p_ends timestamp with time zone, p_now timestamp with time zone)', // pure arithmetic
    'sale_window_open(p_starts timestamp with time zone, p_ends timestamp with time zone, p_now timestamp with time zone)', // pure arithmetic
    'sales_tax_rate(p_country text, p_tax_rate numeric)',          // pure arithmetic
  ];
  const anonExecutable = (await rows(`
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      -- extension-owned helpers (pg_trgm's set_limit) are not ours to revoke
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1`)).map((row) => row.signature);
  assert.deepEqual(anonExecutable, anonAllowlist,
    'anon function access changed: revoke the new function, or add it here with a reason');
  console.log('✓ anon can only reach the documented storefront and RLS helpers');

  // RLS is enabled table by table; a new table without it is world-readable
  // through the anon key, which is all a browser needs.
  const missingRls = await rows(`select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by 1`);
  assert.deepEqual(missingRls.map((row) => row.relname), [],
    'enable row level security on every new public table');
  console.log('✓ every public table has row level security enabled');

  const unsafeDefiner = await rows(`select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                      where c like 'search_path=%')
    order by 1`);
  assert.deepEqual(unsafeDefiner.map((row) => row.proname), [],
    'a security definer function must pin search_path or it can be hijacked with a shadow schema');
  console.log('✓ security definer functions all pin search_path');

  const volat = await rows(`select p.proname, p.provolatile from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in ('is_admin','is_staff','is_staff_at','my_location','has_permission','feature_enabled','auth_role')
    order by 1`);
  // A VOLATILE helper in an RLS policy is re-evaluated for every candidate row.
  assert.deepEqual(volat.filter((row) => row.provolatile !== 's').map((row) => row.proname), [],
    'helpers used by RLS policies must be declared STABLE');
  console.log('✓ RLS helpers are stable');

  const noPolicies = await rows(`select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid=c.oid) order by 1`);
  // These three hold checkout state, throttle counters and raw Stripe events and
  // are reachable only through the service role. A table listed here that gains
  // a policy, or a new policy-less table, should be a deliberate decision.
  assert.deepEqual(noPolicies.map((row) => row.relname),
    ['checkout_sessions', 'request_throttle', 'stripe_events'],
    'service-only tables must stay policy-less; give customer-facing tables a policy');
  console.log('✓ only checkout, throttle and Stripe event tables are service-role only');



  // Hot paths must not degrade into sequential scans as orders and the catalog
  // grow: the account page filters on user_id, the product page joins option
  // groups and choices, and admin search runs `ilike '%term%'`.
  const hotIndexes = [
    'orders_user_created_idx',
    'product_option_groups_product_idx',
    'product_option_choices_group_idx',
    'orders_order_number_trgm_idx',
    'orders_contact_email_trgm_idx',
    'profiles_email_trgm_idx',
    'order_item_option_values_file_path_idx',
    'ticket_attachments_file_path_idx',
    'order_items_document_path_idx',
  ];
  const presentIndexes = new Set((await rows(
    "select indexname from pg_indexes where schemaname = 'public'")).map((row) => row.indexname));
  assert.deepEqual(hotIndexes.filter((name) => !presentIndexes.has(name)), [],
    'add the missing index in a migration');
  console.log('✓ hot-path indexes are present');

  // Abandoned checkouts and Stripe payloads are never read again, so the webhook
  // prunes them. Only rows past the window may go, and only the service role may
  // call the prune.
  await rows(`insert into public.checkout_sessions(session_id,cart,contact_email,created_at)
    values('old-session','{}'::jsonb,'old@example.test', now() - interval '40 days'),
          ('new-session','{}'::jsonb,'new@example.test', now())`);
  await rows(`insert into public.stripe_events(id,payload,received_at)
    values('evt_old','{}'::jsonb, now() - interval '120 days'), ('evt_new','{}'::jsonb, now())`);
  await db.exec('set role service_role');
  await one('select public.prune_operational_tables()');
  await db.exec('reset role');
  const remainingSessions = (await rows('select session_id from public.checkout_sessions'))
    .map((row) => row.session_id);
  assert.equal(remainingSessions.includes('old-session'), false,
    'the prune must drop abandoned checkouts past the window');
  assert.equal(remainingSessions.includes('new-session'), true,
    'the prune must keep checkout sessions inside the retention window');
  const remainingEvents = (await rows('select id from public.stripe_events')).map((row) => row.id);
  assert.equal(remainingEvents.includes('evt_old'), false,
    'the prune must drop Stripe payloads past the window');
  assert.equal(remainingEvents.includes('evt_new'), true,
    'the prune must keep recent Stripe events for idempotency');
  await claims(buyer);
  await db.exec('set role authenticated');
  await assert.rejects(one('select public.prune_operational_tables()'), /permission denied/);
  await db.exec('reset role');
  console.log('✓ checkout sessions and Stripe payloads are pruned past their window');

  // Uploads could be created but never removed, so abandoned files stayed in the
  // bucket forever. The owner can clean up their own folder; a reference from an
  // order or ticket keeps the file, and another account's folder is untouchable.
  await rows(`insert into storage.objects(id,bucket_id,name,metadata)
    values('99999999-0000-0000-0000-000000000001','option-uploads',$1,'{"size":10}'::jsonb),
          ('99999999-0000-0000-0000-000000000002','option-uploads',$2,'{"size":10}'::jsonb),
          ('99999999-0000-0000-0000-000000000003','option-uploads',$3,'{"size":10}'::jsonb)`,
  [`${buyer}/abandoned.stl`, `${admin}/someone-else.stl`, `${buyer}/purchased.stl`]);
  await rows(`insert into public.order_item_option_values(order_item_id,option_group_id,file_path)
    select (select id from public.order_items limit 1), null, $1`, [`${buyer}/purchased.stl`]);
  await claims(buyer);
  await db.exec('set role authenticated');
  assert.equal((await db.query(
    "delete from storage.objects where id = '99999999-0000-0000-0000-000000000001'")).affectedRows, 1,
  'a customer must be able to remove their own abandoned upload');
  assert.equal((await db.query(
    "delete from storage.objects where id = '99999999-0000-0000-0000-000000000002'")).affectedRows, 0,
  "a customer must not delete another account's upload");
  assert.equal((await db.query(
    "delete from storage.objects where id = '99999999-0000-0000-0000-000000000003'")).affectedRows, 0,
  'an upload that an order still references must be kept');
  await db.exec('reset role');
  console.log('✓ uploads can be cleaned up by their owner only');

  // `get_setting` is anon-executable: it must not become a read-anything door
  // into platform_settings.
  await db.exec(`insert into public.platform_settings(key,value)
    values ('platform.commission_percent','15'::jsonb),('rewards.points_per_dollar','1'::jsonb)
    on conflict (key) do nothing`);
  await db.exec('set role anon');
  assert.equal((await one(`select public.get_setting('platform.commission_percent') as value`)).value, null,
    'get_setting must hide internal settings from anonymous visitors');
  assert.notEqual((await one(`select public.get_setting('rewards.points_per_dollar') as value`)).value, null,
    'get_setting must keep serving storefront settings');
  await db.exec('reset role');

  // Column grants, not RLS, stop a customer from promoting themselves.
  await claims(buyer);
  await db.exec('set role authenticated');
  await assert.rejects(
    rows(`update public.profiles set role = 'admin' where id = $1`, [buyer]),
    /permission denied/,
    'customers must not be able to grant themselves a role');
  await rows(`update public.profiles set delivery_address = $2::jsonb where id = $1`,
    [buyer, JSON.stringify({ line1: '1 Test Road', district: 'Central', region: 'HK' })]);
  await db.exec('reset role');
  console.log('✓ customers can edit their address but not their role');

  // The public document converter relies on this throttle.
  const throttled = [
    (await one(`select public.consume_throttle('document-convert','ip-1',2,3600) as ok`)).ok,
    (await one(`select public.consume_throttle('document-convert','ip-1',2,3600) as ok`)).ok,
    (await one(`select public.consume_throttle('document-convert','ip-1',2,3600) as ok`)).ok,
    (await one(`select public.consume_throttle('document-convert','ip-2',2,3600) as ok`)).ok,
  ];
  assert.deepEqual(throttled, [true, true, false, true],
    'consume_throttle should allow the limit per key and not leak across keys');
  console.log('✓ request throttle counts per key and window');

  // `supabase db reset` runs seed.sql only after migrations. It is deliberately
  // separate from the production migrations and safe to re-run locally.
  const localSeed = await readFile(join(ROOT, 'supabase/seed.sql'), 'utf8');
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
