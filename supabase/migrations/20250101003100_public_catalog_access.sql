-- Make the anonymous storefront's table privileges explicit. Supabase projects
-- normally provide these defaults, but a revoked/default-privilege change must
-- not turn the public catalog into an empty, signed-in-only page. RLS still
-- limits every row to published products and active public supporting data.
grant select on public.premade_products,
  public.product_materials,
  public.materials,
  public.product_categories,
  public.product_material_slots,
  public.product_slot_materials,
  public.product_option_groups,
  public.product_option_choices,
  public.text_option_config,
  public.file_option_config,
  public.filaments,
  public.filament_finishes,
  public.location_filaments,
  public.locations
  to anon, authenticated;

-- Keep an explicit anonymous published-product policy alongside the broader
-- staff/admin policies. It grants no draft, archived, or write access.
create policy products_read_published_anon on public.premade_products
  for select to anon using (status = 'published');
