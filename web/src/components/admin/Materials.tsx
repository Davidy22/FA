'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cleanLocalized, decimal, localizedInput } from '@/lib/admin';
import { DEFAULT_CURRENCY, formatMoney, t_db } from '@/lib/format';
import { filamentSwatchStyle, finishLabel } from '@/lib/filaments';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Locale } from '@/lib/i18n';
import type { Filament, FilamentFinish, Localized, Location, Material } from '@/lib/types';
import { AdminFeedback, AdminQueryState, FormActions, LocalizedFields, useAdminAction, useAdminLanguage, useFormPanel } from './Shared';

type MaterialDraft = {
  slug: string; name: Localized; adjective: Localized; cost: string; notes: string; active: boolean;
};
function materialDraft(material?: Material & { notes?: string | null }): MaterialDraft {
  return {
    slug: material?.slug || '', name: localizedInput(material?.name), adjective: localizedInput(material?.adjective),
    cost: material?.cost_per_gram?.toString() || '0.20', notes: material?.notes || '',
    active: material?.is_active ?? true,
  };
}

type FilamentDraft = {
  materialId: string; color: Localized; hex: string; hex2: string; finish: string; active: boolean;
};
function filamentDraft(filament?: Filament, firstMaterialId = ''): FilamentDraft {
  return {
    materialId: filament?.material_id || firstMaterialId, color: localizedInput(filament?.color),
    hex: filament?.color_hex || '', hex2: filament?.color_hex_2 || '',
    finish: filament?.finish || 'standard',
    active: filament?.is_active ?? true,
  };
}

function MaterialForm({ material, onDone }: { material?: Material; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [form, setForm] = useState(() => materialDraft(material));
  // One language picker edits both localized fields of a material.
  const [language, setLanguage] = useAdminLanguage();
  const set = <K extends keyof MaterialDraft>(key: K, value: MaterialDraft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const slug = form.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(t('admin:invalid_slug'));
      const payload = {
        slug, name: cleanLocalized(form.name, t('admin:fields.name'))!,
        adjective: cleanLocalized(form.adjective, t('admin:fields.adjective'), true),
        cost_per_gram: decimal(form.cost, t('admin:fields.cost_per_gram'), 0, 9999.999999),
        notes: form.notes.trim() || null, is_active: form.active,
      };
      const result = material
        ? await supabase().from('materials').update(payload).eq('id', material.id).select().single()
        : await supabase().from('materials').insert(payload).select().single();
      if (result.error) throw result.error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['materials_active'] }),
        queryClient.invalidateQueries({ queryKey: ['materials_submit'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_filaments'] }),
        queryClient.invalidateQueries({ queryKey: ['emp_filaments'] }),
        queryClient.invalidateQueries({ queryKey: ['product_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['available_filaments'] }),
      ]);
    }, onDone);
  }
  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-4 space-y-4 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h4 className="font-medium">{material ? t('edit_material') : t('add_material')}</h4>
    <label className="block text-sm">{t('fields.slug')} *<input className="input mt-1" required value={form.slug} onChange={(e) => set('slug', e.target.value)} /></label>
    <LocalizedFields language={language} onLanguageChange={setLanguage} fields={[
      { label: t('fields.name'), value: form.name, onChange: (value) => set('name', value) },
      { label: t('fields.adjective'), value: form.adjective, onChange: (value) => set('adjective', value), required: false },
    ]} />
    <label className="block text-sm">{t('fields.cost_per_gram')}<input className="input mt-1 max-w-xs" required type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></label>
    <label className="block text-sm">{t('fields.notes')}<textarea className="input mt-1 min-h-20" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />{t('active')}</label>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

function FilamentForm({ filament, materials, finishes, onDone }: {
  filament?: Filament; materials: Material[]; finishes: FilamentFinish[]; onDone: () => void;
}) {
  const { t } = useTranslation('admin');
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [form, setForm] = useState(() => filamentDraft(filament, materials[0]?.id));
  const [language, setLanguage] = useAdminLanguage();
  const set = <K extends keyof FilamentDraft>(key: K, value: FilamentDraft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!materials.some((material) => material.id === form.materialId)) throw new Error(t('select_material'));
      const hex = form.hex.trim();
      if (hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(t('invalid_hex'));
      const hex2 = form.hex2.trim();
      if (hex2 && !/^#[0-9a-fA-F]{6}$/.test(hex2)) throw new Error(t('invalid_hex'));
      const payload = {
        material_id: form.materialId, color: cleanLocalized(form.color, t('fields.color'))!,
        color_hex: hex || null, color_hex_2: hex2 || null,
        finish: form.finish || 'standard', is_active: form.active,
      };
      const result = filament
        ? await supabase().from('filaments').update(payload).eq('id', filament.id).select().single()
        : await supabase().from('filaments').insert(payload).select().single();
      if (result.error) throw result.error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_filaments'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_stock'] }),
        queryClient.invalidateQueries({ queryKey: ['emp_filaments'] }),
        queryClient.invalidateQueries({ queryKey: ['available_filaments'] }),
      ]);
    }, onDone);
  }
  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-4 space-y-4 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h4 className="font-medium">{filament ? t('edit_filament') : t('add_filament')}</h4>
    <label className="block text-sm">{t('fields.material')} *
      <select className="input mt-1" required value={form.materialId} onChange={(e) => set('materialId', e.target.value)}>
        <option value="">—</option>{materials.map((material) => <option value={material.id} key={material.id}>{material.name.en}{!material.is_active ? ` (${t('inactive')})` : ''}</option>)}
      </select>
    </label>
    <LocalizedFields language={language} onLanguageChange={setLanguage} fields={[
      { label: t('fields.color'), value: form.color, onChange: (value) => set('color', value) },
    ]} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">{t('fields.color_hex')}
        <input className="input mt-1" type="text" placeholder="#123abc" value={form.hex} onChange={(e) => set('hex', e.target.value)} />
        <input className="mt-2 h-10 w-16 cursor-pointer rounded border border-slate-300 p-1" type="color"
          aria-label={t('fields.color_hex')} value={/^#[0-9a-fA-F]{6}$/.test(form.hex) ? form.hex : '#808080'}
          onChange={(e) => set('hex', e.target.value)} />
      </label>
      <label className="block text-sm">{t('fields.color_hex_2')}
        <input className="input mt-1" type="text" placeholder="#123abc" value={form.hex2} onChange={(e) => set('hex2', e.target.value)} />
        <input className="mt-2 h-10 w-16 cursor-pointer rounded border border-slate-300 p-1" type="color"
          aria-label={t('fields.color_hex_2')} value={/^#[0-9a-fA-F]{6}$/.test(form.hex2) ? form.hex2 : '#808080'}
          onChange={(e) => set('hex2', e.target.value)} />
      </label>
    </div>
    <label className="block text-sm">{t('fields.finish')}
      <select className="input mt-1 max-w-sm" value={form.finish} onChange={(e) => set('finish', e.target.value)}>
        {finishes.map((finish) => <option key={finish.slug} value={finish.slug}>{t_db(finish.name, locale)}</option>)}
      </select>
      <span className="mt-1 block text-xs text-slate-500">{t('finish_help')}</span>
    </label>
    <div className="flex items-center gap-3 text-sm">
      <span className="swatch" style={filamentSwatchStyle({ color_hex: form.hex || null, color_hex_2: form.hex2 || null, finish: form.finish })} />
      <span className="text-slate-600">{t('swatch_preview')}</span>
    </div>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />{t('active')}</label>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

function describeFinish(filament: Filament, locale: Locale): string {
  return finishLabel(filament.finish_name, filament.finish, locale);
}

export function AdminMaterials() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editingMaterial, setEditingMaterial] = useState<string | null>(null);
  const [editingFilament, setEditingFilament] = useState<string | null>(null);
  const [stockLocation, setStockLocation] = useState<string | null>(null);

  const materialsQuery = useQuery<Material[]>({
    queryKey: ['admin_materials'],
    queryFn: async () => {
      const { data, error } = await supabase().from('materials').select('*').order('name->>en');
      if (error) throw error;
      return (data || []) as Material[];
    },
  });
  const filamentsQuery = useQuery<Filament[]>({
    queryKey: ['admin_filaments'],
    queryFn: async () => {
      const { data, error } = await supabase().from('filaments')
        .select('*, finish_info:filament_finishes(name)').order('created_at');
      if (error) throw error;
      return (data || []).map((row) => ({ ...row, finish_name: row.finish_info?.name ?? null })) as Filament[];
    },
  });
  const finishesQuery = useQuery<FilamentFinish[]>({
    queryKey: ['filament_finishes'],
    queryFn: async () => {
      const { data, error } = await supabase().from('filament_finishes')
        .select('*').eq('is_active', true).order('sort_order');
      if (error) throw error;
      return (data || []) as FilamentFinish[];
    },
  });
  const locationsQuery = useQuery<Location[]>({
    queryKey: ['admin_locations'],
    queryFn: async () => {
      const { data, error } = await supabase().from('locations').select('*').order('name');
      if (error) throw error;
      return (data || []) as Location[];
    },
  });
  const selectedLocation = stockLocation || locationsQuery.data?.find((location) => location.is_active)?.id || null;
  const currency = locationsQuery.data?.find((location) => location.id === selectedLocation)?.currency ?? DEFAULT_CURRENCY;
  const stockQuery = useQuery<{ filament_id: string; in_stock: boolean }[]>({
    queryKey: ['admin_stock', selectedLocation],
    enabled: !!selectedLocation,
    queryFn: async () => {
      const { data, error } = await supabase().from('location_filaments').select('filament_id,in_stock').eq('location_id', selectedLocation!);
      if (error) throw error;
      return data || [];
    },
  });
  const stocked = new Set((stockQuery.data || []).filter((row) => row.in_stock).map((row) => row.filament_id));

  async function toggleStock(filamentId: string, inStock: boolean) {
    if (!selectedLocation) return;
    await action.run(async () => {
      const { error } = await supabase().from('location_filaments').upsert(
        { location_id: selectedLocation, filament_id: filamentId, in_stock: inStock },
        { onConflict: 'location_id,filament_id' }
      );
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_stock', selectedLocation] }),
        queryClient.invalidateQueries({ queryKey: ['available_filaments'] }),
        queryClient.invalidateQueries({ queryKey: ['emp_filaments'] }),
      ]);
    });
  }

  async function deleteMaterial(material: Material) {
    if (!window.confirm(`${t('common:delete')} ${t_db(material.name, locale)}?`)) return;
    await action.run(async () => {
      const { error } = await supabase().from('materials').delete().eq('id', material.id);
      if (error) throw error;
      await Promise.all(['admin_materials', 'admin_filaments', 'materials_active', 'materials_submit', 'available_filaments']
        .map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    });
  }

  async function deleteFilament(filament: Filament) {
    if (!window.confirm(`${t('common:delete')} ${t_db(filament.color, locale)}?`)) return;
    await action.run(async () => {
      const { error } = await supabase().from('filaments').delete().eq('id', filament.id);
      if (error) throw error;
      await Promise.all(['admin_filaments', 'admin_stock', 'emp_filaments', 'available_filaments']
        .map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    });
  }

  const materials = materialsQuery.data || [];
  const filaments = filamentsQuery.data || [];
  return <div className="space-y-9">
    <h2 className="text-xl font-medium">{t('admin:materials_filaments')}</h2>
    <AdminFeedback error={action.error} notice={action.notice} />
    <section>
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('admin:material_list')}</h3>
        <button className="btn text-sm" type="button" onClick={() => setEditingMaterial('new')}>{t('admin:add_material')}</button></div>
      {editingMaterial && <MaterialForm key={editingMaterial} material={materials.find((material) => material.id === editingMaterial)} onDone={() => setEditingMaterial(null)} />}
      <AdminQueryState loading={materialsQuery.isPending} error={materialsQuery.error} />
      {materials.length === 0 && !materialsQuery.isPending && <p className="mt-3 text-slate-500">{t('admin:no_materials')}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {materials.map((material) => <div key={material.id} className="rounded border p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><strong>{t_db(material.name, locale)} ({material.slug})</strong>
            <div className="flex gap-3"><button type="button" className="text-brand-700 underline" onClick={() => setEditingMaterial(material.id)}>{t('common:edit')}</button>
              <button type="button" className="text-red-700 underline" disabled={action.busy} onClick={() => void deleteMaterial(material)}>{t('common:delete')}</button></div></div>
          <p className="text-slate-600">{t_db(material.adjective, locale) || '—'} · {formatMoney(Number(material.cost_per_gram), locale, currency)}/g</p>
          {!material.is_active && <span className="badge">{t('admin:inactive')}</span>}
        </div>)}
      </div>
    </section>
    <section>
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('admin:filament_list')}</h3>
        <button className="btn text-sm" type="button" disabled={materials.length === 0} onClick={() => setEditingFilament('new')}>{t('admin:add_filament')}</button></div>
      <p className="mt-1 text-sm text-slate-600">{t('admin:filament_help')}</p>
      {editingFilament && <FilamentForm key={editingFilament} filament={filaments.find((filament) => filament.id === editingFilament)}
        materials={materials} finishes={finishesQuery.data || []} onDone={() => setEditingFilament(null)} />}
      <AdminQueryState loading={filamentsQuery.isPending} error={filamentsQuery.error} />
      {filaments.length === 0 && !filamentsQuery.isPending && <p className="mt-3 text-slate-500">{t('admin:no_filaments')}</p>}
      <div className="mt-3 space-y-3">
        {materials.map((material) => {
          const colors = filaments.filter((filament) => filament.material_id === material.id)
            .sort((a, b) => (a.color.en || '').localeCompare(b.color.en || ''));
          return <details key={material.id} className="rounded border p-3">
            <summary className="cursor-pointer font-medium">{t_db(material.name, locale)} · {formatMoney(Number(material.cost_per_gram), locale, currency)}/g ({colors.length})</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {colors.map((filament) => <div key={filament.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                <span className="swatch shrink-0" style={filamentSwatchStyle(filament)} />
                <span>{t_db(filament.color, locale)}
                  {describeFinish(filament, locale) ? <span className="text-slate-500"> · {describeFinish(filament, locale)}</span> : null}
                  {!filament.is_active ? ` (${t('admin:inactive')})` : ''}</span>
                <button type="button" className="text-brand-700 underline" onClick={() => setEditingFilament(filament.id)}>{t('common:edit')}</button>
                <button type="button" className="text-red-700 underline" disabled={action.busy} onClick={() => void deleteFilament(filament)}>{t('common:delete')}</button>
              </div>)}
              {colors.length === 0 && <span className="text-sm text-slate-500">{t('admin:no_filaments')}</span>}
            </div>
          </details>;
        })}
      </div>
    </section>
    <section>
      <h3 className="text-lg font-medium">{t('admin:stock_title')}</h3>
      <p className="mt-1 text-sm text-slate-600">{t('admin:stock_help')}</p>
      <AdminQueryState loading={locationsQuery.isPending} error={locationsQuery.error} />
      <div className="mt-3 flex flex-wrap gap-2">
        {locationsQuery.data?.map((location) => <button type="button" key={location.id}
          aria-pressed={selectedLocation === location.id} onClick={() => setStockLocation(location.id)}
          className={'rounded-full px-3 py-1 text-sm ' + (selectedLocation === location.id ? 'bg-brand-600 text-white' : 'bg-slate-100')}>
          {location.name}{!location.is_active ? ` (${t('admin:inactive')})` : ''}
        </button>)}
      </div>
      {selectedLocation && <>
        <AdminFeedback error={action.error} notice={action.notice} />
        <AdminQueryState loading={stockQuery.isPending} error={stockQuery.error} />
        <div className="mt-3 space-y-2">
          {materials.map((material) => <details key={material.id} className="rounded border p-3">
            <summary className="cursor-pointer font-medium">{t_db(material.name, locale)}</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {filaments.filter((filament) => filament.material_id === material.id).map((filament) =>
                <label key={filament.id} className="flex items-center gap-2 rounded border p-3 text-sm">
                  <input type="checkbox" checked={stocked.has(filament.id)} disabled={action.busy || stockQuery.isPending || !filament.is_active}
                    onChange={(event) => void toggleStock(filament.id, event.target.checked)} />
                  <span>{t_db(filament.color, locale)}</span>
                </label>)}
            </div>
          </details>)}
        </div>
      </>}
    </section>
  </div>;
}
