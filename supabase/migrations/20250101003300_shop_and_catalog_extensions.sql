-- Coupon codes can grant reward points when used at checkout, anonymous
-- visitors can complete purchases without an account, product categories can
-- be nested (subcategories), option groups pick their label from predefined
-- types instead of a free text box, and material slots of one print can be
-- linked so several parts are made of the same material.
--
-- Also: choices already used in orders may be deleted again; historical order
-- lines simply stop referencing the removed choice.

-- ------- customer order notes -------
alter table public.order_notes
  add column if not exists kind text not null default 'internal'
  check (kind in ('internal','customer'));

-- ------- coupon codes that grant points -------
alter table public.coupons
  add column if not exists grant_points integer check (grant_points >= 0);

-- A points-only coupon is valid too; ordinary coupons still need a discount.
alter table public.coupons drop constraint if exists coupons_discount_value_check;
alter table public.coupons add constraint coupons_discount_value_check check (discount_value >= 0);
alter table public.coupons add constraint coupons_discount_or_points_check
  check (discount_value > 0 or coalesce(grant_points, 0) > 0);

alter table public.reward_transactions
  drop constraint if exists reward_transactions_type_check;
alter table public.reward_transactions
  add constraint reward_transactions_type_check
  check (type in ('order_earn','redeem','adjustment','grant','referral_signup','referral_purchase'));

-- ------- subcategories -------
alter table public.product_categories
  add column if not exists parent_id text references public.product_categories(slug) on update cascade on delete set null;

-- A category cannot be its own ancestor: reject self-parents and cycles.
create or replace function public.tg_validate_category_hierarchy()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ancestor text;
begin
  if new.parent_id is not null then
    if new.parent_id = new.slug then
      raise exception 'A category cannot be its own parent';
    end if;
    v_ancestor := new.parent_id;
    while v_ancestor is not null loop
      if v_ancestor = new.slug then
        raise exception 'Category hierarchy would form a cycle';
      end if;
      select parent_id into v_ancestor
        from public.product_categories where slug = v_ancestor;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists product_categories_hierarchy on public.product_categories;
create trigger product_categories_hierarchy
  before insert or update of slug, parent_id on public.product_categories
  for each row execute function public.tg_validate_category_hierarchy();

create index if not exists product_categories_parent_idx
  on public.product_categories(parent_id);

-- ------- predefined option types -------
create table public.product_option_types (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null
    check (slug ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' and char_length(slug) between 1 and 40),
  name jsonb not null check (name ? 'en'),
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_option_types_updated_at before update on public.product_option_types
  for each row execute function public.tg_set_updated_at();

insert into public.product_option_types(slug, name, sort_order) values
  ('size', '{"en":"Size","zh-Hant":"尺寸","zh-Hans":"尺寸"}'::jsonb, 10),
  ('color', '{"en":"Color","zh-Hant":"顏色","zh-Hans":"颜色"}'::jsonb, 20),
  ('material', '{"en":"Material","zh-Hant":"材質","zh-Hans":"材质"}'::jsonb, 30),
  ('finish', '{"en":"Finish","zh-Hant":"表面處理","zh-Hans":"表面处理"}'::jsonb, 40),
  ('quantity', '{"en":"Quantity","zh-Hant":"數量","zh-Hans":"数量"}'::jsonb, 50)
on conflict (slug) do nothing;

-- Preserve existing localized labels while turning each distinct label into
-- a reusable predefined type. Common labels then appear once in the dropdown.
insert into public.product_option_types(slug, name, sort_order)
select distinct
  left(trim(both '-' from regexp_replace(lower(trim(g.label->>'en')), '[^a-z0-9]+', '-', 'g')), 40),
  g.label, 100
from public.product_option_groups g
where nullif(trim(g.label->>'en'), '') is not null
  and trim(both '-' from regexp_replace(lower(trim(g.label->>'en')), '[^a-z0-9]+', '-', 'g')) <> ''
on conflict (slug) do nothing;

alter table public.product_option_groups
  add column if not exists option_type_id uuid
    references public.product_option_types(id) on delete set null;

create index if not exists product_option_groups_option_type_idx
  on public.product_option_groups(option_type_id);

update public.product_option_groups g
   set option_type_id = t.id
  from public.product_option_types t
 where g.option_type_id is null and t.name->>'en' = g.label->>'en';

alter table public.product_option_types enable row level security;

create policy product_option_types_read on public.product_option_types
  for select using (
    is_active = true or public.is_admin() or public.has_permission('products.manage'));
create policy product_option_types_manage on public.product_option_types
  for all to authenticated
  using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));

grant select on public.product_option_types to anon, authenticated;
grant insert, update, delete on public.product_option_types to authenticated;

-- ------- linked material slots -------
-- Several slots of one multi-material print can be connected so they share
-- the same material and colour settings.
alter table public.product_material_slots
  add column if not exists linked_slot_id uuid
    references public.product_material_slots(id) on delete set null;

create or replace function public.tg_validate_slot_links()
returns trigger language plpgsql set search_path = public as $$
declare
  v_target_product uuid;
  v_cursor uuid;
  v_hops int := 0;
begin
  if new.linked_slot_id is not null then
    if new.linked_slot_id = new.id then
      raise exception 'A slot cannot link to itself';
    end if;
    select product_id into v_target_product
      from public.product_material_slots where id = new.linked_slot_id;
    if not found then
      raise exception 'Unknown linked slot';
    end if;
    if v_target_product is distinct from new.product_id then
      raise exception 'Linked slot must belong to the same product';
    end if;
    if exists (select 1 from public.product_material_slots where id = new.linked_slot_id and linked_slot_id is not null) then
      raise exception 'Linked slot must point to an unlinked slot';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists product_material_slots_links on public.product_material_slots;
create trigger product_material_slots_links
  before insert or update of linked_slot_id, product_id on public.product_material_slots
  for each row execute function public.tg_validate_slot_links();

-- ------- choices used in orders can be deleted -------
alter table public.order_item_option_values
  drop constraint if exists order_item_option_values_selected_choice_id_fkey;
alter table public.order_item_option_values
  add constraint order_item_option_values_selected_choice_id_fkey
  foreign key (selected_choice_id)
  references public.product_option_choices(id) on delete set null;

alter table public.order_item_option_values
  drop constraint if exists order_item_option_values_option_group_id_fkey;
alter table public.order_item_option_values
  add constraint order_item_option_values_option_group_id_fkey
  foreign key (option_group_id)
  references public.product_option_groups(id) on delete set null;

-- ------- price_cart (v8: coupon points, linked slots) -------
create or replace function public.price_cart(p_cart jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_location_id uuid;
  v_loc record;
  v_item jsonb;
  v_lines public.price_line[] := array[]::public.price_line[];
  v_line public.price_line;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_tax_rate numeric := 0;
  v_total numeric := 0;
  v_discount numeric := 0;
  v_line_total numeric;
  v_unit numeric;
  v_qty int;
  -- premade vars
  v_prod record;
  v_mat record;
  v_modifier numeric := 0;
  v_pm record;
  v_options_modifier numeric := 0;
  v_snapshot jsonb;
  v_opt_group record;
  v_choice record;
  v_selected jsonb;
  v_text_config record;
  v_file_config record;
  v_selected_text text;
  v_file_path text;
  v_selected_count int;
  v_seen_choices uuid[];
  -- material slot vars: one print can combine several materials and colours
  v_slot record;
  v_root record;
  v_root_sel jsonb;
  v_slot_sel jsonb;
  v_slot_material_id uuid;
  v_slot_filament_id uuid;
  v_slot_sm record;
  v_slot_mat record;
  v_slots_modifier numeric := 0;
  v_slots_json jsonb := '[]'::jsonb;
  v_slot_index int := 0;
  v_has_slots boolean := false;
  -- sale price vars
  v_regular numeric;
  v_effective numeric;
  v_choice_regular numeric;
  v_choice_price numeric;
  v_sale_savings numeric := 0;
  -- custom vars
  v_quote record;
  v_model record;
  -- ticket vars
  v_tq public.ticket_quotes;
  v_ticket public.tickets;
  v_cart_user uuid;
  -- coupon vars
  v_coupon_code text;
  v_coupon public.coupons;
  v_coupon_json jsonb;
  v_product_totals jsonb := '{}'::jsonb;
  v_product_total numeric;
  -- reusable
  i int := 0;
  v_choice_id uuid;
begin
  v_location_id := (p_cart->>'location_id')::uuid;
  if v_location_id is null then
    raise exception 'location_id is required';
  end if;

  select * into v_loc from public.locations where id = v_location_id and is_active = true;
  if not found then raise exception 'Invalid or inactive location'; end if;

  v_cart_user := (p_cart->>'user_id')::uuid;

  for v_item in select jsonb_array_elements(p_cart->'items') as elem
  loop
    i := i + 1;
    v_line := null;
    v_line.line_id := i;
    v_line.kind := v_item->>'kind';
    v_line.options_json := coalesce(v_item->'options', '{}'::jsonb);
    v_qty := coalesce((v_item->>'quantity')::int, 1);
    v_line.quantity := v_qty;
    v_options_modifier := 0;
    v_modifier := 0;
    v_slots_modifier := 0;
    v_slots_json := '[]'::jsonb;
    v_slot_index := 0;
    v_has_slots := false;
    if v_qty < 1 or v_qty > 99 then raise exception 'Invalid quantity'; end if;

    if v_item->>'kind' = 'document' then
      if v_item->>'color' not in ('grayscale','color') then raise exception 'Invalid print color'; end if;
      if jsonb_typeof(v_item->'duplex') is distinct from 'boolean' then raise exception 'Invalid duplex setting'; end if;
      if (v_item->>'pages')::int not between 1 and 500 then raise exception 'Page count must be 1 to 500'; end if;
      if not coalesce(public._document_path_allowed(v_item->>'file_path', v_cart_user), false) then
        raise exception 'Invalid document path';
      end if;
      perform 1 from storage.objects where bucket_id = 'document-prints' and name = v_item->>'file_path';
      if not found then raise exception 'Document upload not found'; end if;
      v_unit := (v_item->>'pages')::int * case when v_item->>'color' = 'color'
        then coalesce((select (value#>>'{}')::numeric from public.platform_settings where key = 'document.color_per_side'), 1.00)
        else coalesce((select (value#>>'{}')::numeric from public.platform_settings where key = 'document.grayscale_per_side'), 0.50)
      end;
      v_line.unit_price := v_unit;
      v_line_total := v_unit * v_qty;
      v_line.line_total := v_line_total;
      v_line.description := jsonb_build_object('en','A4 document printing','zh-Hant','A4 文件列印','zh-Hans','A4 文件打印');
      v_line.item_snapshot := jsonb_build_object('kind','document','file_path',v_item->>'file_path',
        'pages',(v_item->>'pages')::int,'color',v_item->>'color','duplex',(v_item->>'duplex')::boolean);

    elsif v_item->>'kind' = 'premade' then
      v_line.product_id := (v_item->>'product_id')::uuid;
      select * into v_prod from public.premade_products where id = v_line.product_id and status = 'published';
      if not found then raise exception 'Product not available'; end if;

      -- A product can be printed from several materials at once: named slots,
      -- each with its own eligible materials, price modifier and defaults.
      perform 1 from public.product_material_slots where product_id = v_prod.id limit 1;
      v_has_slots := found;

      if v_has_slots then
        for v_slot in select * from public.product_material_slots
                      where product_id = v_prod.id order by sort_order, id
        loop
          v_slot_sel := coalesce(v_item->'slots'->(v_slot.id::text), '{}'::jsonb);
          if v_slot.linked_slot_id is not null then
            select * into v_root from public.product_material_slots where id = v_slot.linked_slot_id;
            if not found or v_root.product_id is distinct from v_prod.id or v_root.linked_slot_id is not null then
              raise exception 'Linked slot must point to an unlinked slot on this product';
            end if;
            v_root_sel := coalesce(v_item->'slots'->(v_root.id::text), '{}'::jsonb);
            -- Use the root selection/default for this linked part, while still
            -- validating it against this slot's eligible materials and colors.
            v_slot_sel := v_root_sel;
            v_slot.default_material_id := coalesce(nullif(v_root_sel->>'material_id', '')::uuid, v_root.default_material_id);
            v_slot.default_filament_id := coalesce(nullif(v_root_sel->>'color_filament_id', '')::uuid, v_root.default_filament_id);
          end if;

          -- Material: the customer's pick, else the slot's default, else the
          -- first eligible material, so a slot is never unprintable.
          v_slot_material_id := nullif(v_slot_sel->>'material_id', '')::uuid;
          if v_slot_material_id is null then v_slot_material_id := v_slot.default_material_id; end if;
          if v_slot_material_id is null then
            select material_id into v_slot_material_id from public.product_slot_materials
              where slot_id = v_slot.id order by material_id limit 1;
          end if;
          if v_slot_material_id is null then
            raise exception 'No material available for %', coalesce(v_slot.name->>'en', 'this part');
          end if;

          select * into v_slot_sm from public.product_slot_materials
            where slot_id = v_slot.id and material_id = v_slot_material_id;
          if not found then
            raise exception 'Material not allowed for %', coalesce(v_slot.name->>'en', 'this part');
          end if;

          select m.* into v_slot_mat from public.materials m
            where m.id = v_slot_material_id and m.is_active = true;
          if not found then
            raise exception 'Invalid material for %', coalesce(v_slot.name->>'en', 'this part');
          end if;
          v_slots_modifier := v_slots_modifier + coalesce(v_slot_sm.price_modifier, 0);

          -- Colour: an explicit pick must belong to that material and be in
          -- stock at the pickup location. A slot default that is out of stock
          -- is dropped rather than failing a cart the customer cannot fix.
          v_slot_filament_id := nullif(v_slot_sel->>'color_filament_id', '')::uuid;
          if v_slot_filament_id is not null then
            perform 1 from public.filaments f
              where f.id = v_slot_filament_id and f.material_id = v_slot_material_id and f.is_active = true;
            if not found then
              raise exception 'Color/material mismatch for %', coalesce(v_slot.name->>'en', 'this part');
            end if;
            perform 1 from public.location_filaments lf
              where lf.location_id = v_location_id and lf.filament_id = v_slot_filament_id
                and lf.in_stock = true;
            if not found then raise exception 'Selected color not available at location'; end if;
          else
            v_slot_filament_id := v_slot.default_filament_id;
            if v_slot_filament_id is not null and not exists (
              select 1 from public.filaments f
                where f.id = v_slot_filament_id and f.material_id = v_slot_material_id and f.is_active = true
            ) then
              v_slot_filament_id := null;
            end if;
            if v_slot_filament_id is not null and not exists (
              select 1 from public.location_filaments lf
                where lf.location_id = v_location_id and lf.filament_id = v_slot_filament_id
                  and lf.in_stock = true
            ) then
              v_slot_filament_id := null;
            end if;
          end if;

          v_slots_json := v_slots_json || jsonb_build_array(jsonb_build_object(
            'slot_id', v_slot.id,
            'name', v_slot.name,
            'material', jsonb_build_object('id', v_slot_mat.id, 'slug', v_slot_mat.slug,
              'name', v_slot_mat.name, 'adjective', v_slot_mat.adjective),
            'material_price_modifier', coalesce(v_slot_sm.price_modifier, 0),
            'color', (select jsonb_build_object('id', f.id, 'color', f.color, 'color_hex', f.color_hex)
                        from public.filaments f where f.id = v_slot_filament_id)
          ));

          -- The first slot keeps the legacy single-material columns meaningful
          -- for staff screens and older reports.
          if v_slot_index = 0 then
            v_line.material_id := v_slot_material_id;
            v_line.color_filament_id := v_slot_filament_id;
            v_mat := v_slot_mat;
          end if;
          v_slot_index := v_slot_index + 1;
        end loop;
      else
        -- Determine material: explicit, default, or first product_material
        if v_item->>'material_id' is not null then
          v_line.material_id := (v_item->>'material_id')::uuid;
        else
          v_line.material_id := v_prod.default_material_id;
        end if;

        if v_line.material_id is null then
          select material_id into v_line.material_id from public.product_materials
            where product_id = v_prod.id order by material_id limit 1;
        end if;

        select m.* into v_mat from public.materials m where m.id = v_line.material_id and is_active = true;
        if not found then raise exception 'Invalid material for product'; end if;

        select * into v_pm from public.product_materials
          where product_id = v_prod.id and material_id = v_line.material_id;
        if not found then raise exception 'Material not allowed for this product'; end if;
        v_modifier := coalesce(v_pm.price_modifier, 0);

        -- Color: verify filament is in-stock at location
        if v_item->>'color_filament_id' is not null then
          v_line.color_filament_id := (v_item->>'color_filament_id')::uuid;
          perform 1 from public.location_filaments lf
            where lf.location_id = v_location_id and lf.filament_id = v_line.color_filament_id
              and lf.in_stock = true;
          if not found then raise exception 'Selected color not available at location'; end if;
          perform 1 from public.filaments f
            where f.id = v_line.color_filament_id and f.material_id = v_line.material_id and f.is_active = true;
          if not found then raise exception 'Color/material mismatch'; end if;
        end if;
      end if;

      -- Validate customer options as well as pricing them: admins can create new
      -- groups, so the server must not trust a stale or edited browser cart.
      for v_opt_group in select * from public.product_option_groups where product_id = v_prod.id order by sort_order
      loop
        v_selected := v_line.options_json->(v_opt_group.id::text);
        v_selected_count := 0;
        v_seen_choices := array[]::uuid[];

        if v_opt_group.option_type = 'select_one' then
          if nullif(v_selected->>'choice_id', '') is not null then
            select * into v_choice from public.product_option_choices
              where id = (v_selected->>'choice_id')::uuid and group_id = v_opt_group.id;
            if not found then raise exception 'Invalid choice for %', v_opt_group.label->>'en'; end if;
            v_choice_regular := coalesce(v_choice.price_modifier, 0);
            v_choice_price := public.effective_price(v_choice_regular, v_choice.sale_price,
                                                     v_choice.sale_starts_at, v_choice.sale_ends_at);
            v_options_modifier := v_options_modifier + v_choice_price;
            v_sale_savings := v_sale_savings + (v_choice_regular - v_choice_price) * v_qty;
            v_selected_count := 1;
          end if;
        elsif v_opt_group.option_type = 'select_many' then
          if v_selected->'choice_ids' is not null and jsonb_typeof(v_selected->'choice_ids') <> 'array' then
            raise exception 'Invalid choices for %', v_opt_group.label->>'en';
          end if;
          for v_choice_id in select value::uuid from jsonb_array_elements_text(v_selected->'choice_ids') as x(value)
          loop
            if v_choice_id = any(v_seen_choices) then raise exception 'Duplicate choice'; end if;
            select * into v_choice from public.product_option_choices
              where id = v_choice_id and group_id = v_opt_group.id;
            if not found then raise exception 'Invalid choice for %', v_opt_group.label->>'en'; end if;
            v_seen_choices := array_append(v_seen_choices, v_choice_id);
            v_choice_regular := coalesce(v_choice.price_modifier, 0);
            v_choice_price := public.effective_price(v_choice_regular, v_choice.sale_price,
                                                     v_choice.sale_starts_at, v_choice.sale_ends_at);
            v_options_modifier := v_options_modifier + v_choice_price;
            v_sale_savings := v_sale_savings + (v_choice_regular - v_choice_price) * v_qty;
            v_selected_count := v_selected_count + 1;
          end loop;
        elsif v_opt_group.option_type = 'text' then
          v_selected_text := nullif(btrim(v_selected->>'text'), '');
          select * into v_text_config from public.text_option_config where group_id = v_opt_group.id;
          if v_selected_text is not null then
            if length(v_selected_text) > coalesce(v_text_config.max_length, 100) then
              raise exception 'Text is too long for %', v_opt_group.label->>'en';
            end if;
            v_options_modifier := v_options_modifier + coalesce(v_text_config.price_modifier, 0);
            v_selected_count := 1;
          end if;
        elsif v_opt_group.option_type = 'file' then
          v_file_path := nullif(v_selected->>'file_path', '');
          select * into v_file_config from public.file_option_config where group_id = v_opt_group.id;
          if v_file_path is not null then
            if v_cart_user is null or v_file_path not like (v_cart_user::text || '/%') then
              raise exception 'Invalid file for %', v_opt_group.label->>'en';
            end if;
            perform 1 from storage.objects so
              where so.bucket_id = 'option-uploads' and so.name = v_file_path
                and (so.metadata->>'size')::numeric <= coalesce(v_file_config.max_size_bytes, 5242880)
                and (so.metadata->>'mimetype') = any(v_file_config.allowed_mime_types);
            if not found then raise exception 'File is not allowed for %', v_opt_group.label->>'en'; end if;
            v_selected_count := 1;
          end if;
          if coalesce(v_file_config.required, false) and v_selected_count = 0 then
            raise exception 'Required option missing: %', v_opt_group.label->>'en';
          end if;
        end if;
        if v_opt_group.required and v_selected_count = 0 then
          raise exception 'Required option missing: %', v_opt_group.label->>'en';
        end if;
      end loop;

      -- A sale price (optionally windowed) replaces the regular base price; the
      -- saving is reported so the storefront can strike the regular price out.
      v_regular := v_prod.base_price;
      v_effective := public.effective_price(v_prod.base_price, v_prod.sale_price,
                                            v_prod.sale_starts_at, v_prod.sale_ends_at);
      v_sale_savings := v_sale_savings + (v_regular - v_effective) * v_qty;

      v_unit := v_effective + v_modifier + v_slots_modifier + v_options_modifier;
      if v_unit < 0 then v_unit := 0; end if;
      v_line.unit_price := v_unit;
      v_line_total := v_unit * v_qty;
      v_line.line_total := v_line_total;
      v_line.description := v_prod.name;
      v_line.creator_id := v_prod.submitted_by;

      -- Per-product totals let a product-scoped coupon discount only its own item.
      v_product_total := coalesce((v_product_totals ->> v_prod.id::text)::numeric, 0) + v_line_total;
      v_product_totals := jsonb_set(v_product_totals, array[v_prod.id::text], to_jsonb(v_product_total));

      v_snapshot := jsonb_build_object(
        'kind','premade',
        'product_id', v_prod.id,
        'name', v_prod.name,
        'slug', v_prod.slug,
        'base_price', v_prod.base_price,
        'regular_price', v_regular,
        'sale_price', case when v_effective < v_regular then v_effective else null end,
        'material', jsonb_build_object('id', v_mat.id, 'slug', v_mat.slug, 'name', v_mat.name, 'adjective', v_mat.adjective),
        'material_price_modifier', v_modifier,
        'slots_price_modifier', v_slots_modifier,
        'slots', v_slots_json,
        'options_price_modifier', v_options_modifier,
        'image_url', coalesce(v_prod.image_urls->>0, null),
        'model_path', v_prod.source_model_path
      );
      v_line.item_snapshot := v_snapshot;

    elsif v_item->>'kind' = 'custom' then
      v_line.quote_request_id := (v_item->>'quote_request_id')::uuid;
      select * into v_quote from public.quote_requests where id = v_line.quote_request_id;
      if not found then raise exception 'Quote not found'; end if;
      if v_quote.expires_at < now() then raise exception 'Quote expired'; end if;
      select * into v_model from public.uploaded_models where id = v_quote.uploaded_model_id;
      if not found or not v_model.verified then
        raise exception 'Custom model must be verified before checkout';
      end if;

      v_unit := v_quote.estimated_price / greatest(v_quote.quantity,1);
      v_line.unit_price := v_unit;
      v_line.material_id := v_quote.material_id;
      v_line.color_filament_id := v_quote.filament_id;
      v_line_total := v_unit * v_qty;
      v_line.line_total := v_line_total;
      v_line.description := jsonb_build_object(
        'en', 'Custom 3D print', 'zh-Hant', '自訂 3D 列印', 'zh-Hans', '自定义 3D 打印'
      );
      v_line.item_snapshot := jsonb_build_object(
        'kind','custom',
        'quote_request_id', v_quote.id,
        'original_filename', v_model.original_filename,
        'model_path', v_model.file_path,
        'material_id', v_quote.material_id,
        'filament_id', v_quote.filament_id,
        'infill_percent', v_quote.infill_percent,
        'layer_height', v_quote.layer_height,
        'grams', v_quote.material_usage_grams,
        'print_time_minutes', v_quote.print_time_minutes,
        'price_breakdown', v_quote.price_breakdown
      );

    elsif v_item->>'kind' = 'ticket' then
      v_line.ticket_quote_id := (v_item->>'ticket_quote_id')::uuid;
      select * into v_tq from public.ticket_quotes where id = v_line.ticket_quote_id;
      if not found then raise exception 'Quote not found'; end if;
      select * into v_ticket from public.tickets where id = v_tq.ticket_id;
      if not found then raise exception 'Ticket not found'; end if;
      -- The cart's verified owner must be the ticket owner (ticket items
      -- can never be in a guest cart: accepting a quote requires sign-in).
      if v_ticket.user_id is distinct from v_cart_user then
        raise exception 'Quote does not belong to this cart';
      end if;
      if v_tq.status <> 'accepted' then
        raise exception 'Quote must be accepted before checkout';
      end if;
      if v_tq.expires_at < now() then
        update public.ticket_quotes set status = 'expired' where id = v_tq.id;
        raise exception 'Quote expired';
      end if;

      v_unit := v_tq.unit_price;
      v_qty := v_tq.quantity;
      v_line.quantity := v_qty;
      v_line.unit_price := v_unit;
      v_line_total := v_unit * v_qty;
      v_line.line_total := v_line_total;
      v_line.description := jsonb_build_object(
        'en', 'Quoted item', 'zh-Hant', '報價項目', 'zh-Hans', '报价项目'
      );
      v_line.item_snapshot := jsonb_build_object(
        'kind','ticket',
        'ticket_quote_id', v_tq.id,
        'ticket_id', v_ticket.id,
        'description', v_tq.description,
        'unit_price', v_tq.unit_price,
        'quantity', v_tq.quantity
      );
    else
      raise exception 'Unknown item kind: %', v_item->>'kind';
    end if;

    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || v_line;
  end loop;

  -- The authenticated buyer id is verified by stripe-checkout before payment.
  -- An unassigned coupon can also be used by a guest.
  v_coupon_code := nullif(btrim(coalesce(p_cart->>'coupon_code', '')), '');
  if v_coupon_code is not null then
    v_coupon := public._active_coupon(v_coupon_code, v_cart_user);
    perform public._assert_coupon_applies(v_coupon, v_subtotal, v_product_totals);
    v_discount := public._coupon_discount(v_coupon, v_subtotal, v_product_totals);
    if coalesce(v_coupon.grant_points, 0) > 0 and v_cart_user is null then
      raise exception 'Sign in to use this points coupon';
    end if;
    v_coupon_json := jsonb_build_object(
      'code', v_coupon.code, 'discount_type', v_coupon.discount_type,
      'discount_value', v_coupon.discount_value, 'discount_amount', round(v_discount, 2),
      'grant_points', v_coupon.grant_points,
      'min_subtotal', v_coupon.min_subtotal, 'product_id', v_coupon.product_id,
      'product_subtotal', case when v_coupon.product_id is null then null
        else coalesce((v_product_totals ->> v_coupon.product_id::text)::numeric, 0) end,
      'expires_at', v_coupon.expires_at
    );
  end if;

  -- Sales tax depends on the location's country; Hong Kong and the other
  -- no-sales-tax jurisdictions always price at zero.
  v_tax_rate := public.sales_tax_rate(v_loc.country, v_loc.tax_rate);
  v_tax := round(((v_subtotal - v_discount) * v_tax_rate)::numeric, 2);
  -- No minimum-order floor: the total is exactly what the cart costs.
  v_total := v_subtotal - v_discount + v_tax;

  return jsonb_build_object(
    'location_id', v_location_id,
    'currency', v_loc.currency,
    'country', v_loc.country,
    'subtotal', round(v_subtotal,2),
    'discount_amount', round(v_discount,2),
    'coupon', coalesce(v_coupon_json, 'null'::jsonb),
    'tax_rate', v_tax_rate,
    'tax_amount', v_tax,
    'shipping_amount', 0,
    'total_amount', round(v_total,2),
    'sale_savings', round(v_sale_savings,2),
    'product_totals', v_product_totals,
    'lines', to_jsonb(v_lines)
  );
end;
$$;

grant execute on function public.price_cart(jsonb) to anon, authenticated, service_role;

-- ------- create_order_from_cart (v5: order notes, coupon points) -------
create or replace function public.create_order_from_cart(
  p_session_id text,
  p_user_id uuid,
  p_location_id uuid,
  p_contact_email text,
  p_contact_name text,
  p_locale text,
  p_stripe_payment_intent_id text default null
)
returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  v_sess record;
  v_pricing jsonb;
  v_order public.orders;
  v_line jsonb;
  v_item public.order_items;
  v_commission numeric;
  v_comm_val jsonb;
  v_cut numeric;
  v_opt_group record;
  v_sel jsonb;
  v_coupon_code text;
  v_coupon public.coupons;
  v_buyer uuid;
  v_note text;
begin
  select * into v_sess from public.checkout_sessions where session_id = p_session_id;
  if not found then raise exception 'Checkout session not found'; end if;
  select * into v_order from public.orders where stripe_session_id = p_session_id;
  if found then return v_order; end if;

  -- The checkout session was written by stripe-checkout after validating the
  -- caller. Reuse its buyer and location instead of accepting different ids here.
  if p_user_id is distinct from v_sess.user_id or p_location_id is distinct from v_sess.location_id then
    raise exception 'Checkout session owner or location mismatch';
  end if;
  v_buyer := v_sess.user_id;
  v_pricing := public.price_cart(v_sess.cart);

  -- Create order
  insert into public.orders(
    order_number, user_id, location_id, contact_name, contact_email, locale,
    status, subtotal, tax_amount, shipping_amount, total_amount, currency,
    discount_amount, stripe_session_id, stripe_payment_intent_id
  ) values (
    public.next_order_number(),
    v_buyer,
    p_location_id,
    coalesce(p_contact_name, v_sess.contact_name),
    coalesce(p_contact_email, v_sess.contact_email),
    coalesce(p_locale, v_sess.locale, 'en'),
    'pending',
    (v_pricing->>'subtotal')::numeric,
    (v_pricing->>'tax_amount')::numeric,
    (v_pricing->>'shipping_amount')::numeric,
    (v_pricing->>'total_amount')::numeric,
    v_pricing->>'currency',
    coalesce((v_pricing->>'discount_amount')::numeric, 0),
    p_session_id,
    p_stripe_payment_intent_id
  ) returning * into v_order;

  -- Preserve the buyer's optional checkout note (guest notes have no author).
  v_note := nullif(btrim(coalesce(v_sess.cart->>'note', '')), '');
  if v_note is not null then
    insert into public.order_notes(order_id, author_id, body, kind)
    values (v_order.id, v_buyer, left(v_note, 5000), 'customer');
  end if;

  -- Lock and consume the single-use coupon in the same transaction as the order.
  v_coupon_code := nullif(btrim(coalesce(v_sess.cart->>'coupon_code', '')), '');
  if v_coupon_code is not null then
    select * into v_coupon from public.coupons where code = upper(v_coupon_code) for update;
    v_coupon := public._active_coupon(v_coupon_code, v_buyer);
    perform public._assert_coupon_applies(v_coupon, (v_pricing->>'subtotal')::numeric, v_pricing->'product_totals');
    if public._coupon_discount(v_coupon, (v_pricing->>'subtotal')::numeric, v_pricing->'product_totals')
       <> (v_pricing->>'discount_amount')::numeric then
      raise exception 'Coupon is no longer valid for this order';
    end if;
    update public.coupons set status = 'used', used_order_id = v_order.id, used_at = now()
      where id = v_coupon.id and status = 'active';
    if not found then raise exception 'Coupon already used'; end if;
    if coalesce(v_coupon.grant_points, 0) > 0 and v_buyer is not null then
      update public.profiles
         set points_balance = points_balance + v_coupon.grant_points,
             lifetime_points = lifetime_points + v_coupon.grant_points
       where id = v_buyer;
      insert into public.reward_transactions(user_id, points, type, order_id, coupon_id, memo)
      values (v_buyer, v_coupon.grant_points, 'grant', v_order.id, v_coupon.id,
              'Granted by coupon ' || v_coupon.code);
    end if;
  end if;

  select value into v_comm_val from public.platform_settings where key='platform.commission_percent';
  v_commission := coalesce((v_comm_val#>>'{}')::numeric, 15) / 100.0;

  -- Create items
  for v_line in select jsonb_array_elements(v_pricing->'lines') as elem
  loop
    insert into public.order_items(
      order_id, premade_product_id, quote_request_id, ticket_quote_id,
      material_id, color_filament_id,
      quantity, unit_price, item_snapshot, creator_id, material_slots
    ) values (
      v_order.id,
      (v_line->>'product_id')::uuid,
      (v_line->>'quote_request_id')::uuid,
      (v_line->>'ticket_quote_id')::uuid,
      (v_line->>'material_id')::uuid,
      (v_line->>'color_filament_id')::uuid,
      (v_line->>'quantity')::int,
      (v_line->>'unit_price')::numeric,
      v_line->'item_snapshot',
      (v_line->>'creator_id')::uuid,
      nullif(v_line->'item_snapshot'->'slots', '[]'::jsonb)
    ) returning * into v_item;

    -- Creator revenue on premade community products
    if v_item.creator_id is not null and v_item.premade_product_id is not null then
      v_cut := round((v_item.unit_price * (1 - v_commission))::numeric, 2);
      update public.order_items
         set creator_revenue = v_cut * quantity,
             platform_fee = (v_item.unit_price - v_cut) * quantity
       where id = v_item.id;
      insert into public.creator_earnings(creator_id, order_item_id, type, amount, memo)
        values (v_item.creator_id, v_item.id, 'sale', v_cut * v_item.quantity, 'Order '||v_order.order_number);
    end if;

    -- A ticket quote that reaches checkout is fulfilled against that order
    if v_item.ticket_quote_id is not null then
      update public.ticket_quotes
         set status = 'ordered', order_id = v_order.id
       where id = v_item.ticket_quote_id;
    end if;

    -- Store option values (for premade)
    if v_line->'options_json' is not null and v_line->>'product_id' is not null then
      for v_opt_group in select * from public.product_option_groups
           where product_id = (v_line->>'product_id')::uuid
      loop
        v_sel := v_line->'options_json'->(v_opt_group.id::text);
        if v_sel is null then continue; end if;
        if v_opt_group.option_type in ('select_one','select_many') and v_sel->'choice_ids' is not null then
          insert into public.order_item_option_values(order_item_id, option_group_id, selected_choice_id)
          select v_item.id, v_opt_group.id, (c::text)::uuid
            from jsonb_array_elements_text(v_sel->'choice_ids') c;
        elsif v_opt_group.option_type = 'select_one' and v_sel->>'choice_id' is not null then
          insert into public.order_item_option_values(order_item_id, option_group_id, selected_choice_id)
          values (v_item.id, v_opt_group.id, (v_sel->>'choice_id')::uuid);
        elsif v_opt_group.option_type = 'text' and v_sel->>'text' is not null then
          insert into public.order_item_option_values(order_item_id, option_group_id, text_value)
          values (v_item.id, v_opt_group.id, v_sel->>'text');
        elsif v_opt_group.option_type = 'file' and v_sel->>'file_path' is not null then
          insert into public.order_item_option_values(order_item_id, option_group_id, file_path)
          values (v_item.id, v_opt_group.id, v_sel->>'file_path');
        end if;
      end loop;
    end if;
  end loop;

  -- Clear cart for logged-in user
  if v_buyer is not null then
    delete from public.cart_items ci
      using public.carts c
      where c.id = ci.cart_id and c.user_id = v_buyer;
  end if;

  return v_order;
end;
$$;

-- This SECURITY DEFINER RPC is only for the Stripe webhook service role.
revoke all on function public.create_order_from_cart(text,uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_order_from_cart(text,uuid,uuid,text,text,text,text) to service_role;

-- ------- admin_save_product (v4: linked material slots) -------
drop function if exists public.admin_save_product(jsonb, jsonb, jsonb);

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
  if nullif(btrim(p_product->'name'->>'en'), '') is null or
     nullif(btrim(p_product->>'source_model_path'), '') is null then
    raise exception 'Product English name and model file are required';
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
      image_urls = p_product->'image_urls', source_model_path = p_product->>'source_model_path',
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
      p_product->'image_urls', p_product->>'source_model_path',
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
revoke all on function public.admin_save_product(jsonb, jsonb, jsonb) from public;
grant execute on function public.admin_save_product(jsonb, jsonb, jsonb) to authenticated;


-- Coupon minting supports optional point grants (including points-only codes).
drop function if exists public.admin_generate_coupons(int,text,text,numeric,numeric,uuid,timestamptz,uuid);

create or replace function public.admin_generate_coupons(
  p_count int,
  p_prefix text default null,
  p_discount_type text default 'fixed',
  p_discount_value numeric default 5,
  p_min_subtotal numeric default null,
  p_product_id uuid default null,
  p_expires_at timestamptz default null,
  p_user_id uuid default null,
  p_grant_points integer default null
)
returns table (coupon_code text, coupon_id uuid)
language plpgsql security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_coupon public.coupons;
  i int;
begin
  if not public.has_permission('coupons.manage') then
    raise exception 'Not permitted to manage coupons';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'Generate between 1 and 500 codes';
  end if;
  if coalesce(p_discount_type, '') not in ('percent','fixed') then
    raise exception 'Invalid discount type';
  end if;
  if p_discount_value is null or p_discount_value < 0 or p_discount_value > 99999999 then
    raise exception 'Invalid discount amount';
  end if;
  if p_grant_points is not null and p_grant_points <= 0 then
    raise exception 'Points must be a positive whole number';
  end if;
  if p_discount_value = 0 and coalesce(p_grant_points, 0) = 0 then
    raise exception 'A coupon must grant a discount or points';
  end if;
  if p_discount_type = 'percent' and p_discount_value > 100 then
    raise exception 'Percent discounts cannot exceed 100';
  end if;
  if p_min_subtotal is not null and (p_min_subtotal <= 0 or p_min_subtotal > 99999999) then
    raise exception 'Invalid minimum spend';
  end if;
  if p_product_id is not null and not exists (
    select 1 from public.premade_products where id = p_product_id
  ) then
    raise exception 'Product not found';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Choose a future expiration date';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.profiles where id = p_user_id
  ) then
    raise exception 'Customer not found';
  end if;

  v_prefix := upper(btrim(coalesce(p_prefix, '')));
  if length(v_prefix) > 12 or v_prefix !~ '^[A-Z0-9_-]*$' then
    raise exception 'Use a prefix of up to 12 letters, numbers, underscores, or hyphens';
  end if;
  -- Codes are at most 32 characters: prefix plus the 10 random characters.
  if length(v_prefix) + 10 > 32 then
    raise exception 'That prefix is too long';
  end if;

  for i in 1..p_count loop
    loop
      begin
        insert into public.coupons(code, user_id, source, discount_type, discount_value,
                                   min_subtotal, product_id, expires_at, grant_points)
        values (public._coupon_code(v_prefix, 10), p_user_id, 'admin',
                p_discount_type, p_discount_value, p_min_subtotal, p_product_id, p_expires_at, p_grant_points)
        returning * into v_coupon;
        exit;
      exception when unique_violation then
        continue;
      end;
    end loop;
    coupon_code := v_coupon.code;
    coupon_id := v_coupon.id;
    return next;
  end loop;
end;
$$;


-- Staff product model and image uploads are not artificially capped at the client.
update storage.buckets set file_size_limit = null
 where id in ('product-files', 'product-images');
