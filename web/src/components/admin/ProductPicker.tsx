'use client';
import { useDeferredValue, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { t_db } from '@/lib/format';
import { useLocale } from '@/store/locale';
import { supabase } from '@/lib/supabase';
import type { PremadeProduct } from '@/lib/types';

type ProductChoice = Pick<PremadeProduct, 'id' | 'name' | 'slug' | 'status'>;

/** Search product choices on the server; never download the whole product table for a dropdown. */
export function ProductPicker({ value, onChange, emptyLabel, searchLabel, publishedOnly = false }: {
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
  searchLabel: string;
  publishedOnly?: boolean;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const listId = useId();
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDeferredValue(input.trim().replace(/[^\p{L}\p{N}\s-]/gu, ''));

  const selectedQuery = useQuery<ProductChoice | null>({
    queryKey: ['admin_product_choice', value],
    enabled: !!value,
    queryFn: async () => {
      const { data, error } = await supabase().from('premade_products')
        .select('id,name,slug,status').eq('id', value).maybeSingle();
      if (error) throw error;
      return data as ProductChoice | null;
    },
  });
  const matchesQuery = useQuery<ProductChoice[]>({
    queryKey: ['admin_product_choices', term, publishedOnly],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase().rpc('search_product_choices', {
        p_query: term,
        p_published_only: publishedOnly,
      });
      if (error) throw error;
      return (data || []) as ProductChoice[];
    },
  });

  const labelFor = (product: ProductChoice) => {
    const name = t_db(product.name, locale) || product.slug;
    return publishedOnly || product.status === 'published'
      ? name : `${name} (${t(`admin:product_status.${product.status}`)})`;
  };
  const selectedLabel = selectedQuery.data ? labelFor(selectedQuery.data) : value;

  return <div className={open ? 'relative z-30' : 'relative'}>
    <div className="flex gap-1">
      <input className="input min-w-0" maxLength={100} role="combobox" aria-expanded={open} aria-controls={listId}
        aria-autocomplete="list" placeholder={selectedLabel || emptyLabel} value={input}
        onFocus={() => setOpen(true)} onChange={(event) => { setInput(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && matchesQuery.data?.[0]) {
            event.preventDefault();
            const option = matchesQuery.data[0];
            queryClient.setQueryData(['admin_product_choice', option.id], option);
            onChange(option.id); setInput(''); setOpen(false);
          }
        }} aria-label={searchLabel} />
      {value && <button className="btn-outline px-3" type="button" aria-label={t('common:close')}
        onClick={() => { onChange(''); setInput(''); }}>×</button>}
    </div>
    {open && <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-300 bg-white shadow-lg"
      role="listbox" id={listId}>
      <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
        onClick={() => { onChange(''); setInput(''); setOpen(false); }}>{emptyLabel}</button>
      {term.length < 2 && <p className="px-3 py-2 text-sm text-slate-500">{t('admin:product_search_hint')}</p>}
      {term.length >= 2 && matchesQuery.isPending && <p className="px-3 py-2 text-sm text-slate-500">{t('common:loading')}</p>}
      {matchesQuery.data?.map((product) => <button key={product.id} type="button" role="option"
        aria-selected={value === product.id}
        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
        onClick={() => {
          queryClient.setQueryData(['admin_product_choice', product.id], product);
          onChange(product.id); setInput(''); setOpen(false);
        }}>{labelFor(product)}</button>)}
      {term.length >= 2 && !matchesQuery.isPending && !matchesQuery.data?.length &&
        <p className="px-3 py-2 text-sm text-slate-500">{t('admin:no_product_matches')}</p>}
    </div>}
    {open && <button className="fixed inset-0 z-20 cursor-default" aria-label={t('common:close')}
      type="button" onClick={() => setOpen(false)} />}
  </div>;
}
