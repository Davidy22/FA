-- Filaments are more than a colour.
--
-- Every filament now also carries a finish (standard, matte, silk/shiny, wood
-- fill, marble, gradient, glow in the dark, metallic, translucent, carbon
-- fibre, ...), so a print can be described the way it actually looks. Secondary
-- colours are supported for gradient/sparkle filaments, which the storefront
-- renders as a two-stop swatch.
--
-- Finishes are a normal lookup table with products.manage write access, so an
-- admin can add a new effect ("hamster fur") without a migration.

create table public.filament_finishes (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' and char_length(slug) between 1 and 40),
  name jsonb not null check (name ? 'en'),
  description jsonb,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger filament_finishes_updated_at before update on public.filament_finishes
  for each row execute function public.tg_set_updated_at();

insert into public.filament_finishes(slug, name, description, sort_order) values
  ('standard', '{"en":"Standard","zh-Hant":"標準","zh-Hans":"标准"}'::jsonb,
    '{"en":"Plain, slightly glossy extruded plastic","zh-Hant":"普通、略帶光澤的打印表面","zh-Hans":"普通、略带光泽的打印表面"}'::jsonb, 10),
  ('matte', '{"en":"Matte","zh-Hant":"霧面","zh-Hans":"哑光"}'::jsonb,
    '{"en":"Soft, non-reflective surface","zh-Hant":"柔和不反光的表面","zh-Hans":"柔和不反光的表面"}'::jsonb, 20),
  ('silk', '{"en":"Silk / shiny","zh-Hant":"絲滑亮面","zh-Hans":"丝滑亮面"}'::jsonb,
    '{"en":"Glossy, metallic-looking sheen","zh-Hant":"如絲綢般的高光澤","zh-Hans":"如丝绸般的高光泽"}'::jsonb, 30),
  ('metallic', '{"en":"Metallic","zh-Hant":"金屬光澤","zh-Hans":"金属光泽"}'::jsonb,
    '{"en":"Sparkling metal-powder blend","zh-Hant":"含金屬粉末的閃爍效果","zh-Hans":"含金属粉末的闪烁效果"}'::jsonb, 40),
  ('wood', '{"en":"Wood fill","zh-Hant":"木紋填充","zh-Hans":"木纹填充"}'::jsonb,
    '{"en":"Real wood fibres; prints with a grain","zh-Hant":"含真實木纖維，帶木紋質感","zh-Hans":"含真实木纤维，带木纹质感"}'::jsonb, 50),
  ('marble', '{"en":"Marble","zh-Hant":"大理石紋","zh-Hans":"大理石纹"}'::jsonb,
    '{"en":"Swirled, stone-like colour","zh-Hant":"雲石般的流紋效果","zh-Hans":"云石般的流纹效果"}'::jsonb, 60),
  ('gradient', '{"en":"Gradient","zh-Hant":"漸變色","zh-Hans":"渐变色"}'::jsonb,
    '{"en":"Colour shifts along the spool","zh-Hant":"顏色沿線材漸變","zh-Hans":"颜色沿线材渐变"}'::jsonb, 70),
  ('glow', '{"en":"Glow in the dark","zh-Hant":"夜光","zh-Hans":"夜光"}'::jsonb,
    '{"en":"Charges in light, glows after dark","zh-Hant":"吸收光線後在黑暗中發光","zh-Hans":"吸收光线后在黑暗中发光"}'::jsonb, 80),
  ('translucent', '{"en":"Translucent","zh-Hant":"半透明","zh-Hans":"半透明"}'::jsonb,
    '{"en":"Light passes through; great for lamps","zh-Hant":"可透光，適合燈飾","zh-Hans":"可透光，适合灯饰"}'::jsonb, 90),
  ('carbon', '{"en":"Carbon fibre","zh-Hant":"碳纖維","zh-Hans":"碳纤维"}'::jsonb,
    '{"en":"Matte, fibre-reinforced and stiff","zh-Hant":"霧面、纖維增強、高剛性","zh-Hans":"哑光、纤维增强、高刚性"}'::jsonb, 100)
on conflict (slug) do nothing;

alter table public.filaments
  add column if not exists finish text not null default 'standard';
alter table public.filaments
  add column if not exists color_hex_2 char(7);

alter table public.filaments drop constraint if exists filaments_finish_fkey;
alter table public.filaments
  add constraint filaments_finish_fkey
  foreign key (finish) references public.filament_finishes(slug)
  on update cascade on delete restrict;

alter table public.filaments drop constraint if exists filaments_color_hex_2_check;
alter table public.filaments
  add constraint filaments_color_hex_2_check
  check (color_hex_2 is null or color_hex_2 ~ '^#[0-9a-fA-F]{6}$');

create index if not exists filaments_finish_idx on public.filaments(finish);

alter table public.filament_finishes enable row level security;

create policy filament_finishes_read on public.filament_finishes
  for select using (is_active = true or public.is_admin() or public.has_permission('products.manage'));
create policy filament_finishes_manage on public.filament_finishes
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));

-- Storefront filament picker: same as before, plus the finish details.
drop function if exists public.available_filaments(uuid, uuid);
create function public.available_filaments(p_location_id uuid, p_material_id uuid default null)
returns table (
  filament_id uuid,
  material_id uuid,
  material_slug text,
  material_name jsonb,
  material_adjective jsonb,
  color jsonb,
  color_hex char(7),
  color_hex_2 char(7),
  finish text,
  finish_name jsonb,
  cost_per_gram numeric(10,6)
)
language sql stable security definer
set search_path = public
as $$
  select f.id, m.id, m.slug, m.name, m.adjective, f.color, f.color_hex, f.color_hex_2,
         f.finish, fin.name, m.cost_per_gram
  from public.location_filaments lf
  join public.filaments f on f.id = lf.filament_id
  join public.materials m on m.id = f.material_id
  join public.filament_finishes fin on fin.slug = f.finish
  where lf.location_id = p_location_id
    and lf.in_stock = true
    and f.is_active = true
    and m.is_active = true
    and (p_material_id is null or m.id = p_material_id)
  order by m.name->>'en', fin.sort_order, f.color->>'en';
$$;

grant execute on function public.available_filaments(uuid, uuid) to anon, authenticated;
