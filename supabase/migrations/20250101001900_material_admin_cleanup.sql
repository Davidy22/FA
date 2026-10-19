-- Store filament acquisition cost once per material, in HKD per gram.
-- Existing costs were USD/g; preserve the approximate HKD equivalent for each material.
alter table public.materials add column cost_per_gram numeric(10,6);
update public.materials m
set cost_per_gram = round((select avg(f.cost_per_gram) * 7.8
                           from public.filaments f where f.material_id = m.id), 6)
where exists (select 1 from public.filaments f where f.material_id = m.id);
update public.materials set cost_per_gram = 0.200000 where cost_per_gram is null;
alter table public.materials alter column cost_per_gram set default 0.200000;
alter table public.materials alter column cost_per_gram set not null;

-- Short material descriptors are single adjectives rather than marketing copy.
update public.materials set adjective = '{"en":"Standard","zh-Hant":"標準","zh-Hans":"标准"}'::jsonb where slug = 'pla';
update public.materials set adjective = '{"en":"Tough","zh-Hant":"堅韌","zh-Hans":"坚韧"}'::jsonb where slug = 'petg';
update public.materials set adjective = '{"en":"Sturdy","zh-Hant":"耐用","zh-Hans":"耐用"}'::jsonb where slug = 'abs';
update public.materials set adjective = '{"en":"Flexible","zh-Hant":"柔韌","zh-Hans":"柔韧"}'::jsonb where slug = 'tpu';
update public.materials set adjective = '{"en":"Strong","zh-Hant":"堅固","zh-Hans":"坚固"}'::jsonb where slug = 'nylon';

-- Notes are free-form text rather than a structured print-profile JSON blob.
alter table public.materials add column notes text;
update public.materials
set notes = case when print_profile is null then null
                 else coalesce(print_profile->>'notes', print_profile::text) end;
alter table public.materials drop column print_profile;

-- These fabrication parameters remain internal to the pricing engine; admin users
-- should not have to manage them. Material ordering is alphabetical in the UI.
alter table public.materials drop column sort_order;

-- Filament records now describe only a material's available color variants.
alter table public.filaments drop column cost_per_gram;
alter table public.filaments drop column manufacturer;
alter table public.filaments drop column diameter;

-- The RPC now returns material cost, so all colors of the same material share it.
drop function public.available_filaments(uuid, uuid);
create function public.available_filaments(p_location_id uuid, p_material_id uuid default null)
returns table (
  filament_id uuid,
  material_id uuid,
  material_slug text,
  material_name jsonb,
  material_adjective jsonb,
  color jsonb,
  color_hex char(7),
  cost_per_gram numeric(10,6)
)
language sql stable security definer
set search_path = public
as $$
  select f.id, m.id, m.slug, m.name, m.adjective, f.color, f.color_hex, m.cost_per_gram
  from public.location_filaments lf
  join public.filaments f on f.id = lf.filament_id
  join public.materials m on m.id = f.material_id
  where lf.location_id = p_location_id
    and lf.in_stock = true
    and f.is_active = true
    and m.is_active = true
    and (p_material_id is null or m.id = p_material_id)
  order by m.name->>'en', f.color->>'en';
$$;
grant execute on function public.available_filaments(uuid, uuid) to anon, authenticated;
