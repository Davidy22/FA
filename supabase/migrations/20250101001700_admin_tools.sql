-- Admin tools: keep privileged writes on the server, and keep deactivated staff
-- from retaining RLS privileges through an unexpired JWT.

-- Internal order notes must not be readable by customers.
drop policy if exists order_notes_customer_read on public.order_notes;

-- Staff must still be able to retrieve a model for an order after its product
-- is archived; they cannot browse unrelated draft/archived products.
create policy products_staff_order_read on public.premade_products
  for select to authenticated using (
    exists (select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.premade_product_id = premade_products.id and public.is_staff_at(o.location_id))
  );

-- Creator submissions are built as drafts, materials are inserted, then they
-- move to pending_review. Allow cleanup of failed drafts and unreferenced
-- uploads without letting creators remove already-submitted/approved models.
create policy submissions_owner_delete_draft on public.model_submissions
  for delete to authenticated using (submitter_id = auth.uid() and status = 'draft');
create policy "owner cleanup draft submission upload" on storage.objects
  for delete to authenticated using (
    bucket_id = 'submission-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (select 1 from public.model_submissions s
      where s.model_path = name and s.status not in ('draft','changes_requested'))
  );

-- The original seed referenced this material's filament before inserting the
-- material. Fresh installs are fixed in 006; backfill already-running installs.
insert into public.materials(id,slug,name,adjective,density_g_cm3,default_flow_mm3_s,is_active,sort_order)
values ('11111111-1111-1111-1111-000000000005','nylon',
  '{"en":"Nylon","zh-Hant":"尼龍","zh-Hans":"尼龙"}'::jsonb,
  '{"en":"Strong and wear-resistant","zh-Hant":"堅固耐磨","zh-Hans":"坚固耐磨"}'::jsonb,
  1.14,4.5,true,50)
on conflict (id) do nothing;

create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid() and is_active), 'anon');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and is_active), false);
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('employee','manager','admin')
                     from public.profiles where id = auth.uid() and is_active), false);
$$;

create or replace function public.is_staff_at(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(
    (select role in ('employee','manager') and location_id = loc
       from public.profiles where id = auth.uid() and is_active), false);
$$;

-- The first admin can be bootstrapped through an allowlisted, verified email
-- in the bootstrap-admin Edge Function. Only the server-side service role may
-- call this one-time RPC; the transaction lock prevents two simultaneous claims.
create or replace function public.bootstrap_admin(p_user_id uuid, p_email text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles;
begin
  perform pg_advisory_xact_lock(hashtext('make-anything:bootstrap-admin'));
  if exists (select 1 from public.profiles where role = 'admin' and is_active) then
    raise exception 'An active admin already exists';
  end if;
  select * into v_profile from public.profiles
    where id = p_user_id and lower(email) = lower(btrim(p_email)) and is_active
    for update;
  if not found then raise exception 'Eligible account not found'; end if;
  update public.profiles set role = 'admin', location_id = null
    where id = p_user_id returning * into v_profile;
  return v_profile;
end;
$$;
revoke all on function public.bootstrap_admin(uuid,text) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(uuid,text) to service_role;

-- Profile role/location/active columns are not writable by browser clients.
-- This RPC checks the calling JWT, locks the target, and never allows the last
-- active admin (or the current admin) to be demoted.
create or replace function public.admin_update_user(
  p_user_id uuid, p_role text, p_location_id uuid, p_display_name text
)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles;
  v_updated public.profiles;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_role is null or p_role not in ('customer','employee','manager','admin') then
    raise exception 'Invalid role';
  end if;
  if p_role in ('employee','manager') and not exists (
    select 1 from public.locations where id = p_location_id and is_active = true
  ) then raise exception 'Staff require an active location'; end if;

  perform pg_advisory_xact_lock(hashtext('ma.admin_users'));
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin role';
  end if;
  if v_target.role = 'admin' and v_target.is_active and p_role <> 'admin' and
     (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'The last active admin cannot be demoted';
  end if;

  update public.profiles set role = p_role,
    location_id = case when p_role in ('employee','manager') then p_location_id else null end,
    display_name = nullif(btrim(p_display_name), '')
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
  if not public.is_admin() then raise exception 'Admin only'; end if;
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

-- Legacy create_staff RPC is still callable directly. Match the Edge Function's
-- role/location rules and disallow managers from modifying admins or inactive staff.
create or replace function public.create_staff(
  p_email text, p_display_name text, p_role text, p_location_id uuid,
  p_password text default null
)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_updated public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid() and is_active;
  if not found or (v_actor.role <> 'admin' and
      not (v_actor.role = 'manager' and v_actor.location_id = p_location_id)) then
    raise exception 'Not permitted to create staff';
  end if;
  if p_role not in ('employee','manager') then raise exception 'Invalid staff role'; end if;
  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Staff require an active location';
  end if;
  select * into v_target from public.profiles where email = lower(btrim(p_email)) for update;
  if not found then raise exception 'User must be invited through the create-staff Edge Function first'; end if;
  if v_target.role = 'admin' or (v_actor.role = 'manager' and
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

-- Product row and material mappings are committed together. Never delete the
-- product row: order snapshots and creator submissions can reference it.
create or replace function public.admin_save_product(p_product jsonb, p_materials jsonb)
returns public.premade_products language plpgsql security definer set search_path = public as $$
declare
  v_product public.premade_products;
  v_material jsonb;
  v_default uuid := nullif(p_product->>'default_material_id', '')::uuid;
  v_status text := p_product->>'status';
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if jsonb_typeof(p_product) is distinct from 'object' or jsonb_typeof(p_materials) is distinct from 'array' then
    raise exception 'Invalid product payload';
  end if;
  if nullif(btrim(p_product->>'slug'), '') is null or
     nullif(btrim(p_product->'name'->>'en'), '') is null or
     nullif(btrim(p_product->>'source_model_path'), '') is null then
    raise exception 'Product slug, English name, and model file are required';
  end if;
  if v_status not in ('draft','published','archived') then raise exception 'Invalid product status'; end if;
  if v_default is not null and not exists (
    select 1 from jsonb_array_elements(p_materials) m where (m->>'material_id')::uuid = v_default
  ) then raise exception 'Default material must be allowed'; end if;
  if v_status = 'published' and (
    jsonb_array_length(p_materials) = 0 or v_default is null or not exists (
      select 1 from public.materials where id = v_default and is_active = true
    )
  ) then raise exception 'Published products need an active default material'; end if;

  -- Validate all mappings before updating anything.
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
      description = p_product->'description', base_price = (p_product->>'base_price')::numeric,
      default_material_id = v_default, category = p_product->>'category',
      tags = array(select jsonb_array_elements_text(p_product->'tags')),
      image_urls = p_product->'image_urls', source_model_path = p_product->>'source_model_path',
      is_featured = (p_product->>'is_featured')::boolean, status = v_status
    where id = (p_product->>'id')::uuid returning * into v_product;
    if not found then raise exception 'Product not found'; end if;
  else
    insert into public.premade_products(
      slug, name, description, base_price, default_material_id, category, tags,
      image_urls, source_model_path, is_featured, status
    ) values (
      p_product->>'slug', p_product->'name', p_product->'description',
      (p_product->>'base_price')::numeric, v_default, p_product->>'category',
      array(select jsonb_array_elements_text(p_product->'tags')),
      p_product->'image_urls', p_product->>'source_model_path',
      (p_product->>'is_featured')::boolean, v_status
    ) returning * into v_product;
  end if;

  delete from public.product_materials where product_id = v_product.id;
  insert into public.product_materials(product_id, material_id, price_modifier)
    select v_product.id, (m->>'material_id')::uuid, (m->>'price_modifier')::numeric
      from jsonb_array_elements(p_materials) m;
  return v_product;
end;
$$;
revoke all on function public.admin_save_product(jsonb,jsonb) from public;
grant execute on function public.admin_save_product(jsonb,jsonb) to authenticated;

-- Review and publish in one transaction. The Edge Function copies the private
-- model before calling this RPC; any failed SQL write rolls everything back.
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
  if not public.is_admin() then raise exception 'Admin only'; end if;
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

create or replace function public.admin_decide_payout(
  p_payout_id uuid, p_status text, p_reference text default null
)
returns public.payouts language plpgsql security definer set search_path = public as $$
declare
  v_payout public.payouts;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
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

-- Multiple choices in a select_many group need separate order rows. Preserve the
-- one-value constraint for text/file groups; select_one is validated in price_cart.
alter table public.order_item_option_values
  drop constraint if exists order_item_option_values_order_item_id_option_group_id_key;
create unique index order_item_option_values_choice_unique
  on public.order_item_option_values(order_item_id, option_group_id, selected_choice_id)
  where selected_choice_id is not null;
create unique index order_item_option_values_value_unique
  on public.order_item_option_values(order_item_id, option_group_id)
  where selected_choice_id is null;

-- Document prices used to be hard-coded in SQL and the storefront.
insert into public.platform_settings(key, value) values
  ('document.grayscale_per_side', '0.50'::jsonb),
  ('document.color_per_side', '1.00'::jsonb)
on conflict (key) do nothing;
