-- Coupon-aware checkout RPCs.
-- create or replace (forward-only): price_cart now validates a cart-level coupon_code and
-- returns the discount; create_order_from_cart snapshots the discount onto the order and
-- consumes the coupon. Also fixes two latent runtime bugs in the original bodies
-- (`v_item := v_item.elem` / `v_line := v_line.elem`), which plpgsql rejects at execution
-- time (suppressed at creation time because check_function_bodies is off).

-- ------- price_cart RPC (v2: coupon support) -------
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
    v_line.line_id := i;
    v_line.kind := v_item->>'kind';
    v_line.options_json := coalesce(v_item->'options', '{}'::jsonb);
    v_qty := coalesce((v_item->>'quantity')::int, 1);
    v_line.quantity := v_qty;
    v_options_modifier := 0;
    v_modifier := 0;

    if v_item->>'kind' = 'premade' then
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

grant execute on function public.price_cart(jsonb) to anon, authenticated, service_role;

-- ------- create_order_from_cart RPC (v2: coupon consumption) -------
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
begin
  select * into v_sess from public.checkout_sessions where session_id = p_session_id;
  if not found then raise exception 'Checkout session not found'; end if;

  v_pricing := public.price_cart(v_sess.cart);

  v_buyer := coalesce(p_user_id, v_sess.user_id);

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

  -- Consume the coupon (if any): lock the row, re-validate, mark used.
  -- price_cart above already validated it; the lock closes the gap before marking.
  v_coupon_code := nullif(btrim(coalesce(v_sess.cart->>'coupon_code', '')), '');
  if v_coupon_code is not null then
    select * into v_coupon from public.coupons
     where code = upper(v_coupon_code)
     for update;
    v_coupon := public._active_coupon(v_coupon_code, v_buyer);
    if public._coupon_discount(v_coupon, (v_pricing->>'subtotal')::numeric)
       <> (v_pricing->>'discount_amount')::numeric then
      raise exception 'Coupon is no longer valid for this order';
    end if;
    update public.coupons
       set status = 'used', used_order_id = v_order.id, used_at = now()
     where id = v_coupon.id and status = 'active';
    if not found then raise exception 'Coupon already used'; end if;
  end if;

  select value into v_comm_val from public.platform_settings where key='platform.commission_percent';
  v_commission := coalesce((v_comm_val#>>'{}')::numeric, 15) / 100.0;

  -- Create items
  for v_line in select jsonb_array_elements(v_pricing->'lines') as elem
  loop
    -- FOR-loop target is scalar jsonb: each iteration already holds the element.
    insert into public.order_items(
      order_id, premade_product_id, quote_request_id, material_id, color_filament_id,
      quantity, unit_price, item_snapshot, creator_id
    ) values (
      v_order.id,
      (v_line->>'product_id')::uuid,
      (v_line->>'quote_request_id')::uuid,
      (v_line->>'material_id')::uuid,
      (v_line->>'color_filament_id')::uuid,
      (v_line->>'quantity')::int,
      (v_line->>'unit_price')::numeric,
      v_line->'item_snapshot',
      (v_line->>'creator_id')::uuid
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

grant execute on function public.create_order_from_cart(text,uuid,uuid,text,text,text,text) to service_role;

-- ------- lookup_order RPC (guest lookup, v2) -------
-- Fixed: the original `returns public.orders` (non-SETOF) SQL function returns a
-- single row of NULLs when nothing matches, so callers could not tell "not found"
-- from a real match. SETOF returns zero rows on no match.
drop function if exists public.lookup_order(text, text);
create function public.lookup_order(p_order_number text, p_email text)
returns setof public.orders
language sql stable security definer
set search_path = public
as $$
  select * from public.orders
  where order_number = p_order_number
    and lower(contact_email) = lower(p_email)
  limit 1;
$$;

grant execute on function public.lookup_order(text, text) to anon, authenticated;
