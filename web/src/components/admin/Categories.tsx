'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cleanLocalized, decimal, localizedInput } from '@/lib/admin';
import { t_db } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Localized, ProductCategory } from '@/lib/types';
import {
  AdminFeedback, AdminQueryState, FormActions, LocalizedFields, useAdminAction, useAdminLanguage, useFormPanel,
} from './Shared';

type Draft = {
  slug: string; name: Localized; description: Localized; sortOrder: string; active: boolean; parentId: string;
};

function draft(category?: ProductCategory, nextOrder = 10): Draft {
  return {
    slug: category?.slug || '',
    name: localizedInput(category?.name),
    description: localizedInput(category?.description),
    sortOrder: String(category?.sort_order ?? nextOrder),
    active: category?.is_active ?? true,
    parentId: category?.parent_id || '',
  };
}

function CategoryForm({ category, nextOrder, categories, onDone }: {
  category?: ProductCategory; nextOrder: number; categories: ProductCategory[]; onDone: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [form, setForm] = useState(() => draft(category, nextOrder));
  const [language, setLanguage] = useAdminLanguage();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const isFallback = category?.slug === 'other';

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const slug = form.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(slug)) throw new Error(t('admin:invalid_slug'));
      const payload = {
        slug,
        name: cleanLocalized(form.name, t('admin:fields.name'))!,
        description: cleanLocalized(form.description, t('admin:fields.description'), true),
        sort_order: decimal(form.sortOrder, t('admin:fields.sort_order'), -999, 999, true),
        is_active: form.active, parent_id: form.parentId || null,
      };
      const result = category
        ? await supabase().from('product_categories').update(payload).eq('slug', category.slug).select().single()
        : await supabase().from('product_categories').insert(payload).select().single();
      if (result.error) throw result.error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_categories'] }),
        queryClient.invalidateQueries({ queryKey: ['product_categories'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
    }, onDone);
  }

  return <form ref={panel} onSubmit={(event) => void submit(event)}
    className="mt-4 space-y-4 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h4 className="font-medium">{category ? t('admin:edit_category') : t('admin:add_category')}</h4>
    <label className="block text-sm">{t('admin:fields.slug')} *
      <input className="input mt-1" required value={form.slug} disabled={isFallback}
        onChange={(event) => set('slug', event.target.value)} />
      <span className="mt-1 block text-xs text-slate-500">{t('admin:category_slug_hint')}</span>
    </label>
    <label className="block text-sm">{t('admin:fields.parent_category')}
      <select className="input mt-1" value={form.parentId} onChange={(event) => set('parentId', event.target.value)}>
        <option value="">{t('admin:top_level_category')}</option>
        {categories.filter((row) => row.slug !== category?.slug && row.parent_id == null).map((row) =>
          <option key={row.slug} value={row.slug}>{t_db(row.name, locale)}</option>)}
      </select>
    </label>
    <LocalizedFields language={language} onLanguageChange={setLanguage} fields={[
      { label: t('admin:fields.name'), value: form.name, onChange: (value) => set('name', value) },
      { label: t('admin:fields.description'), value: form.description, onChange: (value) => set('description', value), multiline: true, required: false },
    ]} />
    <div className="flex flex-wrap items-end gap-4">
      <label className="block text-sm">{t('admin:fields.sort_order')}
        <input className="input mt-1 max-w-32" type="number" step="1" value={form.sortOrder}
          onChange={(event) => set('sortOrder', event.target.value)} />
      </label>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} disabled={isFallback}
          onChange={(event) => set('active', event.target.checked)} />{t('admin:active')}
      </label>
    </div>
    {isFallback && <p className="text-xs text-slate-600">{t('admin:fallback_category_hint')}</p>}
    <AdminFeedback error={action.error} notice={action.notice} />
    <FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

export function AdminCategories() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editing, setEditing] = useState<string | null>(null);

  const categoriesQuery = useQuery<ProductCategory[]>({
    queryKey: ['admin_categories'],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_categories')
        .select('*').order('sort_order', { ascending: true }).order('slug');
      if (error) throw error;
      return (data || []) as ProductCategory[];
    },
  });
  const categories = categoriesQuery.data || [];

  async function remove(category: ProductCategory) {
    if (!window.confirm(t('admin:delete_category_confirm', { name: t_db(category.name, locale) }))) return;
    await action.run(async () => {
      const { error } = await supabase().from('product_categories').delete().eq('slug', category.slug);
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_categories'] }),
        queryClient.invalidateQueries({ queryKey: ['product_categories'] }),
      ]);
    });
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-medium">{t('admin:categories')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('admin:categories_help')}</p>
      </div>
      <button type="button" className="btn text-sm" onClick={() => setEditing('new')}>{t('admin:add_category')}</button>
    </div>
    <AdminFeedback error={action.error} notice={action.notice} />
    {editing && <CategoryForm key={editing}
      category={categories.find((category) => category.slug === editing)} categories={categories}
      nextOrder={(categories.at(-1)?.sort_order ?? 0) + 10}
      onDone={() => setEditing(null)} />}
    <AdminQueryState loading={categoriesQuery.isPending} error={categoriesQuery.error} />
    {categories.length === 0 && !categoriesQuery.isPending && <p className="text-slate-500">{t('admin:no_categories')}</p>}
    <ul className="mt-3 divide-y rounded border">
      {categories.map((category) => <li key={category.slug} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
        <div>
          <p className="font-medium">{t_db(category.name, locale)} <span className="font-mono text-xs text-slate-500">{category.slug}</span></p>
          {t_db(category.description, locale) && <p className="text-slate-600">{t_db(category.description, locale)}</p>}
          <p className="mt-1 text-xs text-slate-500">{t('admin:sort_order_value', { value: category.sort_order })}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge">{category.is_active ? t('admin:active') : t('admin:inactive')}</span>
          <button type="button" className="text-brand-700 underline" onClick={() => setEditing(category.slug)}>{t('common:edit')}</button>
          <button type="button" className="text-red-700 underline" disabled={action.busy || category.slug === 'other'}
            onClick={() => void remove(category)}>{t('common:delete')}</button>
        </div>
      </li>)}
    </ul>
  </div>;
}
