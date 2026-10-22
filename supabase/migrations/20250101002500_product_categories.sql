-- Product categories are data, not a hard-coded enum.
--
-- Admins (and staff holding products.manage) can now add, rename, reorder,
-- deactivate and delete their own categories. Products and submissions keep
-- their existing `category` text slug column, so every existing query, filter
-- and snapshot keeps working; the slug is now a foreign key instead of a
-- CHECK list, and renaming a slug cascades to the rows that use it.
--
-- The fallback category 'other' is seeded and protected: it is the default for
-- products and submissions, so it can never be renamed or deleted.

create table public.product_categories (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' and char_length(slug) between 1 and 40),
  name jsonb not null check (name ? 'en'),
  description jsonb,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_categories_updated_at before update on public.product_categories
  for each row execute function public.tg_set_updated_at();

insert into public.product_categories(slug, name, description, sort_order) values
  ('toy', '{"en":"Toys","zh-Hant":"玩具","zh-Hans":"玩具"}'::jsonb,
    '{"en":"Figures, puzzles, and play sets","zh-Hant":"公仔、拼圖與玩具套裝","zh-Hans":"公仔、拼图与玩具套装"}'::jsonb, 10),
  ('tool', '{"en":"Tools","zh-Hant":"工具","zh-Hans":"工具"}'::jsonb,
    '{"en":"Jigs, holders, and practical prints","zh-Hant":"夾具、支架與實用零件","zh-Hans":"夹具、支架与实用零件"}'::jsonb, 20),
  ('art', '{"en":"Art & Decor","zh-Hant":"藝術與擺設","zh-Hans":"艺术与摆设"}'::jsonb,
    '{"en":"Sculptures, lamps, and home decor","zh-Hant":"雕塑、燈飾與家居擺設","zh-Hans":"雕塑、灯饰与家居摆设"}'::jsonb, 30),
  ('gadget', '{"en":"Gadgets","zh-Hant":"小玩意","zh-Hans":"小玩意"}'::jsonb,
    '{"en":"Gizmos, mounts, and desk toys","zh-Hant":"小裝置、支架與桌上玩具","zh-Hans":"小装置、支架与桌上玩具"}'::jsonb, 40),
  ('replacement_part', '{"en":"Replacement parts","zh-Hant":"替換零件","zh-Hans":"替换零件"}'::jsonb,
    '{"en":"Spare and repair parts for everyday objects","zh-Hant":"日常物品的備用與維修零件","zh-Hans":"日常物品的备用与维修零件"}'::jsonb, 50),
  ('other', '{"en":"Other","zh-Hant":"其他","zh-Hans":"其他"}'::jsonb,
    '{"en":"Anything that does not fit the other categories","zh-Hant":"不屬於其他分類的物品","zh-Hans":"不属于其他分类的物品"}'::jsonb, 999)
on conflict (slug) do nothing;

-- Existing rows used the same six slugs, so the constraint swap is safe.
alter table public.premade_products drop constraint if exists premade_products_category_check;
alter table public.model_submissions drop constraint if exists model_submissions_category_check;

alter table public.premade_products drop constraint if exists premade_products_category_fkey;
alter table public.premade_products
  add constraint premade_products_category_fkey
  foreign key (category) references public.product_categories(slug)
  on update cascade on delete restrict;

alter table public.model_submissions drop constraint if exists model_submissions_category_fkey;
alter table public.model_submissions
  add constraint model_submissions_category_fkey
  foreign key (category) references public.product_categories(slug)
  on update cascade on delete restrict;

create index if not exists premade_products_category_idx on public.premade_products(category);
create index if not exists product_categories_sort_idx on public.product_categories(is_active, sort_order);

-- The fallback category must stay put: a dash of guard rails beats a broken
-- default for every product insert.
create or replace function public.tg_protect_default_category()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.slug = 'other' then raise exception 'The "other" category cannot be deleted'; end if;
    return old;
  end if;
  if old.slug = 'other' and new.slug <> 'other' then
    raise exception 'The "other" category cannot be renamed';
  end if;
  if old.slug = 'other' and not new.is_active then
    raise exception 'The "other" category cannot be deactivated';
  end if;
  return new;
end;
$$;

drop trigger if exists product_categories_protect_default on public.product_categories;
create trigger product_categories_protect_default
  before update or delete on public.product_categories
  for each row execute function public.tg_protect_default_category();

alter table public.product_categories enable row level security;

create policy product_categories_read on public.product_categories
  for select using (is_active = true or public.is_admin() or public.has_permission('products.manage'));
create policy product_categories_manage on public.product_categories
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
