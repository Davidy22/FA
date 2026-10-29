-- Restore coupon and document checkout after the ticket migration replaced both
-- RPC bodies. Keep ticket lines, validate configurable product options, and use
-- the admin-controlled document rates. This is a forward-only correction.

-- A webhook retry must not create a second order or award points twice.
create unique index if not exists orders_stripe_session_unique
  on public.orders(stripe_session_id) where stripe_session_id is not null;

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
    if v_qty < 1 or v_qty > 99 then raise exception 'Invalid quantity'; end if;

    if v_item->>'kind' = 'document' then
      if v_cart_user is null then raise exception 'Sign in to upload documents'; end if;
      if v_item->>'color' not in ('grayscale','color') then raise exception 'Invalid print color'; end if;
      if jsonb_typeof(v_item->'duplex') is distinct from 'boolean' then raise exception 'Invalid duplex setting'; end if;
      if (v_item->>'pages')::int not between 1 and 500 then raise exception 'Page count must be 1 to 500'; end if;
      if v_item->>'file_path' not like (v_cart_user::text || '/%') then raise exception 'Invalid document path'; end if;
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
            v_options_modifier := v_options_modifier + coalesce(v_choice.price_modifier, 0);
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
            v_options_modifier := v_options_modifier + coalesce(v_choice.price_modifier, 0);
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

      v_unit := v_prod.base_price + v_modifier + v_options_modifier;
      if v_unit < 0 then v_unit := 0; end if;
      v_line.unit_price := v_unit;
      v_line_total := v_unit * v_qty;
      v_line.line_total := v_line_total;
      v_line.description := v_prod.name;
      v_line.creator_id := v_prod.submitted_by;

      v_snapshot := jsonb_build_object(
        'kind','premade',
        'product_id', v_prod.id,
        'name', v_prod.name,
        'slug', v_prod.slug,
        'base_price', v_prod.base_price,
        'material', jsonb_build_object('id', v_mat.id, 'slug', v_mat.slug, 'name', v_mat.name, 'adjective', v_mat.adjective),
        'material_price_modifier', v_modifier,
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

  if v_subtotal < c_minfee and v_subtotal > 0 then
    -- Apply min-order fee as a top-up against subtotal (transparent: add line handled by UI)
    null; -- we leave raw subtotal; total floors to minfee
  end if;

  -- The authenticated buyer id is verified by stripe-checkout before payment.
  -- An unassigned coupon can also be used by a guest.
  v_coupon_code := nullif(btrim(coalesce(p_cart->>'coupon_code', '')), '');
  if v_coupon_code is not null then
    v_coupon := public._active_coupon(v_coupon_code, v_cart_user);
    v_discount := public._coupon_discount(v_coupon, v_subtotal);
    v_coupon_json := jsonb_build_object(
      'code', v_coupon.code, 'discount_type', v_coupon.discount_type,
      'discount_value', v_coupon.discount_value, 'discount_amount', round(v_discount, 2),
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

  -- Lock and consume the single-use coupon in the same transaction as the order.
  v_coupon_code := nullif(btrim(coalesce(v_sess.cart->>'coupon_code', '')), '');
  if v_coupon_code is not null then
    select * into v_coupon from public.coupons where code = upper(v_coupon_code) for update;
    v_coupon := public._active_coupon(v_coupon_code, v_buyer);
    if public._coupon_discount(v_coupon, (v_pricing->>'subtotal')::numeric)
       <> (v_pricing->>'discount_amount')::numeric then
      raise exception 'Coupon is no longer valid for this order';
    end if;
    update public.coupons set status = 'used', used_order_id = v_order.id, used_at = now()
      where id = v_coupon.id and status = 'active';
    if not found then raise exception 'Coupon already used'; end if;
  end if;

  select value into v_comm_val from public.platform_settings where key='platform.commission_percent';
  v_commission := coalesce((v_comm_val#>>'{}')::numeric, 15) / 100.0;

  -- Create items
  for v_line in select jsonb_array_elements(v_pricing->'lines') as elem
  loop
    insert into public.order_items(
      order_id, premade_product_id, quote_request_id, ticket_quote_id,
      material_id, color_filament_id,
      quantity, unit_price, item_snapshot, creator_id
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
