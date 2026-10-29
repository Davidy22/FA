'use client';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ProductCard } from '@/components/ProductCard';
import { useDeferredValue, useState } from 'react';
import { t_db } from '@/lib/format';
import { useLocale } from '@/store/locale';
import type { CatalogProduct, Material, ProductCategory } from '@/lib/types';

export default function CatalogPage() {
  const { t } = useTranslation(['common','catalog']);
  const pageSize = 48;
  const locale = useLocale((s) => s.locale);
  const [category, setCategory] = useState<string>('');
  const [materialId, setMaterialId] = useState<string>('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(0);

  const { data: productPage, isLoading, error } = useQuery<{ products: CatalogProduct[]; hasMore: boolean }>({
    queryKey: ['products', category, materialId, deferredQuery, page],
    queryFn: async () => {
      const productFields = 'id,slug,name,base_price,image_urls,sale_price,sale_starts_at,sale_ends_at';
      const projection = materialId ? `${productFields},product_materials!inner(material_id)` : productFields;
      let q = supabase().from('premade_products').select(projection).eq('status', 'published');
      if (category) q = q.eq('category', category);
      const search = deferredQuery.trim().replace(/[%,()]/g, '');
      if (search) q = q.or(`name->>en.ilike.%${search}%,name->>zh-Hant.ilike.%${search}%,name->>zh-Hans.ilike.%${search}%`);
      if (materialId) q = q.eq('product_materials.material_id', materialId);
      const from = page * pageSize;
      q = q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + pageSize);
      const { data, error } = await q;
      if (error) throw error;
      // The generated relationship parser does not model the embedded filter-only join.
      const rows = (data || []) as unknown as CatalogProduct[];
      return { products: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
    },
  });
  const products = productPage?.products || [];

  const { data: materials } = useQuery<Material[]>({
    queryKey: ['materials_active'],
    queryFn: async () => {
      const { data } = await supabase().from('materials').select('*').eq('is_active',true).order('name->>en');
      return data || [];
    },
  });

  // Categories are managed in the admin console, so the filter follows the
  // store's own list instead of a hard-coded enum.
  const { data: categories } = useQuery<ProductCategory[]>({
    queryKey: ['product_categories'],
    queryFn: async () => {
      const { data } = await supabase().from('product_categories')
        .select('*').eq('is_active', true).order('sort_order', { ascending: true });
      return (data || []) as ProductCategory[];
    },
  });

  return (
    <div className="w-full max-w-none px-2 py-8 sm:px-3 grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-4 md:gap-5">
      <aside aria-label={t('catalog:filters')} className="space-y-4">
        <div>
          <label className="label">{t('common:search')}</label>
          <input className="input" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="…" />
        </div>
        <div>
          <label className="label">{t('catalog:filter_by_category')}</label>
          <select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}>
            <option value="">—</option>
            {categories?.map((category) => (
              <option key={category.slug} value={category.slug}>{category.parent_id ? '— ' : ''}{t_db(category.name, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('catalog:filter_by_material')}</label>
          <select className="input" value={materialId} onChange={(e) => { setMaterialId(e.target.value); setPage(0); }}>
            <option value="">—</option>
            {materials?.map((m) => (
              <option key={m.id} value={m.id}>{t_db(m.adjective || m.name, locale)} ({t_db(m.name, locale)})</option>
            ))}
          </select>
        </div>
      </aside>
      <section>
        <h1 className="text-2xl font-semibold mb-4">{t('catalog:browse')}</h1>
        {isLoading ? <p>{t('common:loading')}</p> : error ? (
          <p role="alert" className="text-red-700">{t('catalog:load_error')}</p>
        ) : products?.length === 0 ? (
          <p className="text-slate-500">{t('catalog:no_results')}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
        {!!productPage && (page > 0 || productPage.hasMore) && (
          <nav className="mt-5 flex items-center justify-between gap-3" aria-label={t('catalog:pagination_label')}>
            <button type="button" className="btn-outline" disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}>{t('catalog:previous_page')}</button>
            <span className="text-sm text-slate-500" aria-live="polite">{t('catalog:page_number', { number: page + 1 })}</span>
            <button type="button" className="btn-outline" disabled={!productPage.hasMore}
              onClick={() => setPage((current) => current + 1)}>{t('catalog:next_page')}</button>
          </nav>
        )}
      </section>
    </div>
  );
}
