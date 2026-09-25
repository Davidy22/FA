-- Default platform settings
insert into public.platform_settings(key, value) values
 ('platform.commission_percent', '15'::jsonb),
 ('payouts.min_amount', '50'::jsonb),
 ('quote.wall_thickness_mm', '0.84'::jsonb),
 ('quote.setup_minutes', '3'::jsonb),
 ('quote.handling_fee', '1.00'::jsonb),
 ('quote.min_order_fee', '3.00'::jsonb)
on conflict (key) do nothing;

-- 2 Locations
insert into public.locations(id, name, address, phone, timezone, hourly_machine_rate, tax_rate, currency, is_active) values
 ('00000000-0000-0000-0000-000000000001', 'Fab Taipei', '123 Main St, Taipei', '+886-2-1234-5678', 'Asia/Taipei', 8.00, 0.05, 'USD', true),
 ('00000000-0000-0000-0000-000000000002', 'Fab SF', '456 Howard St, San Francisco', '+1-415-555-0123', 'America/Los_Angeles', 12.00, 0.0875, 'USD', true)
on conflict (id) do nothing;

-- 5 Materials
insert into public.materials(id, slug, name, adjective, density_g_cm3, default_flow_mm3_s, is_active, sort_order) values
 ('11111111-1111-1111-1111-000000000001','pla',
  '{"en":"PLA","zh-Hant":"PLA","zh-Hans":"PLA"}'::jsonb,
  '{"en":"Easy and eco-friendly","zh-Hant":"環保易印","zh-Hans":"环保易印"}'::jsonb,
  1.24, 7.5, true, 10),
 ('11111111-1111-1111-1111-000000000002','petg',
  '{"en":"PETG","zh-Hant":"PETG","zh-Hans":"PETG"}'::jsonb,
  '{"en":"Tough and weather-resistant","zh-Hant":"堅韌耐候","zh-Hans":"坚韧耐候"}'::jsonb,
  1.27, 7.0, true, 20),
 ('11111111-1111-1111-1111-000000000003','abs',
  '{"en":"ABS","zh-Hant":"ABS","zh-Hans":"ABS"}'::jsonb,
  '{"en":"Heat-resistant and sturdy","zh-Hant":"耐熱耐用","zh-Hans":"耐热耐用"}'::jsonb,
  1.04, 6.0, true, 30),
 ('11111111-1111-1111-1111-000000000004','tpu',
  '{"en":"TPU","zh-Hant":"TPU","zh-Hans":"TPU"}'::jsonb,
  '{"en":"Flexible and rubber-like","zh-Hant":"柔韌有彈性","zh-Hans":"柔韧有弹性"}'::jsonb,
  1.21, 3.5, true, 40),
 ('11111111-1111-1111-1111-000000000005','resin',
  '{"en":"Resin","zh-Hant":"樹脂","zh-Hans":"树脂"}'::jsonb,
  '{"en":"Ultra-fine detail","zh-Hant":"超高細節","zh-Hans":"超高细节"}'::jsonb,
  1.10, 5.0, true, 50)
on conflict (id) do nothing;

-- 12 Filaments
insert into public.filaments(id, material_id, color, color_hex, diameter, cost_per_gram, manufacturer, is_active) values
 ('22222222-2222-2222-2222-000000000001','11111111-1111-1111-1111-000000000001',
  '{"en":"Black","zh-Hant":"黑色","zh-Hans":"黑色"}'::jsonb, '#1b1b1b', 1.75, 0.025, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000002','11111111-1111-1111-1111-000000000001',
  '{"en":"White","zh-Hant":"白色","zh-Hans":"白色"}'::jsonb, '#ffffff', 1.75, 0.025, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000003','11111111-1111-1111-1111-000000000001',
  '{"en":"Red","zh-Hant":"紅色","zh-Hans":"红色"}'::jsonb, '#d32f2f', 1.75, 0.028, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000004','11111111-1111-1111-1111-000000000002',
  '{"en":"Black","zh-Hant":"黑色","zh-Hans":"黑色"}'::jsonb, '#1b1b1b', 1.75, 0.035, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000005','11111111-1111-1111-1111-000000000002',
  '{"en":"Clear","zh-Hant":"透明","zh-Hans":"透明"}'::jsonb, '#e0f7ff', 1.75, 0.040, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000006','11111111-1111-1111-1111-000000000003',
  '{"en":"Black","zh-Hant":"黑色","zh-Hans":"黑色"}'::jsonb, '#1b1b1b', 1.75, 0.030, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000007','11111111-1111-1111-1111-000000000003',
  '{"en":"White","zh-Hant":"白色","zh-Hans":"白色"}'::jsonb, '#ffffff', 1.75, 0.030, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000008','11111111-1111-1111-1111-000000000004',
  '{"en":"Black","zh-Hant":"黑色","zh-Hans":"黑色"}'::jsonb, '#1b1b1b', 1.75, 0.045, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000009','11111111-1111-1111-1111-000000000004',
  '{"en":"Red","zh-Hant":"紅色","zh-Hans":"红色"}'::jsonb, '#d32f2f', 1.75, 0.045, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000010','11111111-1111-1111-1111-000000000005',
  '{"en":"Grey","zh-Hant":"灰色","zh-Hans":"灰色"}'::jsonb, '#888888', 1.75, 0.150, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000011','11111111-1111-1111-1111-000000000001',
  '{"en":"Blue","zh-Hant":"藍色","zh-Hans":"蓝色"}'::jsonb, '#1565c0', 1.75, 0.028, 'FabFila', true),
 ('22222222-2222-2222-2222-000000000012','11111111-1111-1111-1111-000000000002',
  '{"en":"Orange","zh-Hant":"橘色","zh-Hans":"橙色"}'::jsonb, '#fb8c00', 1.75, 0.038, 'FabFila', true)
on conflict (id) do nothing;

-- Make all filaments in stock at both locations
insert into public.location_filaments(location_id, filament_id, in_stock)
select l.id, f.id, true from public.locations l cross join public.filaments f
on conflict (location_id, filament_id) do update set in_stock = true;
