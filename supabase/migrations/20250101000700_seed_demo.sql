-- Demo products: 6 products (2 community). Requires a demo admin user to exist as submitted_by.
-- We use predictable UUIDs and insert creators via auth.users if we can, but because migrations run
-- as postgres and not through auth.admin, we only create the product rows (creator can be null for non-community).
-- Two community products will be linked to a creator profile after the demo users seed.

insert into public.premade_products
(id, slug, name, description, base_price, default_material_id, category, tags, image_urls,
 source_model_path, is_featured, status)
values
('33333333-3333-3333-3333-000000000001','desk-cable-holder',
 '{"en":"Desk Cable Holder","zh-Hant":"桌面理線器","zh-Hans":"桌面理线器"}'::jsonb,
 '{"en":"Keep your cables tidy. Clips onto any desk up to 40 mm.","zh-Hant":"收納桌面線材，可夾 40 公厘以內桌面。","zh-Hans":"收纳桌面线材，可夹 40 毫米以内桌面。"}'::jsonb,
 6.00, '11111111-1111-1111-1111-000000000001', 'gadget', '{cable,organizer}'::text[],
 '[]'::jsonb, 'product-files/desk-cable-holder.stl', true, 'published'),
('33333333-3333-3333-3333-000000000002','phone-stand',
 '{"en":"Folding Phone Stand","zh-Hant":"折疊手機架","zh-Hans":"折叠手机架"}'::jsonb,
 '{"en":"Compact foldable stand that fits in your pocket.","zh-Hant":"輕巧可折，放進口袋。","zh-Hans":"轻巧可折，放进口袋。"}'::jsonb,
 8.00, '11111111-1111-1111-1111-000000000002', 'gadget', '{phone,stand}'::text[],
 '[]'::jsonb, 'product-files/phone-stand.stl', true, 'published'),
('33333333-3333-3333-3333-000000000003','mini-planter',
 '{"en":"Mini Geometric Planter","zh-Hant":"幾何小花盆","zh-Hans":"几何小花盆"}'::jsonb,
 '{"en":"A stylish faceted planter for small succulents.","zh-Hans":"時尚多面造型，適合小型多肉。","zh-Hant":"时尚多面造型，适合小型多肉。"}'::jsonb,
 12.00, '11111111-1111-1111-1111-000000000001', 'art', '{planter,home}'::text[],
 '[]'::jsonb, 'product-files/mini-planter.stl', false, 'published'),
('33333333-3333-3333-3333-000000000004','bench-dog',
 '{"en":"Workbench Dog","zh-Hant":"工作台擋塊","zh-Hans":"工作台挡块"}'::jsonb,
 '{"en":"A 20 mm bench dog for your MFT-style workbench.","zh-Hant":"適用 20 公厘孔位 MFT 工作台。","zh-Hans":"适用 20 毫米孔位 MFT 工作台。"}'::jsonb,
 4.00, '11111111-1111-1111-1111-000000000003', 'tool', '{workbench,woodworking}'::text[],
 '[]'::jsonb, 'product-files/bench-dog.stl', false, 'published'),
('33333333-3333-3333-3333-000000000005','flexi-cat',
 '{"en":"Articulated Flexi Cat","zh-Hant":"可動關節貓","zh-Hans":"可动关节猫"}'::jsonb,
 '{"en":"A cute articulated cat fidget toy.","zh-Hant":"可愛可動貓咪紓壓小物。","zh-Hans":"可爱可动猫咪舒压小物。"}'::jsonb,
 9.00, '11111111-1111-1111-1111-000000000004', 'toy', '{fidget,cat}'::text[],
 '[]'::jsonb, 'product-files/flexi-cat.stl', true, 'published'),
('33333333-3333-3333-3333-000000000006','replacement-knob',
 '{"en":"Replacement Stove Knob","zh-Hant":"爐具替換旋鈕","zh-Hans":"炉具替换旋钮"}'::jsonb,
 '{"en":"Universal fit replacement knob for common stoves.","zh-Hant":"通用規格，適用多數爐具。","zh-Hans":"通用规格，适用多数炉具。"}'::jsonb,
 7.00, '11111111-1111-1111-1111-000000000003', 'replacement_part', '{replacement,stove}'::text[],
 '[]'::jsonb, 'product-files/replacement-knob.stl', false, 'published')
on conflict (id) do nothing;

-- Allow PLA and PETG on most products, ABS on tool/replacement parts, TPU on flexi-cat
insert into public.product_materials(product_id, material_id, price_modifier) values
 ('33333333-3333-3333-3333-000000000001','11111111-1111-1111-1111-000000000001',0),
 ('33333333-3333-3333-3333-000000000001','11111111-1111-1111-1111-000000000002',2.00),
 ('33333333-3333-3333-3333-000000000002','11111111-1111-1111-1111-000000000001',0),
 ('33333333-3333-3333-3333-000000000002','11111111-1111-1111-1111-000000000002',2.00),
 ('33333333-3333-3333-3333-000000000003','11111111-1111-1111-1111-000000000001',0),
 ('33333333-3333-3333-3333-000000000003','11111111-1111-1111-1111-000000000002',3.00),
 ('33333333-3333-3333-3333-000000000004','11111111-1111-1111-1111-000000000003',0),
 ('33333333-3333-3333-3333-000000000005','11111111-1111-1111-1111-000000000004',0),
 ('33333333-3333-3333-3333-000000000006','11111111-1111-1111-1111-000000000003',0),
 ('33333333-3333-3333-3333-000000000006','11111111-1111-1111-1111-000000000002',1.00)
on conflict do nothing;

-- Sample option group on the planter: size select_one
insert into public.product_option_groups
(id, product_id, label, option_type, required, sort_order)
values
('44444444-4444-4444-4444-000000000001','33333333-3333-3333-3333-000000000003',
 '{"en":"Size","zh-Hant":"尺寸","zh-Hans":"尺寸"}'::jsonb, 'select_one', true, 0)
on conflict (id) do nothing;

insert into public.product_option_choices(id, group_id, label, price_modifier, sort_order) values
('55555555-5555-5555-5555-000000000001','44444444-4444-4444-4444-000000000001',
 '{"en":"Small (6 cm)","zh-Hant":"小（6 公分）","zh-Hans":"小（6 公分）"}'::jsonb, 0, 0),
('55555555-5555-5555-5555-000000000002','44444444-4444-4444-4444-000000000001',
 '{"en":"Large (10 cm)","zh-Hant":"大（10 公分）","zh-Hans":"大（10 公分）"}'::jsonb, 5.00, 1)
on conflict (id) do nothing;

-- Text engraving option on phone stand
insert into public.product_option_groups
(id, product_id, label, option_type, required, sort_order)
values
('44444444-4444-4444-4444-000000000002','33333333-3333-3333-3333-000000000002',
 '{"en":"Engraving","zh-Hant":"雷射刻字","zh-Hans":"激光刻字"}'::jsonb, 'text', false, 10)
on conflict (id) do nothing;

insert into public.text_option_config(group_id, max_length, price_modifier)
values ('44444444-4444-4444-4444-000000000002', 30, 3.00)
on conflict (group_id) do nothing;

-- Storage buckets (created via dashboard usually; for local dev we create them in migrations)
insert into storage.buckets(id, name, public) values
 ('product-images','product-images',true),
 ('product-files','product-files',false),
 ('models','models',false),
 ('option-uploads','option-uploads',false),
 ('submission-assets','submission-assets',false)
on conflict (id) do nothing;

-- Storage RLS policies
-- product-images: public read, admin write
drop policy if exists "product-images read" on storage.objects;
drop policy if exists "product-images admin write" on storage.objects;
create policy "product-images public read" on storage.objects
  for select using (bucket_id = 'product-images');
create policy "admin write buckets" on storage.objects
  for all using (public.is_admin()) with check (public.is_admin());

-- product-files/models/option-uploads/submission-assets: only via signed URLs from sign-file Edge Function.
-- Allow owner write on models, submission-assets, option-uploads.
create policy "owner write models" on storage.objects
  for insert with check (bucket_id = 'models' and (auth.uid()::text) = (storage.foldername(name))[1]);
create policy "owner read own models" on storage.objects
  for select using (bucket_id = 'models' and (auth.uid()::text) = (storage.foldername(name))[1]);
create policy "owner write submissions" on storage.objects
  for insert with check (bucket_id = 'submission-assets' and (auth.uid()::text) = (storage.foldername(name))[1]);
create policy "owner read own submissions" on storage.objects
  for select using (bucket_id = 'submission-assets' and (auth.uid()::text) = (storage.foldername(name))[1]);
create policy "owner write option uploads" on storage.objects
  for insert with check (bucket_id = 'option-uploads' and (auth.uid()::text) = (storage.foldername(name))[1]);
