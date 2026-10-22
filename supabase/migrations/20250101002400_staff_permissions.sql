-- Granular staff permissions.
--
-- Employee/manager accounts can now be granted individual capabilities instead
-- of all-or-nothing staff access. Every check on the server goes through
-- public.has_permission(); 'admin.full' is the "full admin powers" switch and
-- is treated as true for every key (it also makes is_admin() true, so the
-- existing admin-only RLS policies apply unchanged).
--
-- Permission keys (keep web/src/lib/permissions.ts in sync):
--   admin.full          full admin powers; implies every other key
--   products.manage     products, categories, materials, filaments, stock
--   coupons.manage      coupons, offer codes and claims
--   jobs.manage         careers job listings
--   quotes.manage       quotation requests and quote/help tickets (chain-wide)
--   orders.manage       orders at any location (chain-wide fulfilment)
--   users.manage        customer/staff accounts and permission assignment
--   payouts.manage      creator payouts and earnings
--   submissions.review  community model submissions
--   locations.manage    locations, map pins, currency and tax
--   settings.manage     platform settings and feature switches

alter table public.profiles
  add column if not exists permissions text[] not null default '{}';

alter table public.profiles
  drop constraint if exists profiles_permissions_valid;
alter table public.profiles
  add constraint profiles_permissions_valid check (
    permissions <@ array[
      'admin.full', 'products.manage', 'coupons.manage', 'jobs.manage',
      'quotes.manage', 'orders.manage', 'users.manage', 'payouts.manage',
      'submissions.review', 'locations.manage', 'settings.manage'
    ]::text[]
  );

-- The canonical list, used by admin_set_user_permissions() to reject typos.
create or replace function public.permission_keys()
returns text[]
language sql immutable
set search_path = public
as $$
  select array[
    'admin.full', 'products.manage', 'coupons.manage', 'jobs.manage',
    'quotes.manage', 'orders.manage', 'users.manage', 'payouts.manage',
    'submissions.review', 'locations.manage', 'settings.manage'
  ]::text[];
$$;

-- True when the signed-in staff member may use the module named by p_key.
-- Customers never hold permissions; inactive accounts never hold any.
create or replace function public.has_permission(p_key text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.id is null or not p.is_active then false
      when p.role = 'admin' then true
      when p.role in ('employee', 'manager')
        and ('admin.full' = any(p.permissions) or p_key = any(p.permissions)) then true
      else false
    end
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

-- "Full admin powers" makes an employee an admin for every existing policy and
-- RPC. Role-based safety rails (the last active admin) still count only rows
-- with role = 'admin', so the store can never lose its real owner account.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select p.is_active and (p.role = 'admin' or 'admin.full' = any(p.permissions))
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

-- ------- account management RPCs -------

-- Only users.manage holders (or admins) may change accounts. Managers keep the
-- existing ability to manage their own location's staff.
create or replace function public.admin_update_user(
  p_user_id uuid, p_role text, p_location_id uuid, p_display_name text
)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles;
  v_updated public.profiles;
begin
  if not public.has_permission('users.manage') then raise exception 'Not permitted to change users'; end if;
  if p_role is null or p_role not in ('customer','employee','manager','admin') then
    raise exception 'Invalid role';
  end if;
  if p_role in ('employee','manager') and not exists (
    select 1 from public.locations where id = p_location_id and is_active = true
  ) then raise exception 'Staff require an active location'; end if;

  perform pg_advisory_xact_lock(hashtext('ma.admin_users'));
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin' and v_target.role = 'admin' then
    raise exception 'You cannot remove your own admin role';
  end if;
  if v_target.role = 'admin' and v_target.is_active and p_role <> 'admin' and
     (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'The last active admin cannot be demoted';
  end if;

  update public.profiles set role = p_role,
    location_id = case when p_role in ('employee','manager') then p_location_id else null end,
    display_name = nullif(btrim(p_display_name), ''),
    -- Only staff roles can carry module permissions.
    permissions = case when p_role in ('employee','manager') then permissions else '{}'::text[] end
  where id = p_user_id returning * into v_updated;
  return v_updated;
end;
$$;
revoke all on function public.admin_update_user(uuid,text,uuid,text) from public;
grant execute on function public.admin_update_user(uuid,text,uuid,text) to authenticated;

create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles;
begin
  if not public.has_permission('users.manage') then raise exception 'Not permitted to change users'; end if;
  if p_active is null then raise exception 'Active flag is required'; end if;
  perform pg_advisory_xact_lock(hashtext('ma.admin_users'));
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if p_user_id = auth.uid() and not p_active then
    raise exception 'You cannot deactivate your own account';
  end if;
  if v_target.role = 'admin' and v_target.is_active and not p_active and
     (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'The last active admin cannot be deactivated';
  end if;
  update public.profiles set is_active = p_active where id = p_user_id;
end;
$$;
revoke all on function public.set_user_active(uuid,boolean) from public;
grant execute on function public.set_user_active(uuid,boolean) to authenticated;

create or replace function public.create_staff(
  p_email text, p_display_name text, p_role text, p_location_id uuid,
  p_password text default null
)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_updated public.profiles;
  v_can_manage boolean;
begin
  select * into v_actor from public.profiles where id = auth.uid() and is_active;
  v_can_manage := public.has_permission('users.manage');
  if not found or not (v_can_manage or
      (v_actor.role = 'manager' and v_actor.location_id = p_location_id)) then
    raise exception 'Not permitted to create staff';
  end if;
  if p_role not in ('employee','manager') then raise exception 'Invalid staff role'; end if;
  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Staff require an active location';
  end if;
  select * into v_target from public.profiles where email = lower(btrim(p_email)) for update;
  if not found then raise exception 'User must be invited through the create-staff Edge Function first'; end if;
  if v_target.role = 'admin' or (not v_can_manage and
      (not v_target.is_active or (v_target.role <> 'customer' and v_target.location_id is distinct from p_location_id))) then
    raise exception 'Not permitted to change this user';
  end if;
  update public.profiles set role = p_role, location_id = p_location_id,
    display_name = coalesce(nullif(btrim(p_display_name), ''), display_name), is_active = true
  where id = v_target.id returning * into v_updated;
  return v_updated;
end;
$$;
revoke all on function public.create_staff(text,text,text,uuid,text) from public;
grant execute on function public.create_staff(text,text,text,uuid,text) to authenticated;

-- Assign module permissions to an employee or manager. Admins always hold
-- everything, so their rows stay empty. Customers cannot hold permissions.
create or replace function public.admin_set_user_permissions(
  p_user_id uuid, p_permissions text[]
)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles;
  v_clean text[] := '{}'::text[];
  v_key text;
begin
  if not public.has_permission('users.manage') then
    raise exception 'Not permitted to change permissions';
  end if;
  if p_permissions is null then raise exception 'Permissions are required'; end if;
  foreach v_key in array p_permissions loop
    if v_key is null or not (v_key = any (public.permission_keys())) then
      raise exception 'Unknown permission: %', coalesce(v_key, 'null');
    end if;
    if not (v_key = any (v_clean)) then v_clean := v_clean || v_key; end if;
  end loop;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  -- Granting or revoking full admin powers is itself an admin act: a user with
  -- users.manage must not be able to promote themselves past their own grant.
  if (('admin.full' = any(v_target.permissions)) is distinct from ('admin.full' = any(p_permissions)))
     and not public.is_admin() then
    raise exception 'Only an admin can grant or revoke full admin powers';
  end if;

  if v_target.role = 'admin' then
    -- An admin already holds every power; keep the column clean.
    v_clean := '{}'::text[];
  elsif v_target.role not in ('employee','manager') and cardinality(v_clean) > 0 then
    raise exception 'Permissions apply to staff accounts only';
  end if;

  update public.profiles set permissions = v_clean
  where id = p_user_id returning * into v_target;
  return v_target;
end;
$$;
revoke all on function public.admin_set_user_permissions(uuid,text[]) from public;
grant execute on function public.admin_set_user_permissions(uuid,text[]) to authenticated;

-- ------- RLS: module permissions -------
-- Each block adds a permissive policy next to the existing admin ones. Admins
-- and admin.full holders already pass is_admin(); these policies are what gives
-- a single module to an otherwise ordinary employee.

-- products.manage (catalog, categories, materials, filaments, stock)
create policy products_perm_all on public.premade_products
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy product_materials_perm_all on public.product_materials
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy option_groups_perm_all on public.product_option_groups
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy option_choices_perm_all on public.product_option_choices
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy text_option_config_perm_all on public.text_option_config
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy file_option_config_perm_all on public.file_option_config
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy materials_perm_all on public.materials
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy filaments_perm_all on public.filaments
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
create policy location_filaments_perm_all on public.location_filaments
  for all to authenticated using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));

-- coupons.manage
create policy coupons_perm_all on public.coupons
  for all to authenticated using (public.has_permission('coupons.manage'))
  with check (public.has_permission('coupons.manage'));
create policy offer_codes_perm_all on public.offer_codes
  for all to authenticated using (public.has_permission('coupons.manage'))
  with check (public.has_permission('coupons.manage'));
create policy offer_claims_perm_all on public.offer_claims
  for all to authenticated using (public.has_permission('coupons.manage'))
  with check (public.has_permission('coupons.manage'));

-- quotes.manage: quotation requests and the ticket threads around them.
create policy quote_requests_perm_all on public.quote_requests
  for all to authenticated using (public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.manage'));
create policy uploaded_models_perm_read on public.uploaded_models
  for select to authenticated using (public.has_permission('quotes.manage'));
create policy tickets_perm_all on public.tickets
  for all to authenticated using (public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.manage'));
create policy ticket_messages_perm_all on public.ticket_messages
  for all to authenticated using (public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.manage'));
create policy ticket_attachments_perm_all on public.ticket_attachments
  for all to authenticated using (public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.manage'));
create policy ticket_quotes_perm_all on public.ticket_quotes
  for all to authenticated using (public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.manage'));

-- orders.manage: read and fulfil orders chain-wide.
create policy orders_perm_read on public.orders
  for select to authenticated using (public.has_permission('orders.manage'));
create policy orders_perm_update on public.orders
  for update to authenticated using (public.has_permission('orders.manage'))
  with check (public.has_permission('orders.manage'));
create policy order_items_perm_read on public.order_items
  for select to authenticated using (public.has_permission('orders.manage'));
create policy order_option_values_perm_read on public.order_item_option_values
  for select to authenticated using (public.has_permission('orders.manage'));
create policy order_notes_perm_all on public.order_notes
  for all to authenticated using (public.has_permission('orders.manage'))
  with check (public.has_permission('orders.manage'));

-- users.manage: see every account, including customers.
create policy profiles_perm_read on public.profiles
  for select to authenticated using (public.has_permission('users.manage'));

-- payouts.manage
create policy payouts_perm_all on public.payouts
  for all to authenticated using (public.has_permission('payouts.manage'))
  with check (public.has_permission('payouts.manage'));
create policy earnings_perm_read on public.creator_earnings
  for select to authenticated using (public.has_permission('payouts.manage'));

-- submissions.review
create policy submissions_perm_all on public.model_submissions
  for all to authenticated using (public.has_permission('submissions.review'))
  with check (public.has_permission('submissions.review'));
create policy submission_materials_perm_all on public.model_submission_materials
  for all to authenticated using (public.has_permission('submissions.review'))
  with check (public.has_permission('submissions.review'));

-- locations.manage
create policy locations_perm_all on public.locations
  for all to authenticated using (public.has_permission('locations.manage'))
  with check (public.has_permission('locations.manage'));

-- settings.manage
create policy settings_perm_all on public.platform_settings
  for all to authenticated using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));

-- ------- permission-aware RPCs -------

-- admin_save_product: products.manage may now edit the catalog.
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
begin
  if not public.has_permission('products.manage') then
    raise exception 'Not permitted to manage products';
  end if;
  if jsonb_typeof(p_product) is distinct from 'object'
     or jsonb_typeof(p_materials) is distinct from 'array'
     or jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Invalid product payload';
  end if;
  if nullif(btrim(p_product->>'slug'), '') is null or
     nullif(btrim(p_product->'name'->>'en'), '') is null or
     nullif(btrim(p_product->>'source_model_path'), '') is null then
    raise exception 'Product slug, English name, and model file are required';
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
    insert into public.premade_products(
      slug, name, description, base_price, default_material_id, category, tags,
      image_urls, source_model_path, is_featured, status,
      sale_price, sale_starts_at, sale_ends_at
    ) values (
      p_product->>'slug', p_product->'name', p_product->'description',
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
  for v_slot in select value from jsonb_array_elements(p_slots) loop
    insert into public.product_material_slots(product_id, name, sort_order)
    values (v_product.id, v_slot->'name', coalesce((v_slot->>'sort_order')::smallint, 0))
    returning * into v_slot_row;

    insert into public.product_slot_materials(slot_id, material_id, price_modifier)
      select v_slot_row.id, (m->>'material_id')::uuid, coalesce((m->>'price_modifier')::numeric, 0)
        from jsonb_array_elements(v_slot->'materials') m;

    -- Defaults are set last so the eligibility trigger always sees a full list.
    update public.product_material_slots
       set default_material_id = nullif(v_slot->>'default_material_id', '')::uuid,
           default_filament_id = nullif(v_slot->>'default_filament_id', '')::uuid
     where id = v_slot_row.id;
  end loop;

  return v_product;
end;
$$;
revoke all on function public.admin_save_product(jsonb, jsonb, jsonb) from public;
grant execute on function public.admin_save_product(jsonb, jsonb, jsonb) to authenticated;

-- admin_generate_coupons: coupons.manage may now issue batches.
create or replace function public.admin_generate_coupons(
  p_count int,
  p_prefix text default null,
  p_discount_type text default 'fixed',
  p_discount_value numeric default 5,
  p_min_subtotal numeric default null,
  p_product_id uuid default null,
  p_expires_at timestamptz default null,
  p_user_id uuid default null
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
  if p_discount_value is null or p_discount_value <= 0 or p_discount_value > 99999999 then
    raise exception 'Invalid discount amount';
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
                                   min_subtotal, product_id, expires_at)
        values (public._coupon_code(v_prefix, 10), p_user_id, 'admin',
                p_discount_type, p_discount_value, p_min_subtotal, p_product_id, p_expires_at)
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

revoke all on function public.admin_generate_coupons(int,text,text,numeric,numeric,uuid,timestamptz,uuid) from public;
grant execute on function public.admin_generate_coupons(int,text,text,numeric,numeric,uuid,timestamptz,uuid) to authenticated;

-- admin_decide_submission: submissions.review may now review.
create or replace function public.admin_decide_submission(
  p_submission_id uuid, p_action text, p_notes text,
  p_edits jsonb default '{}'::jsonb, p_model_path text default null
)
returns public.model_submissions language plpgsql security definer set search_path = public as $$
declare
  v_submission public.model_submissions;
  v_materials jsonb;
  v_product public.premade_products;
  v_base_slug text;
begin
  if not public.has_permission('submissions.review') then
    raise exception 'Not permitted to review submissions';
  end if;
  if p_action not in ('approve','reject','changes_requested') or p_action is null then
    raise exception 'Invalid review action';
  end if;
  if p_action <> 'approve' and nullif(btrim(p_notes), '') is null then
    raise exception 'Review notes are required';
  end if;
  select * into v_submission from public.model_submissions
    where id = p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_submission.status not in ('pending_review','changes_requested') then
    raise exception 'This submission has already been reviewed';
  end if;

  if p_action = 'approve' then
    if nullif(btrim(p_model_path), '') is null then raise exception 'Model upload is required'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('material_id',material_id,'price_modifier',price_modifier)),
      '[]'::jsonb) into v_materials from public.model_submission_materials
      where submission_id = p_submission_id;
    v_materials := coalesce(p_edits->'materials', v_materials);
    v_base_slug := coalesce(nullif(btrim(p_edits->>'slug'), ''),
      p_edits->'name'->>'en', v_submission.title->>'en', 'model');
    v_base_slug := coalesce(nullif(trim(both '-' from
      regexp_replace(lower(v_base_slug), '[^a-z0-9]+', '-', 'g')), ''), 'model');
    select * into v_product from public.admin_save_product(jsonb_build_object(
      'slug', v_base_slug || '-' || left(replace(p_submission_id::text, '-', ''), 8),
      'name', coalesce(p_edits->'name', v_submission.title),
      'description', coalesce(p_edits->'description', v_submission.description),
      'base_price', coalesce(p_edits->'base_price', to_jsonb(v_submission.base_price)),
      'default_material_id', coalesce(p_edits->>'default_material_id', v_materials->0->>'material_id'),
      'category', coalesce(p_edits->>'category', v_submission.category),
      'tags', coalesce(p_edits->'tags', to_jsonb(v_submission.tags)),
      'image_urls', coalesce(p_edits->'image_urls', v_submission.preview_urls),
      'source_model_path', p_model_path, 'is_featured', false, 'status', 'published'
    ), v_materials);
    update public.premade_products set submitted_by = v_submission.submitter_id,
      source_submission_id = v_submission.id where id = v_product.id;
    update public.profiles set is_creator = true where id = v_submission.submitter_id;
  end if;

  update public.model_submissions set
    status = case when p_action = 'approve' then 'approved' else p_action end,
    review_notes = nullif(btrim(p_notes), ''), reviewed_by = auth.uid(),
    reviewed_at = now(),
    published_product_id = case when p_action = 'approve' then v_product.id else published_product_id end
  where id = p_submission_id returning * into v_submission;
  return v_submission;
end;
$$;
revoke all on function public.admin_decide_submission(uuid,text,text,jsonb,text) from public;
grant execute on function public.admin_decide_submission(uuid,text,text,jsonb,text) to authenticated;

-- admin_decide_payout: payouts.manage may now settle payouts.
create or replace function public.admin_decide_payout(
  p_payout_id uuid, p_status text, p_reference text default null
)
returns public.payouts language plpgsql security definer set search_path = public as $$
declare
  v_payout public.payouts;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Not permitted to manage payouts';
  end if;
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'Payout not found'; end if;
  if (v_payout.status = 'requested' and p_status not in ('processing','paid','rejected')) or
     (v_payout.status = 'processing' and p_status not in ('paid','rejected')) or
     v_payout.status in ('paid','rejected') or p_status is null then
    raise exception 'Invalid payout transition';
  end if;
  if p_status = 'paid' and nullif(btrim(p_reference), '') is null then
    raise exception 'A transfer reference is required';
  end if;
  update public.payouts set status = p_status,
    reference = coalesce(nullif(btrim(p_reference), ''), reference),
    processed_by = case when p_status in ('paid','rejected') then auth.uid() else null end,
    processed_at = case when p_status in ('paid','rejected') then now() else null end
  where id = p_payout_id returning * into v_payout;
  return v_payout;
end;
$$;
revoke all on function public.admin_decide_payout(uuid,text,text) from public;
grant execute on function public.admin_decide_payout(uuid,text,text) to authenticated;
