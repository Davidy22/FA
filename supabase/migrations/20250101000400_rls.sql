-- Enable RLS on all tables (deny by default)

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.materials enable row level security;
alter table public.filaments enable row level security;
alter table public.location_filaments enable row level security;
alter table public.premade_products enable row level security;
alter table public.product_materials enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.product_option_choices enable row level security;
alter table public.text_option_config enable row level security;
alter table public.file_option_config enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.uploaded_models enable row level security;
alter table public.quote_requests enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_option_values enable row level security;
alter table public.order_notes enable row level security;
alter table public.model_submissions enable row level security;
alter table public.model_submission_materials enable row level security;
alter table public.creator_earnings enable row level security;
alter table public.payouts enable row level security;
alter table public.platform_settings enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.stripe_events enable row level security;

-- profiles
create policy profiles_read_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_staff_read_coworkers on public.profiles
  for select using (public.is_staff() and location_id = public.my_location());
create policy profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- locations
create policy locations_read_active on public.locations
  for select using (is_active = true or public.is_admin());
create policy locations_admin_all on public.locations
  for all using (public.is_admin()) with check (public.is_admin());

-- materials / filaments
create policy materials_read_active on public.materials
  for select using (is_active = true or public.is_admin());
create policy materials_admin_all on public.materials
  for all using (public.is_admin()) with check (public.is_admin());

create policy filaments_read_active on public.filaments
  for select using (is_active = true or public.is_admin());
create policy filaments_admin_all on public.filaments
  for all using (public.is_admin()) with check (public.is_admin());

-- location_filaments
create policy location_filaments_read_all on public.location_filaments for select using (true);
create policy location_filaments_staff_update_own on public.location_filaments
  for update using (public.is_staff_at(location_id)) with check (public.is_staff_at(location_id));
create policy location_filaments_admin_all on public.location_filaments
  for all using (public.is_admin()) with check (public.is_admin());
create policy location_filaments_staff_insert_own on public.location_filaments
  for insert with check (public.is_staff_at(location_id));

-- premade products and related
create policy products_read_published on public.premade_products
  for select using (status = 'published' or public.is_admin());
create policy products_admin_all on public.premade_products
  for all using (public.is_admin()) with check (public.is_admin());

create policy product_materials_read_published on public.product_materials
  for select using (
    exists (select 1 from public.premade_products p
             where p.id = product_id and (p.status = 'published' or public.is_admin()))
    or public.is_admin()
  );
create policy product_materials_admin_all on public.product_materials
  for all using (public.is_admin()) with check (public.is_admin());

create policy option_groups_read_published on public.product_option_groups
  for select using (
    exists (select 1 from public.premade_products p
             where p.id = product_id and (p.status = 'published' or public.is_admin()))
    or public.is_admin()
  );
create policy option_groups_admin_all on public.product_option_groups
  for all using (public.is_admin()) with check (public.is_admin());

create policy option_choices_read_published on public.product_option_choices
  for select using (
    exists (
      select 1 from public.product_option_groups g
      join public.premade_products p on p.id = g.product_id
      where g.id = group_id and (p.status = 'published' or public.is_admin())
    ) or public.is_admin()
  );
create policy option_choices_admin_all on public.product_option_choices
  for all using (public.is_admin()) with check (public.is_admin());

create policy text_option_config_read_published on public.text_option_config
  for select using (
    exists (select 1 from public.product_option_groups g
            join public.premade_products p on p.id = g.product_id
            where g.id = group_id and (p.status = 'published' or public.is_admin()))
    or public.is_admin()
  );
create policy text_option_config_admin_all on public.text_option_config
  for all using (public.is_admin()) with check (public.is_admin());

create policy file_option_config_read_published on public.file_option_config
  for select using (
    exists (select 1 from public.product_option_groups g
            join public.premade_products p on p.id = g.product_id
            where g.id = group_id and (p.status = 'published' or public.is_admin()))
    or public.is_admin()
  );
create policy file_option_config_admin_all on public.file_option_config
  for all using (public.is_admin()) with check (public.is_admin());

-- carts
create policy carts_owner_all on public.carts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy cart_items_owner_all on public.cart_items
  for all using (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
  );

-- uploaded_models / quote_requests
create policy models_owner_all on public.uploaded_models
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy models_staff_via_orders on public.uploaded_models
  for select using (
    public.is_staff() and exists (
      select 1 from public.quote_requests q
      join public.order_items oi on oi.quote_request_id = q.id
      join public.orders o on o.id = oi.order_id
      where q.uploaded_model_id = uploaded_models.id
        and public.is_staff_at(o.location_id)
    )
  );
create policy models_admin_all on public.uploaded_models
  for all using (public.is_admin()) with check (public.is_admin());

create policy quotes_owner_all on public.quote_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy quotes_staff_via_orders on public.quote_requests
  for select using (
    public.is_staff() and exists (
      select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.quote_request_id = quote_requests.id
        and public.is_staff_at(o.location_id)
    )
  );
create policy quotes_admin_all on public.quote_requests
  for all using (public.is_admin()) with check (public.is_admin());

-- orders and related
create policy orders_customer_read on public.orders
  for select using (auth.uid() = user_id);
create policy orders_staff_read on public.orders
  for select using (public.is_staff_at(location_id));
create policy orders_staff_update on public.orders
  for update using (public.is_staff_at(location_id)) with check (public.is_staff_at(location_id));
create policy orders_admin_all on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

create policy order_items_customer_read on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );
create policy order_items_staff_read on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and public.is_staff_at(o.location_id))
  );
create policy order_items_admin_all on public.order_items
  for all using (public.is_admin()) with check (public.is_admin());

create policy order_option_values_customer_read on public.order_item_option_values
  for select using (
    exists (
      select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id and o.user_id = auth.uid()
    )
  );
create policy order_option_values_staff_read on public.order_item_option_values
  for select using (
    exists (
      select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id and public.is_staff_at(o.location_id)
    )
  );
create policy order_option_values_admin_all on public.order_item_option_values
  for all using (public.is_admin()) with check (public.is_admin());

create policy order_notes_customer_read on public.order_notes
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );
create policy order_notes_staff_all on public.order_notes
  for all using (
    exists (select 1 from public.orders o where o.id = order_id and public.is_staff_at(o.location_id))
  ) with check (
    exists (select 1 from public.orders o where o.id = order_id and public.is_staff_at(o.location_id))
  );
create policy order_notes_admin_all on public.order_notes
  for all using (public.is_admin()) with check (public.is_admin());

-- model submissions
create policy submissions_owner_read on public.model_submissions
  for select using (auth.uid() = submitter_id);
create policy submissions_owner_write_draft on public.model_submissions
  for update using (
    auth.uid() = submitter_id and status in ('draft','changes_requested')
  ) with check (
    auth.uid() = submitter_id and status in ('draft','changes_requested','pending_review')
  );
create policy submissions_owner_insert on public.model_submissions
  for insert with check (auth.uid() = submitter_id);
create policy submissions_admin_all on public.model_submissions
  for all using (public.is_admin()) with check (public.is_admin());

create policy submission_materials_owner_read on public.model_submission_materials
  for select using (
    exists (select 1 from public.model_submissions s where s.id = submission_id and s.submitter_id = auth.uid())
  );
create policy submission_materials_owner_write on public.model_submission_materials
  for all using (
    exists (select 1 from public.model_submissions s where s.id = submission_id and s.submitter_id = auth.uid()
             and s.status in ('draft','changes_requested'))
  ) with check (
    exists (select 1 from public.model_submissions s where s.id = submission_id and s.submitter_id = auth.uid()
             and s.status in ('draft','changes_requested'))
  );
create policy submission_materials_admin_all on public.model_submission_materials
  for all using (public.is_admin()) with check (public.is_admin());

-- creator_earnings
create policy earnings_owner_read on public.creator_earnings
  for select using (auth.uid() = creator_id);
create policy earnings_admin_all on public.creator_earnings
  for all using (public.is_admin()) with check (public.is_admin());

-- payouts: clients can read own; insert is blocked, use request_payout RPC.
create policy payouts_owner_read on public.payouts
  for select using (auth.uid() = creator_id);
create policy payouts_admin_all on public.payouts
  for all using (public.is_admin()) with check (public.is_admin());

-- platform settings: admin can read/write, anon/authenticated can read select public keys via a function if needed.
create policy settings_admin_all on public.platform_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- checkout_sessions / stripe_events only via service role from Edge Functions.
-- (No policies added = deny all for direct client access.)
