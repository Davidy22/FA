-- Keep catalog browsing/search and the paginated admin product list index-backed
-- as the catalog grows. Trigram indexes support the storefront's substring
-- search in each locale and the admin's partial slug/name search.
create index if not exists premade_products_published_feed_idx
  on public.premade_products (created_at desc, id asc)
  where status = 'published';

create index if not exists premade_products_published_category_feed_idx
  on public.premade_products (category, created_at desc, id asc)
  where status = 'published';

create index if not exists premade_products_admin_feed_idx
  on public.premade_products (created_at desc, id asc);

create index if not exists premade_products_slug_trgm_idx
  on public.premade_products using gin (slug gin_trgm_ops);

create index if not exists premade_products_name_zh_hant_trgm_idx
  on public.premade_products using gin ((name->>'zh-Hant') gin_trgm_ops);

create index if not exists premade_products_name_zh_hans_trgm_idx
  on public.premade_products using gin ((name->>'zh-Hans') gin_trgm_ops);

-- The staff consoles browse by newest across all locations. Existing indexes
-- start with a location/user/creator id and cannot serve those global feeds.
create index if not exists orders_admin_feed_idx
  on public.orders (created_at desc, id asc);
create index if not exists orders_admin_status_feed_idx
  on public.orders (status, created_at desc, id asc);
create index if not exists orders_employee_feed_idx
  on public.orders (location_id, status, created_at desc, id asc);
create index if not exists tickets_admin_feed_idx
  on public.tickets (updated_at desc, id asc);
create index if not exists tickets_admin_status_feed_idx
  on public.tickets (status, updated_at desc, id asc);
create index if not exists offer_codes_admin_feed_idx
  on public.offer_codes (created_at desc, id asc);
create index if not exists coupons_admin_feed_idx
  on public.coupons (created_at desc, id asc);
create index if not exists payouts_admin_feed_idx
  on public.payouts (created_at desc, id asc);
create index if not exists payouts_admin_status_feed_idx
  on public.payouts (status, created_at desc, id asc);

-- Remote fuzzy search for admin product selectors. Return a small, stable
-- result set instead of sending every product row to the browser.
create or replace function public.search_product_choices(
  p_query text,
  p_published_only boolean default false
)
returns table(id uuid, name jsonb, slug text, status text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.name, p.slug, p.status
  from public.premade_products p
  where public.has_permission('products.manage')
    and (not p_published_only or p.status = 'published')
    and length(trim(coalesce(p_query, ''))) between 2 and 100
    and (
      p.slug % trim(p_query)
      or coalesce(p.name->>'en', '') % trim(p_query)
      or coalesce(p.name->>'zh-Hant', '') % trim(p_query)
      or coalesce(p.name->>'zh-Hans', '') % trim(p_query)
      or p.slug ilike '%' || trim(p_query) || '%'
      or p.name->>'en' ilike '%' || trim(p_query) || '%'
      or p.name->>'zh-Hant' ilike '%' || trim(p_query) || '%'
      or p.name->>'zh-Hans' ilike '%' || trim(p_query) || '%'
    )
  order by greatest(
    similarity(p.slug, trim(p_query)),
    similarity(coalesce(p.name->>'en', ''), trim(p_query)),
    similarity(coalesce(p.name->>'zh-Hant', ''), trim(p_query)),
    similarity(coalesce(p.name->>'zh-Hans', ''), trim(p_query))
  ) desc, p.slug
  limit 50;
$$;

revoke all on function public.search_product_choices(text, boolean) from public;
grant execute on function public.search_product_choices(text, boolean) to authenticated;
