-- Retire product 3D-model storage. Product images and customer ticket attachments remain separate.
alter table public.premade_products alter column source_model_path drop not null;
update public.premade_products set source_model_path = null where source_model_path is not null;

create or replace function public.admin_save_product(p_product jsonb, p_materials jsonb, p_slots jsonb default '[]'::jsonb)
returns public.premade_products language plpgsql security definer set search_path = public as $$
declare
  v_product public.premade_products;
  v_material jsonb;
  v_slot jsonb;
  v_slot_material jsonb;
  v_slot_row public.product_material_slots;
  v_default uuid := nullif(p_product->>'default_material_id', '')::uuid;
  v_slot_default uuid;
  v_slot_filament uuid;
  v_status text := p_product->>'status';
  v_base numeric := (p_product->>'base_price')::numeric;
  v_sale numeric := nullif(p_product->>'sale_price', '')::numeric;
  v_sale_starts timestamptz := nullif(p_product->>'sale_starts_at', '')::timestamptz;
  v_sale_ends timestamptz := nullif(p_product->>'sale_ends_at', '')::timestamptz;
  v_linked uuid;
  v_idx int;
  v_ord int;
  v_target_prod uuid;
  v_new_id uuid;
  v_slot_ids uuid[] := '{}'::uuid[];
begin
  if not public.has_permission('products.manage') then raise exception 'Not permitted to manage products'; end if;
  if jsonb_typeof(p_product) is distinct from 'object'
     or jsonb_typeof(p_materials) is distinct from 'array'
     or jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Invalid product payload';
  end if;
  if nullif(btrim(p_product->'name'->>'en'), '') is null then
    raise exception 'Product English name is required';
  end if;
  if nullif(p_product->>'id', '') is not null and nullif(btrim(p_product->>'slug'), '') is null then
    raise exception 'Product slug is required';
  end if;
  if v_status not in ('draft','published','archived') then raise exception 'Invalid product status'; end if;

  -- A sale price has to actually be a discount, inside a window that makes sense.
  if v_sale is not null and v_sale >= v_base then
    raise exception 'Sale price must be lower than the regular price';
  end if;
  if v_sale_starts is not null and v_sale_ends is not null and v_sale_ends <= v_sale_starts then
    raise exception 'Sale must end after it starts';
  end if;

  -- Material slots are validated before anything is written.
  for v_slot in select value from jsonb_array_elements(p_slots) loop
    if nullif(btrim(v_slot->'name'->>'en'), '') is null then
      raise exception 'Every material slot needs an English name';
    end if;
    if jsonb_typeof(v_slot->'materials') is distinct from 'array'
       or jsonb_array_length(v_slot->'materials') = 0 then
      raise exception 'Every material slot needs at least one eligible material';
    end if;
    v_slot_default := nullif(v_slot->>'default_material_id', '')::uuid;
    v_slot_filament := nullif(v_slot->>'default_filament_id', '')::uuid;
    if v_slot_default is null then
      raise exception 'Every material slot needs a default material';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_slot->'materials') m
       where (m->>'material_id')::uuid = v_slot_default
    ) then
      raise exception 'Default material must be eligible for the slot';
    end if;
    if v_status = 'published' and not exists (
      select 1 from public.materials where id = v_slot_default and is_active = true
    ) then
      raise exception 'Published slots need an active default material';
    end if;
    for v_slot_material in select value from jsonb_array_elements(v_slot->'materials') loop
      if not exists (select 1 from public.materials
                     where id = (v_slot_material->>'material_id')::uuid
                       and (v_status <> 'published' or is_active = true)) then
        raise exception 'Invalid or inactive material';
      end if;
      if coalesce((v_slot_material->>'price_modifier')::numeric, 0) not between -99999999 and 99999999 then
        raise exception 'Invalid material price modifier';
      end if;
    end loop;
    if v_slot_filament is not null and not exists (
      select 1 from public.filaments f
       where f.id = v_slot_filament and f.material_id = v_slot_default
    ) then
      raise exception 'Default color must be a color of the default material';
    end if;
  end loop;

  -- A product without slots still needs its product-level default material;
  -- with slots, the slot defaults above are what the print is made of.
  if jsonb_array_length(p_slots) = 0 then
    if v_default is not null and not exists (
      select 1 from jsonb_array_elements(p_materials) m where (m->>'material_id')::uuid = v_default
    ) then raise exception 'Default material must be allowed'; end if;
    if v_status = 'published' and (
      jsonb_array_length(p_materials) = 0 or v_default is null or not exists (
        select 1 from public.materials where id = v_default and is_active = true
      )
    ) then raise exception 'Published products need an active default material'; end if;
  end if;

  for v_material in select value from jsonb_array_elements(p_materials) loop
    if not exists (select 1 from public.materials
                   where id = (v_material->>'material_id')::uuid
                     and (v_status <> 'published' or is_active = true)) then
      raise exception 'Invalid or inactive material';
    end if;
    if (v_material->>'price_modifier')::numeric not between -99999999 and 99999999 then
      raise exception 'Invalid material price modifier';
    end if;
  end loop;

  if nullif(p_product->>'id', '') is not null then
    update public.premade_products set
      slug = p_product->>'slug', name = p_product->'name',
      description = p_product->'description', base_price = v_base,
      default_material_id = v_default, category = p_product->>'category',
      tags = array(select jsonb_array_elements_text(p_product->'tags')),
      image_urls = p_product->'image_urls', source_model_path = null,
      is_featured = (p_product->>'is_featured')::boolean, status = v_status,
      sale_price = v_sale, sale_starts_at = v_sale_starts, sale_ends_at = v_sale_ends
    where id = (p_product->>'id')::uuid returning * into v_product;
    if not found then raise exception 'Product not found'; end if;
  else
    v_new_id := gen_random_uuid();
    insert into public.premade_products(
      id, slug, name, description, base_price, default_material_id, category, tags,
      image_urls, source_model_path, is_featured, status,
      sale_price, sale_starts_at, sale_ends_at
    ) values (
      v_new_id, v_new_id::text, p_product->'name', p_product->'description',
      v_base, v_default, p_product->>'category',
      array(select jsonb_array_elements_text(p_product->'tags')),
      p_product->'image_urls', null,
      (p_product->>'is_featured')::boolean, v_status,
      v_sale, v_sale_starts, v_sale_ends
    ) returning * into v_product;
  end if;

  delete from public.product_materials where product_id = v_product.id;
  insert into public.product_materials(product_id, material_id, price_modifier)
    select v_product.id, (m->>'material_id')::uuid, (m->>'price_modifier')::numeric
      from jsonb_array_elements(p_materials) m;

  -- Slots are replaced wholesale; their eligible materials cascade away with them.
  delete from public.product_material_slots where product_id = v_product.id;
  for v_ord in 1..jsonb_array_length(p_slots) loop
    v_slot := p_slots -> (v_ord - 1);
    insert into public.product_material_slots(product_id, name, sort_order)
    values (v_product.id, v_slot->'name', coalesce((v_slot->>'sort_order')::smallint, v_ord))
    returning * into v_slot_row;
    v_slot_ids := array_append(v_slot_ids, v_slot_row.id);

    insert into public.product_slot_materials(slot_id, material_id, price_modifier)
      select v_slot_row.id, (m->>'material_id')::uuid, coalesce((m->>'price_modifier')::numeric, 0)
        from jsonb_array_elements(v_slot->'materials') m;

    -- Defaults are set last so the eligibility trigger always sees a full list.
    update public.product_material_slots
       set default_material_id = nullif(v_slot->>'default_material_id', '')::uuid,
           default_filament_id = nullif(v_slot->>'default_filament_id', '')::uuid
     where id = v_slot_row.id;
  end loop;

  -- A linked slot references another slot's shared material/colour choice.
  -- The payload refers to that slot by its one-based position in this save.
  for v_ord in 1..jsonb_array_length(p_slots) loop
    v_slot := p_slots -> (v_ord - 1);
    v_idx := nullif(v_slot->>'linked_ordinal', '')::int;
    if v_idx is not null then
      if v_idx < 1 or v_idx > array_length(v_slot_ids, 1) or v_idx = v_ord then
        raise exception 'Invalid linked material slot';
      end if;
      v_linked := v_slot_ids[v_idx];
      select id into v_slot_row from public.product_material_slots where id = v_slot_ids[v_ord];
      select product_id into v_target_prod from public.product_material_slots where id = v_linked;
      if not found or v_target_prod is distinct from v_product.id then
        raise exception 'Linked slot must belong to the same product';
      end if;
      if nullif((p_slots -> (v_idx - 1))->>'linked_ordinal','') is not null then
        raise exception 'Linked slot must point to an unlinked slot';
      end if;
      -- Temporarily clear defaults so the eligibility trigger permits replacing
      -- this part's materials with the source part's material list.
      update public.product_material_slots
         set default_material_id = null, default_filament_id = null
       where id = v_slot_row.id;
      delete from public.product_slot_materials where slot_id = v_slot_row.id;
      insert into public.product_slot_materials(slot_id, material_id, price_modifier)
        select v_slot_row.id, material_id, price_modifier
          from public.product_slot_materials where slot_id = v_linked;
      update public.product_material_slots
         set linked_slot_id = v_linked,
             default_material_id = (select default_material_id from public.product_material_slots where id = v_linked),
             default_filament_id = (select default_filament_id from public.product_material_slots where id = v_linked)
       where id = v_slot_row.id;
    end if;
  end loop;

  return v_product;
end;
$$;

-- The old product and custom-model buckets are no longer used by the storefront.
-- Deleting the buckets also removes their stored objects; ticket-uploads is untouched.
--
-- storage-api 1.x installs `storage.protect_delete`, which rejects this purge
-- unless the session opts in ("Direct deletion from storage tables is not
-- allowed"). Setting the flag is the documented escape hatch, and it is scoped
-- to this transaction so nothing else inherits it. This is the only change ever
-- made to an applied migration in this repo: without it the migration cannot be
-- applied at all on a current storage image, which leaves `supabase db start`
-- (and therefore the CI `db` job) permanently red.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id in ('product-files', 'models', 'submission-assets');
delete from storage.buckets where id in ('product-files', 'models', 'submission-assets');
select set_config('storage.allow_delete_query', 'false', true);

drop policy if exists "owner write models" on storage.objects;
drop policy if exists "owner read own models" on storage.objects;
drop policy if exists "owner write submissions" on storage.objects;
drop policy if exists "owner read own submissions" on storage.objects;

-- Permanently retire community 3D-model submissions in the application.
insert into public.platform_settings(key, value)
values ('features.model_submissions', 'false'::jsonb)
on conflict (key) do update set value = excluded.value;

-- The careers page and published job listings are no longer feature-gated.
delete from public.platform_settings where key = 'features.careers_page';
