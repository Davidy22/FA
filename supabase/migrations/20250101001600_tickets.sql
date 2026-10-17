-- Quote & help tickets. The /quote page is a contact form (message + file
-- attachments) that opens a ticket; customers and staff reply in a thread;
-- staff can attach a price quote that the customer accepts into the cart.

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  customer_name text,
  customer_email text,
  location_id uuid references public.locations(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 140),
  status text not null default 'open'
    check (status in ('open','answered','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tickets_updated_at before update on public.tickets
  for each row execute function public.tg_set_updated_at();

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text,
  author_role text default 'customer'
    check (author_role in ('customer','employee','manager','admin')),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  file_path varchar(500) not null,
  original_filename varchar(255) not null,
  file_size int check (file_size is null or file_size > 0),
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.ticket_quotes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  staff_name text,
  description text not null check (char_length(description) between 1 and 500),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity int not null default 1 check (quantity between 1 and 99),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','expired','ordered')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ticket_quotes_updated_at before update on public.ticket_quotes
  for each row execute function public.tg_set_updated_at();

alter table public.order_items
  add column ticket_quote_id uuid references public.ticket_quotes(id) on delete set null;

alter type public.price_line add attribute ticket_quote_id uuid;

-- Keep ticket.updated_at fresh so lists sort by latest activity.
create or replace function public.tg_ticket_touch()
returns trigger language plpgsql as $$
begin
  update public.tickets set updated_at = now() where id = new.ticket_id;
  return new;
end; $$;

create trigger ticket_messages_touch after insert on public.ticket_messages
  for each row execute function public.tg_ticket_touch();
create trigger ticket_attachments_touch after insert on public.ticket_attachments
  for each row execute function public.tg_ticket_touch();
create trigger ticket_quotes_touch after insert or update on public.ticket_quotes
  for each row execute function public.tg_ticket_touch();

-- Private bucket: attachments live under <user-id>/<ticket-id>/<file>
insert into storage.buckets(id, name, public)
values ('ticket-uploads', 'ticket-uploads', false)
on conflict (id) do nothing;

create policy "owner write ticket uploads" on storage.objects
  for insert with check (
    bucket_id = 'ticket-uploads' and (auth.uid()::text) = (storage.foldername(name))[1]
  );
create policy "owner read own ticket uploads" on storage.objects
  for select using (
    bucket_id = 'ticket-uploads' and (auth.uid()::text) = (storage.foldername(name))[1]
  );

-- ------- RLS -------
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_quotes enable row level security;

-- tickets: owner full control; staff read/update at the ticket's location
create policy tickets_owner_all on public.tickets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tickets_staff_read on public.tickets
  for select using (public.is_staff_at(location_id));
create policy tickets_staff_update on public.tickets
  for update using (public.is_staff_at(location_id))
  with check (public.is_staff_at(location_id));
create policy tickets_admin_all on public.tickets
  for all using (public.is_admin()) with check (public.is_admin());

-- messages: participants read; owner or staff-at-location write
create policy ticket_messages_participants_read on public.ticket_messages
  for select using (
    exists (select 1 from public.tickets t
            where t.id = ticket_id
              and (t.user_id = auth.uid() or public.is_staff_at(t.location_id)))
  );
create policy ticket_messages_owner_insert on public.ticket_messages
  for insert with check (
    auth.uid() = author_id
    and exists (select 1 from public.tickets t
                where t.id = ticket_id and t.user_id = auth.uid())
  );
create policy ticket_messages_staff_insert on public.ticket_messages
  for insert with check (
    auth.uid() = author_id
    and exists (select 1 from public.tickets t
                where t.id = ticket_id and public.is_staff_at(t.location_id))
  );
create policy ticket_messages_admin_all on public.ticket_messages
  for all using (public.is_admin()) with check (public.is_admin());

-- attachments: same matrix as messages
create policy ticket_attachments_participants_read on public.ticket_attachments
  for select using (
    exists (select 1 from public.tickets t
            where t.id = ticket_id
              and (t.user_id = auth.uid() or public.is_staff_at(t.location_id)))
  );
create policy ticket_attachments_owner_insert on public.ticket_attachments
  for insert with check (
    auth.uid() = uploaded_by
    and exists (select 1 from public.tickets t
                where t.id = ticket_id and t.user_id = auth.uid())
  );
create policy ticket_attachments_staff_insert on public.ticket_attachments
  for insert with check (
    auth.uid() = uploaded_by
    and exists (select 1 from public.tickets t
                where t.id = ticket_id and public.is_staff_at(t.location_id))
  );
create policy ticket_attachments_admin_all on public.ticket_attachments
  for all using (public.is_admin()) with check (public.is_admin());

-- quotes: staff at the ticket's location create them; participants read
create policy ticket_quotes_participants_read on public.ticket_quotes
  for select using (
    exists (select 1 from public.tickets t
            where t.id = ticket_id
              and (t.user_id = auth.uid() or public.is_staff_at(t.location_id)))
  );
create policy ticket_quotes_staff_insert on public.ticket_quotes
  for insert with check (
    exists (select 1 from public.tickets t
            where t.id = ticket_id and public.is_staff_at(t.location_id))
  );
create policy ticket_quotes_staff_update on public.ticket_quotes
  for update using (
    exists (select 1 from public.tickets t
            where t.id = ticket_id and public.is_staff_at(t.location_id))
  ) with check (
    exists (select 1 from public.tickets t
            where t.id = ticket_id and public.is_staff_at(t.location_id))
  );
create policy ticket_quotes_admin_all on public.ticket_quotes
  for all using (public.is_admin()) with check (public.is_admin());

-- ------- accept_ticket_quote RPC (customer accepts a pending quote) -------
create or replace function public.accept_ticket_quote(p_quote_id uuid)
returns public.ticket_quotes
language plpgsql security definer set search_path = public
as $$
declare
  v_q public.ticket_quotes;
  v_t public.tickets;
begin
  select * into v_q from public.ticket_quotes where id = p_quote_id;
  if not found then raise exception 'Quote not found'; end if;
  select * into v_t from public.tickets where id = v_q.ticket_id;
  if v_t.user_id <> auth.uid() then raise exception 'Not your quote'; end if;
  if v_q.status <> 'pending' then raise exception 'Quote already handled'; end if;
  if v_q.expires_at < now() then
    update public.ticket_quotes set status = 'expired' where id = p_quote_id;
    raise exception 'Quote expired';
  end if;
  update public.ticket_quotes
     set status = 'accepted'
   where id = p_quote_id
  returning * into v_q;
  return v_q;
end;
$$;

grant execute on function public.accept_ticket_quote(uuid) to authenticated;

-- ------- price_cart: add the 'ticket' line kind -------
-- Input cart items may include:
--   { kind: 'ticket', ticket_quote_id: uuid, quantity: int }
-- Pricing is authoritative from the ticket_quotes row (staff-set price),
-- the quote must be accepted by the ticket owner and unexpired.
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
  -- ticket vars
  v_tq public.ticket_quotes;
  v_ticket public.tickets;
  v_cart_user uuid;
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
    v_item := v_item.elem;
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

  v_tax := round((v_subtotal * v_loc.tax_rate)::numeric, 2);
  v_total := greatest(v_subtotal + v_tax, c_minfee);

  return jsonb_build_object(
    'location_id', v_location_id,
    'currency', v_loc.currency,
    'subtotal', round(v_subtotal,2),
    'tax_amount', v_tax,
    'shipping_amount', 0,
    'min_order_fee', c_minfee,
    'total_amount', round(v_total,2),
    'lines', to_jsonb(v_lines)
  );
end;
$$;

grant execute on function public.price_cart(jsonb) to anon, authenticated, service_role;

-- ------- create_order_from_cart: persist ticket quotes on order items -------
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
begin
  select * into v_sess from public.checkout_sessions where session_id = p_session_id;
  if not found then raise exception 'Checkout session not found'; end if;

  v_pricing := public.price_cart(v_sess.cart);

  -- Create order
  insert into public.orders(
    order_number, user_id, location_id, contact_name, contact_email, locale,
    status, subtotal, tax_amount, shipping_amount, total_amount, currency,
    stripe_session_id, stripe_payment_intent_id
  ) values (
    public.next_order_number(),
    coalesce(p_user_id, v_sess.user_id),
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
    p_session_id,
    p_stripe_payment_intent_id
  ) returning * into v_order;

  select value into v_comm_val from public.platform_settings where key='platform.commission_percent';
  v_commission := coalesce((v_comm_val#>>'{}')::numeric, 15) / 100.0;

  -- Create items
  for v_line in select jsonb_array_elements(v_pricing->'lines') as elem
  loop
    v_line := v_line.elem;
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
  if coalesce(p_user_id, v_sess.user_id) is not null then
    delete from public.cart_items ci
      using public.carts c
      where c.id = ci.cart_id and c.user_id = coalesce(p_user_id, v_sess.user_id);
  end if;

  return v_order;
end;
$$;

grant execute on function public.create_order_from_cart(text,uuid,uuid,text,text,text,text) to service_role;

-- Indexes
create index tickets_user_updated_idx on public.tickets(user_id, updated_at desc);
create index tickets_location_status_idx on public.tickets(location_id, status, updated_at desc);
create index ticket_messages_ticket_idx on public.ticket_messages(ticket_id, created_at);
create index ticket_attachments_ticket_idx on public.ticket_attachments(ticket_id);
create index ticket_quotes_ticket_idx on public.ticket_quotes(ticket_id, created_at);
