'use client';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ProductCard } from '@/components/ProductCard';
import { useState } from 'react';
import { t_db } from '@/lib/format';
import { useLocale } from '@/store/locale';
import type { Material, ProductCategory, ProductWithMaterials } from '@/lib/types';

export default function CatalogPage() {
  const { t } = useTranslation(['common','catalog']);
  const locale = useLocale((s) => s.locale);
  const [category, setCategory] = useState<string>('');
  const [materialId, setMaterialId] = useState<string>('');
  const [query, setQuery] = useState('');

  const { data: products, isLoading, error } = useQuery<ProductWithMaterials[]>({
    queryKey: ['products', category, materialId, query],
    queryFn: async () => {
      let q = supabase().from('premade_products')
        .select('*, product_materials(*, material:materials(*))').eq('status','published');
      if (category) q = q.eq('category', category);
      if (query) q = q.or(`name->>en.ilike.%${query}%,name->>zh-Hant.ilike.%${query}%,name->>zh-Hans.ilike.%${query}%`);
      if (materialId) {
        const { data: pms } = await supabase().from('product_materials').select('product_id').eq('material_id', materialId);
        const ids = (pms || []).map((p) => p.product_id);
        q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      }
      q = q.order('created_at', { ascending: false }).limit(48);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ProductWithMaterials[];
    },
  });

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
    <div className="container-ma py-8 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
      <aside aria-label={t('catalog:filters')} className="space-y-4">
        <div>
          <label className="label">{t('common:search')}</label>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="…" />
        </div>
        <div>
          <label className="label">{t('catalog:filter_by_category')}</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">—</option>
            {categories?.map((category) => (
              <option key={category.slug} value={category.slug}>{category.parent_id ? '— ' : ''}{t_db(category.name, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('catalog:filter_by_material')}</label>
          <select className="input" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {products?.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
