-- Private uploaded A4 PDFs, available only to their owner and staff via signed URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('document-prints','document-prints',false,20971520,array['application/pdf']) on conflict (id) do nothing;
create policy "document owner upload" on storage.objects for insert to authenticated
 with check (bucket_id = 'document-prints' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "document owner read" on storage.objects for select to authenticated
 using (bucket_id = 'document-prints' and (storage.foldername(name))[1] = auth.uid()::text);
create or replace function public.price_cart(p_cart jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_location_id uuid;
  v_loc record;
  v_item jsonb;
  v_lines public.price_line[];
  v_line public.price_line;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
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
  -- custom vars
  v_quote record;
  v_model record;
  -- coupon vars
  v_coupon_code text;
  v_coupon public.coupons;
  v_coupon_json jsonb;
  -- constants
  c_wall numeric; c_setup int; c_handling numeric; c_minfee numeric; c_comm numeric;
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

  select * into c_wall, c_setup, c_handling, c_minfee, c_comm
    from public._quote_constants();

  for v_item in select jsonb_array_elements(p_cart->'items') as elem
  loop
    -- FOR-loop target is scalar jsonb: each iteration already holds the element.
    i := i + 1;
    v_line := null;
    v_line.line_id := i;

    v_line.kind := v_item->>'kind';
    v_line.options_json := coalesce(v_item->'options', '{}'::jsonb);
    v_qty := coalesce((v_item->>'quantity')::int, 1);
    v_line.quantity := v_qty;
    v_options_modifier := 0;
    v_modifier := 0;

    if v_qty < 1 or v_qty > 99 then raise exception 'Invalid quantity'; end if;
    if v_item->>'kind' = 'document' then
      if nullif(p_cart->>'user_id','') is null then raise exception 'Sign in to upload documents'; end if;
      if v_item->>'color' not in ('grayscale','color') then raise exception 'Invalid print color'; end if;
      if jsonb_typeof(v_item->'duplex') is distinct from 'boolean' then raise exception 'Invalid duplex setting'; end if;
      if (v_item->>'pages')::int not between 1 and 500 then raise exception 'Page count must be 1 to 500'; end if;
      if (v_item->>'file_path') not like ((p_cart->>'user_id') || '/%') then raise exception 'Invalid document path'; end if;
      perform 1 from storage.objects where bucket_id = 'document-prints' and name = v_item->>'file_path';
      if not found then raise exception 'Document upload not found'; end if;
      -- pages are printed sides; duplex changes sheets used, not billable sides.
      v_unit := (v_item->>'pages')::int * case when v_item->>'color' = 'color' then 1.00 else 0.50 end;
      v_line.unit_price := v_unit;
      v_line_total := v_unit * v_qty;
      v_line.line_total := v_line_total;
      v_line.description := jsonb_build_object('en','A4 document printing');
      v_line.item_snapshot := jsonb_build_object('kind','document','file_path',v_item->>'file_path',
        'pages',(v_item->>'pages')::int,'color',v_item->>'color','duplex',(v_item->>'duplex')::boolean);
    elsif v_item->>'kind' = 'premade' then
      v_line.product_id := (v_item->>'product_id')::uuid;
      select * into v_prod from public.premade_products where id = v_line.product_id and status = 'published';
      if not found then raise exception 'Product not available'; end if;

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

      -- Option pricing
      for v_opt_group in select * from public.product_option_groups where product_id = v_prod.id order by sort_order
      loop
        v_selected := v_line.options_json->(v_opt_group.id::text);
        if v_opt_group.required and (v_selected is null or v_selected = 'null'::jsonb) then
          raise exception 'Required option missing: %', v_opt_group.label->>'en';
        end if;
        if v_selected is null then continue; end if;

        if v_opt_group.option_type = 'select_one' then
          if v_selected->>'choice_id' is not null then
            select * into v_choice from public.product_option_choices
              where id = (v_selected->>'choice_id')::uuid and group_id = v_opt_group.id;
            if found then v_options_modifier := v_options_modifier + coalesce(v_choice.price_modifier,0); end if;
          end if;
        elsif v_opt_group.option_type = 'select_many' then
          for v_choice_id in select * from jsonb_array_elements_text(v_selected->'choice_ids')
          loop
            select * into v_choice from public.product_option_choices
              where id = v_choice_id::uuid and group_id = v_opt_group.id;
            if found then v_options_modifier := v_options_modifier + coalesce(v_choice.price_modifier,0); end if;
          end loop;
        elsif v_opt_group.option_type = 'text' then
          select * into v_text_config from public.text_option_config where group_id = v_opt_group.id;
          if v_selected->>'text' is not null and length(v_selected->>'text') > 0 then
            v_options_modifier := v_options_modifier + coalesce(v_text_config.price_modifier,0);
          end if;
        end if;
      end loop;

      v_unit := v_prod.base_price + v_modifier + v_options_modifier;
      if v_unit < 0 then v_unit := 0; end if;
      v_line.unit_price := v_unit;
      v_line_total := v_unit * v_qty;
      v_line.line_total := v_line_total;
      v_line.creator_id := v_prod.submitted_by;
      v_line.description := v_prod.name;

      v_snapshot := jsonb_build_object(
        'kind','premade',
        'product_id', v_prod.id,
        'name', v_prod.name,
        'slug', v_prod.slug,
        'base_price', v_prod.base_price,
        'material', jsonb_build_object('id', v_mat.id, 'slug', v_mat.slug, 'name', v_mat.name, 'adjective', v_mat.adjective),
        'material_price_modifier', v_modifier,
        'options_price_modifier', v_options_modifier,
        'image_url', coalesce(v_prod.image_urls->>0, null)
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
        'material_id', v_quote.material_id,
        'filament_id', v_quote.filament_id,
        'infill_percent', v_quote.infill_percent,
        'layer_height', v_quote.layer_height,
        'grams', v_quote.material_usage_grams,
        'print_time_minutes', v_quote.print_time_minutes,
        'price_breakdown', v_quote.price_breakdown
      );
    else
      raise exception 'Unknown item kind: %', v_item->>'kind';
    end if;

    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || v_line;
  end loop;

  if v_subtotal < c_minfee and v_subtotal > 0 then
    -- Apply min-order fee as a top-up against subtotal (transparent: add line handled by UI)
    null; -- we leave raw subtotal; total floors to minfee
  end if;

  -- Coupon: validate against the (edge-function-verified) buyer id and discount the subtotal.
  v_coupon_code := nullif(btrim(coalesce(p_cart->>'coupon_code', '')), '');
  if v_coupon_code is not null then
    v_coupon := public._active_coupon(v_coupon_code, nullif(p_cart->>'user_id', '')::uuid);
    v_discount := public._coupon_discount(v_coupon, v_subtotal);
    v_coupon_json := jsonb_build_object(
      'code', v_coupon.code,
      'discount_type', v_coupon.discount_type,
      'discount_value', v_coupon.discount_value,
      'discount_amount', round(v_discount, 2),
      'expires_at', v_coupon.expires_at
    );
  end if;

  v_tax := round(((v_subtotal - v_discount) * v_loc.tax_rate)::numeric, 2);
  v_total := greatest(v_subtotal - v_discount + v_tax, c_minfee);

  return jsonb_build_object(
    'location_id', v_location_id,
    'currency', v_loc.currency,
    'subtotal', round(v_subtotal,2),
    'discount_amount', round(v_discount,2),
    'coupon', coalesce(v_coupon_json, 'null'::jsonb),
    'tax_amount', v_tax,
    'shipping_amount', 0,
    'min_order_fee', c_minfee,
    'total_amount', round(v_total,2),
    'lines', to_jsonb(v_lines)
  );
end;
$$;

grant execute on function public.price_cart(jsonb) to anon,authenticated,service_role;
