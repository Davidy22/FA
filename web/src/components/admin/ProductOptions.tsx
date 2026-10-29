'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cleanLocalized, decimal, isoDateTime, lines, localDateTime, localizedInput } from '@/lib/admin';
import { formatMoney, t_db } from '@/lib/format';
import { isOnSale } from '@/lib/sale';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Locale } from '@/lib/i18n';
import type {
  FileOptionConfig, Localized, PremadeProduct, ProductOptionChoice,
  ProductOptionGroup, ProductOptionType, TextOptionConfig,
} from '@/lib/types';
import { AdminFeedback, AdminQueryState, FormActions, LocalizedFields, useAdminAction, useAdminLanguage, useFormPanel } from './Shared';
import { FuzzySelect } from './FuzzySelect';

type OptionDetail = ProductOptionGroup & {
  choices: ProductOptionChoice[];
  textConfig?: TextOptionConfig;
  fileConfig?: FileOptionConfig;
};

async function loadOptions(productId: string): Promise<OptionDetail[]> {
  const { data: groups, error } = await supabase().from('product_option_groups')
    .select('*').eq('product_id', productId).order('sort_order');
  if (error) throw error;
  if (!groups?.length) return [];
  const ids = groups.map((group) => group.id);
  const [choices, text, files] = await Promise.all([
    supabase().from('product_option_choices').select('*').in('group_id', ids).order('sort_order'),
    supabase().from('text_option_config').select('*').in('group_id', ids),
    supabase().from('file_option_config').select('*').in('group_id', ids),
  ]);
  if (choices.error) throw choices.error;
  if (text.error) throw text.error;
  if (files.error) throw files.error;
  return groups.map((group) => ({
    ...group,
    choices: (choices.data || []).filter((choice) => choice.group_id === group.id),
    textConfig: (text.data || []).find((config) => config.group_id === group.id),
    fileConfig: (files.data || []).find((config) => config.group_id === group.id),
  }));
}

async function invalidateOptions(queryClient: ReturnType<typeof useQueryClient>, productId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin_options', productId] }),
    queryClient.invalidateQueries({ queryKey: ['groups'] }),
    queryClient.invalidateQueries({ queryKey: ['choices'] }),
    queryClient.invalidateQueries({ queryKey: ['text_configs'] }),
    queryClient.invalidateQueries({ queryKey: ['file_configs'] }),
    queryClient.invalidateQueries({ queryKey: ['product'] }),
  ]);
}

function GroupForm({ productId, group, onDone }: { productId: string; group?: OptionDetail; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [labelTypeId, setLabelTypeId] = useState(group?.option_type_id || '');
  const [type, setType] = useState<ProductOptionGroup['option_type']>(group?.option_type || 'select_one');
  const [required, setRequired] = useState(group?.required ?? false);
  const [sort, setSort] = useState(group?.sort_order?.toString() || '0');
  const [maxLength, setMaxLength] = useState(group?.textConfig?.max_length?.toString() || '100');
  const [modifier, setModifier] = useState(group?.textConfig?.price_modifier?.toString() || '0');
  const [mimes, setMimes] = useState(group?.fileConfig?.allowed_mime_types?.join(', ') || 'application/pdf, image/png, image/jpeg');
  const [maxSize, setMaxSize] = useState(group?.fileConfig ? (group.fileConfig.max_size_bytes / 1024 / 1024).toString() : '5');
  const optionTypesQuery = useQuery<ProductOptionType[]>({
    queryKey: ['product_option_types'],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_option_types')
        .select('*').eq('is_active', true).order('sort_order').order('slug');
      if (error) throw error;
      return (data || []) as ProductOptionType[];
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const optionType = optionTypesQuery.data?.find((row) => row.id === labelTypeId);
      if (!optionType) throw new Error(t('fields.option_label'));
      const payload = {
        product_id: productId, label: optionType.name, option_type_id: optionType.id,
        option_type: type, required, sort_order: decimal(sort, t('fields.sort_order'), -32768, 32767, true),
      };
      const result = group
        ? await supabase().from('product_option_groups').update(payload).eq('id', group.id).select().single()
        : await supabase().from('product_option_groups').insert(payload).select().single();
      if (result.error) throw result.error;
      const id = result.data.id as string;
      try {
        if (type === 'text') {
          const { error } = await supabase().from('text_option_config').upsert({
            group_id: id, max_length: decimal(maxLength, t('fields.max_length'), 1, 100000, true),
            price_modifier: decimal(modifier, t('fields.price_modifier'), -99999999, 99999999),
          }, { onConflict: 'group_id' });
          if (error) throw error;
        }
        if (type === 'file') {
          const allowed = lines(mimes);
          if (!allowed.length || allowed.some((mime) => !/^[\w.+-]+\/[\w.+-]+$/.test(mime))) {
            throw new Error(t('invalid_mimes'));
          }
          const { error } = await supabase().from('file_option_config').upsert({
            group_id: id, allowed_mime_types: allowed,
            max_size_bytes: Math.round(decimal(maxSize, t('fields.max_size_mb'), 0.01, 50) * 1024 * 1024),
            required,
          }, { onConflict: 'group_id' });
          if (error) throw error;
        }
      } catch (error) {
        if (!group) await supabase().from('product_option_groups').delete().eq('id', id);
        throw error;
      }
      await invalidateOptions(queryClient, productId);
    }, onDone);
  }

  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-3 space-y-3 rounded border border-brand-200 bg-brand-50/30 p-3">
    <h5 className="font-medium">{group ? t('edit_group') : t('add_group')}</h5>
    <label className="block text-sm">{t('fields.option_label')}
      <div className="mt-1"><FuzzySelect value={labelTypeId} onChange={setLabelTypeId} emptyLabel="—"
        searchLabel={t('fields.option_label')} options={(optionTypesQuery.data || []).map((optionType) => ({ value: optionType.id, label: t_db(optionType.name, locale) }))} /></div>
    </label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.option_type')}
        <select className="input mt-1" value={type} disabled={!!group} onChange={(event) => setType(event.target.value as ProductOptionGroup['option_type'])}>
          {(['select_one', 'select_many', 'text', 'file'] as const).map((kind) => <option key={kind} value={kind}>{t(`option_type.${kind}`)}</option>)}
        </select>
      </label>
      <label className="text-sm">{t('fields.sort_order')}<input className="input mt-1" type="number" step="1" value={sort} onChange={(event) => setSort(event.target.value)} /></label>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />{t('fields.required')}</label>
    {type === 'text' && <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.max_length')}<input className="input mt-1" type="number" min="1" step="1" value={maxLength} onChange={(event) => setMaxLength(event.target.value)} /></label>
      <label className="text-sm">{t('fields.price_modifier')}<input className="input mt-1" type="number" step="0.01" value={modifier} onChange={(event) => setModifier(event.target.value)} /></label>
    </div>}
    {type === 'file' && <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.allowed_mimes')}<input className="input mt-1" value={mimes} onChange={(event) => setMimes(event.target.value)} /></label>
      <label className="text-sm">{t('fields.max_size_mb')}<input className="input mt-1" type="number" min="0.01" max="50" step="0.01" value={maxSize} onChange={(event) => setMaxSize(event.target.value)} /></label>
    </div>}
    {group && <p className="text-xs text-slate-500">{t('option_type_fixed')}</p>}
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

function ChoiceForm({ productId, groupId, choice, onDone }: {
  productId: string; groupId: string; choice?: ProductOptionChoice; onDone: () => void;
}) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [language, setLanguage] = useAdminLanguage();
  const [label, setLabel] = useState<Localized>(() => localizedInput(choice?.label));
  const [modifier, setModifier] = useState(choice?.price_modifier?.toString() || '0');
  const [sort, setSort] = useState(choice?.sort_order?.toString() || '0');
  const [salePrice, setSalePrice] = useState(choice?.sale_price != null ? choice.sale_price.toString() : '');
  const [saleStartsAt, setSaleStartsAt] = useState(localDateTime(choice?.sale_starts_at));
  const [saleEndsAt, setSaleEndsAt] = useState(localDateTime(choice?.sale_ends_at));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const priceModifier = decimal(modifier, t('fields.price_modifier'), -99999999, 99999999);
      const sale = salePrice.trim() === '' ? null : decimal(salePrice, t('fields.sale_price'), -99999999, 99999999);
      if (sale !== null && sale >= priceModifier) throw new Error(t('sale_below_modifier'));
      const startsAt = isoDateTime(saleStartsAt);
      const endsAt = isoDateTime(saleEndsAt);
      if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw new Error(t('invalid_date_range'));
      const payload = {
        group_id: groupId, label: cleanLocalized(label, t('fields.choice_label'))!,
        price_modifier: priceModifier,
        sort_order: decimal(sort, t('fields.sort_order'), -32768, 32767, true),
        sale_price: sale, sale_starts_at: startsAt, sale_ends_at: endsAt,
      };
      const result = choice
        ? await supabase().from('product_option_choices').update(payload).eq('id', choice.id).select().single()
        : await supabase().from('product_option_choices').insert(payload).select().single();
      if (result.error) throw result.error;
      await invalidateOptions(queryClient, productId);
    }, onDone);
  }
  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-3 space-y-3 rounded border border-brand-200 bg-brand-50/30 p-3">
    <h5 className="font-medium">{choice ? t('edit_choice') : t('add_choice')}</h5>
    <LocalizedFields language={language} onLanguageChange={setLanguage} fields={[
      { label: t('fields.choice_label'), value: label, onChange: setLabel },
    ]} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.price_modifier')}<input className="input mt-1" type="number" step="0.01" value={modifier} onChange={(event) => setModifier(event.target.value)} /></label>
      <label className="text-sm">{t('fields.sort_order')}<input className="input mt-1" type="number" step="1" value={sort} onChange={(event) => setSort(event.target.value)} /></label>
    </div>
    <fieldset className="rounded border p-3"><legend className="px-1 text-sm font-medium">{t('sale_price')}</legend>
      <p className="text-xs text-slate-600">{t('choice_sale_help')}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">{t('fields.sale_price')}
          <input className="input mt-1" type="number" step="0.01" value={salePrice} placeholder={t('no_sale')}
            onChange={(event) => setSalePrice(event.target.value)} />
        </label>
        <label className="text-sm">{t('fields.sale_starts_at')}
          <input className="input mt-1" type="datetime-local" value={saleStartsAt} onChange={(event) => setSaleStartsAt(event.target.value)} />
        </label>
        <label className="text-sm">{t('fields.sale_ends_at')}
          <input className="input mt-1" type="datetime-local" value={saleEndsAt} onChange={(event) => setSaleEndsAt(event.target.value)} />
        </label>
      </div>
    </fieldset>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

/** A choice's modifier, with the regular one struck through while on sale. */
function ChoicePrice({ choice, locale }: { choice: ProductOptionChoice; locale: Locale }) {
  const signed = (amount: number) => `${amount >= 0 ? '+' : '−'}${formatMoney(Math.abs(amount), locale)}`;
  if (!isOnSale(choice)) return <>{signed(choice.price_modifier)}</>;
  return <>
    <s className="mr-1 text-slate-400">{signed(choice.price_modifier)}</s>
    <span className="text-rose-700">{signed(Number(choice.sale_price))}</span>
  </>;
}

export function ProductOptions({ product, onClose }: { product: PremadeProduct; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingChoice, setEditingChoice] = useState<string | null>(null);
  const [newChoiceGroup, setNewChoiceGroup] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const labelsQuery = useQuery<ProductOptionType[]>({
    queryKey: ['product_option_types'],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_option_types').select('*').order('sort_order').order('slug');
      if (error) throw error;
      return (data || []) as ProductOptionType[];
    },
  });
  const { data, isPending, error } = useQuery<OptionDetail[]>({
    queryKey: ['admin_options', product.id], queryFn: () => loadOptions(product.id),
  });

  async function remove(table: 'product_option_groups' | 'product_option_choices', id: string) {
    if (!window.confirm(t('admin:delete_option_confirm'))) return;
    await action.run(async () => {
      const { error } = await supabase().from(table).delete().eq('id', id);
      if (error) throw error;
      await invalidateOptions(queryClient, product.id);
    });
  }

  return <section className="mt-5 rounded-lg border border-brand-200 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('admin:edit_options')}: {t_db(product.name, locale)}</h3>
      <button className="btn-outline text-sm" type="button" onClick={onClose}>{t('common:close')}</button></div>
    <p className="mt-1 text-sm text-slate-600">{t('admin:options_help')}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="btn text-sm" onClick={() => setEditingGroup('new')}>{t('admin:add_group')}</button>
      <button type="button" className="btn-outline text-sm" aria-expanded={showLabels} onClick={() => setShowLabels((open) => !open)}>{t('admin:manage_option_labels')}</button>
    </div>
    {showLabels && <section className="mt-3 rounded border p-3" aria-label={t('admin:manage_option_labels')}>
      <h4 className="font-medium">{t('admin:manage_option_labels')}</h4>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          const name = newLabel.trim();
          const slug = name.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/g, '');
          if (!name || !slug) throw new Error(t('admin:option_label_required'));
          const { error } = await supabase().from('product_option_types').insert({ slug, name: { en: name }, sort_order: 100 });
          if (error) throw error;
          setNewLabel('');
          await queryClient.invalidateQueries({ queryKey: ['product_option_types'] });
        });
      }}>
        <input className="input max-w-sm" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder={t('admin:option_label_name')} aria-label={t('admin:option_label_name')} />
        <button type="submit" className="btn-outline text-sm" disabled={action.busy}>{t('admin:add_option_label')}</button>
      </form>
      <ul className="mt-2 divide-y">{(labelsQuery.data || []).map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-2 text-sm">
        <span>{t_db(item.name, locale)}</span>
        <button type="button" className="text-red-700 underline" disabled={action.busy} onClick={() => {
          if (!window.confirm(t('admin:delete_option_confirm'))) return;
          void action.run(async () => {
            const { error } = await supabase().from('product_option_types').delete().eq('id', item.id);
            if (error) throw error;
            await queryClient.invalidateQueries({ queryKey: ['product_option_types'] });
          });
        }}>{t('common:delete')}</button>
      </li>)}</ul>
      <p className="mt-2 text-xs text-slate-500">{t('admin:option_label_delete_hint')}</p>
    </section>}
    <AdminFeedback error={action.error} notice={action.notice} />
    <AdminQueryState loading={isPending} error={error} />
    {editingGroup === 'new' && <GroupForm key="new" productId={product.id} onDone={() => setEditingGroup(null)} />}
    <div className="mt-4 space-y-4">
      {data?.map((group) => <div key={group.id} className="rounded border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div>
          <strong>{t_db(group.label, locale)}</strong> · {t(`admin:option_type.${group.option_type}`)}
          {group.required && <span className="ml-2 badge">{t('admin:fields.required')}</span>}
        </div><div className="flex gap-2">
          <button className="text-brand-700 underline" onClick={() => setEditingGroup(group.id)}>{t('common:edit')}</button>
          <button className="text-red-700 underline" disabled={action.busy} onClick={() => void remove('product_option_groups', group.id)}>{t('common:delete')}</button>
        </div></div>
        {group.option_type === 'text' && <p className="mt-2 text-slate-600">{t('admin:fields.max_length')}: {group.textConfig?.max_length ?? 100} · {t('admin:fields.price_modifier')}: {group.textConfig?.price_modifier ?? 0}</p>}
        {group.option_type === 'file' && <p className="mt-2 text-slate-600">{group.fileConfig?.allowed_mime_types?.join(', ') || '—'} · {(group.fileConfig?.max_size_bytes || 5242880) / 1024 / 1024} MB</p>}
        {editingGroup === group.id && <GroupForm key={group.id} productId={product.id} group={group} onDone={() => setEditingGroup(null)} />}
        {(group.option_type === 'select_one' || group.option_type === 'select_many') && <>
          <div className="mt-3 flex justify-end">
            <button className="btn-outline text-sm" type="button" onClick={() => { setEditingChoice(null); setNewChoiceGroup(group.id); }}>{t('admin:add_choice')}</button>
          </div>
          {newChoiceGroup === group.id && <ChoiceForm key={`new-${group.id}`} productId={product.id} groupId={group.id} onDone={() => setNewChoiceGroup(null)} />}
          <ul className="mt-2 divide-y">{group.choices.map((choice) => <li key={choice.id} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <span>{t_db(choice.label, locale)} · <ChoicePrice choice={choice} locale={locale} /></span>
              <span className="flex gap-2"><button className="text-brand-700 underline" onClick={() => setEditingChoice(choice.id)}>{t('common:edit')}</button>
                <button className="text-red-700 underline" disabled={action.busy} onClick={() => void remove('product_option_choices', choice.id)}>{t('common:delete')}</button></span>
            </div>
            {editingChoice === choice.id && <ChoiceForm key={choice.id} productId={product.id} groupId={group.id} choice={choice} onDone={() => setEditingChoice(null)} />}
          </li>)}</ul>
        </>}
      </div>)}
    </div>
  </section>;
}
