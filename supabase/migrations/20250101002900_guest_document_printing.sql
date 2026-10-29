-- Guest document printing: the bucket stays private. Anonymous visitors can
-- only insert a PDF at a two-UUID capability path and receive no read policy.
-- Signed-in owners keep their existing owner-scoped upload/read policies.
create policy "document guest upload" on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'document-prints'
    and name ~ '^guest/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\.pdf$'
  );

create or replace function public._document_path_allowed(p_path text, p_user_id uuid)
returns boolean
language sql immutable
set search_path = public
as $$
  select (
    p_user_id is not null and p_path like (p_user_id::text || '/%')
  ) or (
    p_path ~ '^guest/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\.pdf$'
  );
$$;

-- price_cart (v7): guest capability paths are valid without an account. The
-- Stripe function still downloads every PDF and replaces the browser's page
-- count before charging, so guest pricing remains authoritative.
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
      v_line.description := jsonb_build_object('en','Document Printing','zh-Hant','A4 文件列印','zh-Hans','A4 文件打印');
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
    v_coupon_json := jsonb_build_object(
      'code', v_coupon.code, 'discount_type', v_coupon.discount_type,
      'discount_value', v_coupon.discount_value, 'discount_amount', round(v_discount, 2),
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
