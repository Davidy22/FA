-- Scaling indexes for the remaining hot paths, and the missing DELETE policies
-- that make "remove my upload" work at all.

-- 1. A customer's own order history is `orders where user_id = auth.uid()
--    order by created_at desc limit 50` (RLS filters on user_id), and no index
--    started with user_id, so every account page scanned the whole table.
create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc, id asc);

-- 2. The product page loads option groups and their choices per product. Both
--    lookups were sequential scans that grow with the catalog.
create index if not exists product_option_groups_product_idx
  on public.product_option_groups (product_id);
create index if not exists product_option_choices_group_idx
  on public.product_option_choices (group_id);

-- 3. Admin search boxes and the support queue use `ilike '%term%'`, which a
--    btree index cannot serve. Trigram indexes keep those searches fast as
--    orders and accounts grow.
create index if not exists orders_order_number_trgm_idx
  on public.orders using gin (order_number gin_trgm_ops);
create index if not exists orders_contact_email_trgm_idx
  on public.orders using gin (contact_email gin_trgm_ops);
create index if not exists profiles_email_trgm_idx
  on public.profiles using gin (email gin_trgm_ops);

-- 4. Uploads could be created but never deleted: only an INSERT policy existed
--    for `option-uploads`, `ticket-uploads` and `document-prints`, so removing a
--    file the customer abandoned before checkout was silently rejected and the
--    bucket grew forever. Deletion stays owner-scoped and is refused once an
--    order or ticket actually references the file, so a paid job never loses its
--    source. Guests have no owner to scope to, so guest document uploads are
--    left to a retention sweep.
create index if not exists order_item_option_values_file_path_idx
  on public.order_item_option_values (file_path) where file_path is not null;
create index if not exists ticket_attachments_file_path_idx
  on public.ticket_attachments (file_path);
create index if not exists order_items_document_path_idx
  on public.order_items ((item_snapshot ->> 'file_path'))
  where item_snapshot ->> 'file_path' is not null;

-- Security definer so the reference lookup does not depend on the caller's RLS
-- grants on orders/tickets; it only ever answers "is this object still needed".
create or replace function public.upload_is_referenced(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_bucket
    when 'option-uploads' then exists (
      select 1 from public.order_item_option_values v where v.file_path = p_name)
    when 'ticket-uploads' then exists (
      select 1 from public.ticket_attachments a where a.file_path = p_name)
    when 'document-prints' then exists (
      select 1 from public.order_items i where i.item_snapshot ->> 'file_path' = p_name)
    else true
  end;
$$;
revoke all on function public.upload_is_referenced(text, text) from public;
grant execute on function public.upload_is_referenced(text, text) to authenticated, service_role;

-- A delete can only target rows the caller can also read, and `option-uploads`
-- never had a read policy, so `remove()` on an abandoned upload matched nothing.
-- Owners may list and read their own folder; staff still go through sign-file,
-- which checks the order before handing out a signed URL.
create policy "owner read own option uploads" on storage.objects for select to authenticated
  using (
    bucket_id = 'option-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner delete unused option uploads" on storage.objects for delete to authenticated
  using (
    bucket_id = 'option-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.upload_is_referenced(bucket_id, name)
  );

create policy "owner delete unused ticket uploads" on storage.objects for delete to authenticated
  using (
    bucket_id = 'ticket-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.upload_is_referenced(bucket_id, name)
  );

create policy "document owner delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'document-prints'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.upload_is_referenced(bucket_id, name)
  );
