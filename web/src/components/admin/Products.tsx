'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cleanLocalized, decimal, lines, localizedInput, PRODUCT_CATEGORIES, PRODUCT_STATUSES } from '@/lib/admin';
import { slugify, t_db } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Localized, Material, PremadeProduct, ProductMaterial } from '@/lib/types';
import { AdminFeedback, AdminQueryState, FormActions, LocalizedFields, useAdminAction } from './Shared';
import { ProductOptions } from './ProductOptions';

type Draft = {
  slug: string; name: Localized; description: Localized; price: string;
  category: PremadeProduct['category']; tags: string; imageUrls: string;
  sourcePath: string; featured: boolean; status: PremadeProduct['status'];
  defaultMaterialId: string; allowed: Record<string, string>;
};

function draft(product?: PremadeProduct, allowed: ProductMaterial[] = []): Draft {
  return {
    slug: product?.slug || '', name: localizedInput(product?.name), description: localizedInput(product?.description),
    price: product?.base_price?.toString() || '0', category: product?.category || 'other',
    tags: product?.tags?.join(', ') || '', imageUrls: product?.image_urls?.join('\n') || '',
    sourcePath: product?.source_model_path || '', featured: product?.is_featured ?? false,
    status: product?.status || 'draft', defaultMaterialId: product?.default_material_id || '',
    allowed: Object.fromEntries(allowed.map((row) => [row.material_id, row.price_modifier.toString()])),
  };
}

function ProductForm({ product, allowed, materials, onDone }: {
  product?: PremadeProduct; allowed: ProductMaterial[]; materials: Material[]; onDone: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [form, setForm] = useState(() => draft(product, allowed));
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const allowedIds = Object.keys(form.allowed);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const slug = slugify(form.slug);
      if (!slug || slug !== form.slug.trim().toLowerCase()) throw new Error(t('admin:invalid_slug'));
      if (!product && !modelFile) throw new Error(t('admin:model_required'));
      if (modelFile && (modelFile.size > 50 * 1024 * 1024 || !/\.(stl|obj|3mf)$/i.test(modelFile.name))) {
        throw new Error(t('admin:model_invalid'));
      }
      for (const file of imageFiles) {
        if (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          throw new Error(t('admin:image_invalid'));
        }
      }
      const selected = allowedIds.map((material_id) => ({
        material_id, price_modifier: decimal(form.allowed[material_id], t('admin:fields.price_modifier'), -99999999, 99999999),
      }));
      if (form.status === 'published' && (!selected.length || !form.defaultMaterialId ||
        !selected.some((row) => row.material_id === form.defaultMaterialId) ||
        !materials.some((material) => material.id === form.defaultMaterialId && material.is_active))) {
        throw new Error(t('admin:publish_requires_material'));
      }
      if (form.defaultMaterialId && !allowedIds.includes(form.defaultMaterialId)) {
        throw new Error(t('admin:default_material_invalid'));
      }
      const uploaded: { bucket: string; path: string }[] = [];
      try {
        let sourcePath = form.sourcePath;
        if (modelFile) {
          const path = `${crypto.randomUUID()}.${modelFile.name.split('.').pop()!.toLowerCase()}`;
          const { error } = await supabase().storage.from('product-files').upload(path, modelFile, {
            contentType: modelFile.type || 'application/octet-stream',
          });
          if (error) throw error;
          uploaded.push({ bucket: 'product-files', path });
          sourcePath = path;
        }
        const imageUrls = lines(form.imageUrls);
        for (const file of imageFiles) {
          const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
          const path = `${crypto.randomUUID()}.${extension}`;
          const { error } = await supabase().storage.from('product-images').upload(path, file, { contentType: file.type });
          if (error) throw error;
          uploaded.push({ bucket: 'product-images', path });
          imageUrls.push(supabase().storage.from('product-images').getPublicUrl(path).data.publicUrl);
        }
        const payload = {
          ...(product ? { id: product.id } : {}), slug,
          name: cleanLocalized(form.name, t('admin:fields.name'))!,
          description: cleanLocalized(form.description, t('admin:fields.description'), true),
          base_price: decimal(form.price, t('admin:fields.base_price'), 0, 99999999),
          default_material_id: form.defaultMaterialId || null,
          category: form.category, tags: lines(form.tags), image_urls: imageUrls,
          source_model_path: sourcePath, is_featured: form.featured, status: form.status,
        };
        const { error } = await supabase().rpc('admin_save_product', { p_product: payload, p_materials: selected });
        if (error) throw error;
      } catch (error) {
        await Promise.all(uploaded.map(({ bucket, path }) => supabase().storage.from(bucket).remove([path])));
        throw error;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_products'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_product_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product'] }),
        queryClient.invalidateQueries({ queryKey: ['product_materials'] }),
      ]);
    }, onDone);
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4 rounded-lg border border-brand-200 p-4">
    <h3 className="font-medium">{product ? t('admin:edit_product') : t('admin:add_product')}</h3>
    <label className="block text-sm">{t('admin:fields.slug')} *<input className="input mt-1" required value={form.slug} onChange={(event) => set('slug', event.target.value)} /></label>
    <LocalizedFields label={t('admin:fields.name')} value={form.name} onChange={(value) => set('name', value)} />
    <LocalizedFields label={t('admin:fields.description')} value={form.description} onChange={(value) => set('description', value)} multiline required={false} />
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm">{t('admin:fields.base_price')}<input className="input mt-1" type="number" required min="0" step="0.01" value={form.price} onChange={(event) => set('price', event.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.category')}<select className="input mt-1" value={form.category} onChange={(event) => set('category', event.target.value as Draft['category'])}>
        {PRODUCT_CATEGORIES.map((category) => <option key={category} value={category}>{t(`common:categories.${category}`)}</option>)}
      </select></label>
      <label className="text-sm">{t('admin:fields.status')}<select className="input mt-1" value={form.status} onChange={(event) => set('status', event.target.value as Draft['status'])}>
        {PRODUCT_STATUSES.map((status) => <option key={status} value={status}>{t(`admin:product_status.${status}`)}</option>)}
      </select></label>
    </div>
    <label className="block text-sm">{t('admin:fields.tags')}<input className="input mt-1" value={form.tags} onChange={(event) => set('tags', event.target.value)} placeholder="gift, desk" /></label>
    <label className="block text-sm">{t('admin:fields.model_file')}{!product ? ' *' : ''}<input className="mt-1 block w-full text-sm" type="file" accept=".stl,.obj,.3mf" onChange={(event) => setModelFile(event.target.files?.[0] || null)} /></label>
    {product && <p className="break-all text-xs text-slate-500">{t('admin:current_file')}: {form.sourcePath}</p>}
    <label className="block text-sm">{t('admin:fields.image_upload')}<input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImageFiles(Array.from(event.target.files || []))} /></label>
    <label className="block text-sm">{t('admin:fields.image_urls')}<textarea className="input mt-1 min-h-20" value={form.imageUrls} onChange={(event) => set('imageUrls', event.target.value)} placeholder="https://…" /></label>
    <p className="text-xs text-slate-500">{t('admin:images_hint')}</p>
    <fieldset className="rounded border p-3"><legend className="px-1 text-sm font-medium">{t('admin:allowed_materials')}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {materials.map((material) => <div key={material.id} className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={material.id in form.allowed} onChange={(event) => {
              const next = { ...form.allowed };
              if (event.target.checked) next[material.id] = '0'; else delete next[material.id];
              set('allowed', next);
              if (!event.target.checked && form.defaultMaterialId === material.id) set('defaultMaterialId', '');
            }} />{t_db(material.name, locale)} {!material.is_active && `(${t('admin:inactive')})`}
          </label>
          {material.id in form.allowed && <label className="ml-auto text-xs">{t('admin:fields.price_modifier')}
            <input className="input mt-1 w-24 text-sm" type="number" step="0.01" value={form.allowed[material.id]}
              onChange={(event) => set('allowed', { ...form.allowed, [material.id]: event.target.value })} />
          </label>}
        </div>)}
      </div>
      <label className="mt-3 block text-sm">{t('admin:fields.default_material')}<select className="input mt-1" value={form.defaultMaterialId} onChange={(event) => set('defaultMaterialId', event.target.value)}>
        <option value="">—</option>{materials.filter((material) => allowedIds.includes(material.id)).map((material) => <option key={material.id} value={material.id}>{t_db(material.name, locale)}</option>)}
      </select></label>
    </fieldset>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.featured} onChange={(event) => set('featured', event.target.checked)} />{t('admin:fields.featured')}</label>
    <p className="text-xs text-slate-600">{t('admin:archive_hint')}</p>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

export function AdminProducts() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const [editing, setEditing] = useState<string | null>(null);
  const [optionsProductId, setOptionsProductId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const productsQuery = useQuery<PremadeProduct[]>({
    queryKey: ['admin_products'],
    queryFn: async () => {
      const { data, error } = await supabase().from('premade_products').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as PremadeProduct[];
    },
  });
  const materialsQuery = useQuery<Material[]>({
    queryKey: ['admin_materials'],
    queryFn: async () => {
      const { data, error } = await supabase().from('materials').select('*').order('sort_order');
      if (error) throw error;
      return (data || []) as Material[];
    },
  });
  const allowedQuery = useQuery<ProductMaterial[]>({
    queryKey: ['admin_product_materials'],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_materials').select('*');
      if (error) throw error;
      return (data || []) as ProductMaterial[];
    },
  });
  const products = productsQuery.data || [];
  const filtered = products.filter((product) =>
    `${product.slug} ${product.name.en}`.toLowerCase().includes(search.trim().toLowerCase()));

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <h2 className="text-xl font-medium">{t('admin:products')}</h2>
      <p className="text-sm text-slate-600">{t('admin:products_help')}</p>
    </div><button type="button" className="btn text-sm" onClick={() => { setOptionsProductId(null); setEditing('new'); }}>{t('admin:add_product')}</button></div>
    <AdminQueryState loading={productsQuery.isPending || materialsQuery.isPending || allowedQuery.isPending}
      error={productsQuery.error || materialsQuery.error || allowedQuery.error} />
    <label className="mt-4 block max-w-sm text-sm">{t('common:search')}<input className="input mt-1" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {products.length === 0 && !productsQuery.isPending && <p className="mt-4 text-slate-500">{t('admin:no_products')}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {filtered.map((product) => <article key={product.id} className="rounded-lg border p-4">
        <div className="flex justify-between gap-3"><div>
          <h3 className="font-medium">{t_db(product.name, locale)}</h3>
          <p className="text-xs text-slate-500">/{product.slug} · {t(`admin:product_status.${product.status}`)}</p>
        </div><strong className="text-sm">US${Number(product.base_price).toFixed(2)}</strong></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-outline text-sm" onClick={() => { setOptionsProductId(null); setEditing(product.id); }}>{t('common:edit')}</button>
          <button type="button" className="btn-outline text-sm" onClick={() => { setEditing(null); setOptionsProductId(product.id); }}>{t('admin:edit_options')}</button>
        </div>
      </article>)}
    </div>
    {editing && !materialsQuery.isPending && !allowedQuery.isPending && <ProductForm key={editing}
      product={products.find((product) => product.id === editing)} materials={materialsQuery.data || []}
      allowed={(allowedQuery.data || []).filter((row) => row.product_id === editing)} onDone={() => setEditing(null)} />}
    {optionsProductId && <ProductOptions key={optionsProductId} product={products.find((product) => product.id === optionsProductId)!}
      onClose={() => setOptionsProductId(null)} />}
  </>;
}
