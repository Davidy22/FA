'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cleanLocalized, decimal, localizedInput } from '@/lib/admin';
import { t_db } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Filament, Localized, Location, Material } from '@/lib/types';
import { AdminFeedback, AdminQueryState, FormActions, LocalizedFields, useAdminAction } from './Shared';

type MaterialDraft = {
  slug: string; name: Localized; adjective: Localized; density: string; flow: string;
  sortOrder: string; printProfile: string; active: boolean;
};
function materialDraft(material?: Material & { print_profile?: unknown }): MaterialDraft {
  return {
    slug: material?.slug || '', name: localizedInput(material?.name), adjective: localizedInput(material?.adjective),
    density: material?.density_g_cm3?.toString() || '1.24', flow: material?.default_flow_mm3_s?.toString() || '7',
    sortOrder: material?.sort_order?.toString() || '0',
    printProfile: material?.print_profile == null ? '' : JSON.stringify(material.print_profile, null, 2),
    active: material?.is_active ?? true,
  };
}

type FilamentDraft = {
  materialId: string; color: Localized; hex: string; diameter: string; cost: string;
  manufacturer: string; active: boolean;
};
function filamentDraft(filament?: Filament, firstMaterialId = ''): FilamentDraft {
  return {
    materialId: filament?.material_id || firstMaterialId, color: localizedInput(filament?.color),
    hex: filament?.color_hex || '', diameter: filament?.diameter?.toString() || '1.75',
    cost: filament?.cost_per_gram?.toString() || '0.025', manufacturer: filament?.manufacturer || '',
    active: filament?.is_active ?? true,
  };
}

function MaterialForm({ material, onDone }: { material?: Material; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [form, setForm] = useState(() => materialDraft(material));
  const set = <K extends keyof MaterialDraft>(key: K, value: MaterialDraft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const slug = form.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(t('admin:invalid_slug'));
      let print_profile: unknown = null;
      if (form.printProfile.trim()) {
        try { print_profile = JSON.parse(form.printProfile); }
        catch { throw new Error(t('admin:invalid_json')); }
      }
      const payload = {
        slug, name: cleanLocalized(form.name, t('admin:fields.name'))!,
        adjective: cleanLocalized(form.adjective, t('admin:fields.adjective'), true),
        density_g_cm3: decimal(form.density, t('admin:fields.density'), 0.01, 999.99),
        default_flow_mm3_s: decimal(form.flow, t('admin:fields.flow'), 0.1, 999.9),
        sort_order: decimal(form.sortOrder, t('admin:fields.sort_order'), -32768, 32767, true),
        print_profile, is_active: form.active,
      };
      const result = material
        ? await supabase().from('materials').update(payload).eq('id', material.id).select().single()
        : await supabase().from('materials').insert(payload).select().single();
      if (result.error) throw result.error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['materials_active'] }),
        queryClient.invalidateQueries({ queryKey: ['materials_submit'] }),
        queryClient.invalidateQueries({ queryKey: ['product_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['available_filaments'] }),
      ]);
    }, onDone);
  }
  return <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4 rounded-lg border border-brand-200 p-4">
    <h4 className="font-medium">{material ? t('edit_material') : t('add_material')}</h4>
    <label className="block text-sm">{t('fields.slug')} *<input className="input mt-1" required value={form.slug} onChange={(e) => set('slug', e.target.value)} /></label>
    <LocalizedFields label={t('fields.name')} value={form.name} onChange={(value) => set('name', value)} />
    <LocalizedFields label={t('fields.adjective')} value={form.adjective} onChange={(value) => set('adjective', value)} required={false} />
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm">{t('fields.density')}<input className="input mt-1" required type="number" min="0.01" step="0.01" value={form.density} onChange={(e) => set('density', e.target.value)} /></label>
      <label className="text-sm">{t('fields.flow')}<input className="input mt-1" required type="number" min="0.1" step="0.1" value={form.flow} onChange={(e) => set('flow', e.target.value)} /></label>
      <label className="text-sm">{t('fields.sort_order')}<input className="input mt-1" required type="number" step="1" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} /></label>
    </div>
    <label className="block text-sm">{t('fields.print_profile')}<textarea className="input mt-1 min-h-20 font-mono text-xs" value={form.printProfile} onChange={(e) => set('printProfile', e.target.value)} placeholder="{}" /></label>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />{t('active')}</label>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

function FilamentForm({ filament, materials, onDone }: { filament?: Filament; materials: Material[]; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [form, setForm] = useState(() => filamentDraft(filament, materials[0]?.id));
  const set = <K extends keyof FilamentDraft>(key: K, value: FilamentDraft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!materials.some((material) => material.id === form.materialId)) throw new Error(t('select_material'));
      const hex = form.hex.trim();
      if (hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(t('invalid_hex'));
      const payload = {
        material_id: form.materialId, color: cleanLocalized(form.color, t('fields.color'))!,
        color_hex: hex || null, diameter: decimal(form.diameter, t('fields.diameter'), 0.01, 99.99),
        cost_per_gram: decimal(form.cost, t('fields.cost_per_gram'), 0, 9999.999999),
        manufacturer: form.manufacturer.trim() || null, is_active: form.active,
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
  return <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4 rounded-lg border border-brand-200 p-4">
    <h4 className="font-medium">{filament ? t('edit_filament') : t('add_filament')}</h4>
    <label className="block text-sm">{t('fields.material')} *
      <select className="input mt-1" required value={form.materialId} onChange={(e) => set('materialId', e.target.value)}>
        <option value="">—</option>{materials.map((material) => <option value={material.id} key={material.id}>{material.name.en}{!material.is_active ? ` (${t('inactive')})` : ''}</option>)}
      </select>
    </label>
    <LocalizedFields label={t('fields.color')} value={form.color} onChange={(value) => set('color', value)} />
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">{t('fields.color_hex')}<input className="input mt-1" type="text" placeholder="#123abc" value={form.hex} onChange={(e) => set('hex', e.target.value)} /></label>
      <label className="text-sm">{t('fields.manufacturer')}<input className="input mt-1" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></label>
      <label className="text-sm">{t('fields.diameter')}<input className="input mt-1" required type="number" min="0.01" step="0.01" value={form.diameter} onChange={(e) => set('diameter', e.target.value)} /></label>
      <label className="text-sm">{t('fields.cost_per_gram')}<input className="input mt-1" required type="number" min="0" step="0.000001" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></label>
    </div>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />{t('active')}</label>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
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
      const { data, error } = await supabase().from('materials').select('*').order('sort_order');
      if (error) throw error;
      return (data || []) as Material[];
    },
  });
  const filamentsQuery = useQuery<Filament[]>({
    queryKey: ['admin_filaments'],
    queryFn: async () => {
      const { data, error } = await supabase().from('filaments').select('*').order('created_at');
      if (error) throw error;
      return (data || []) as Filament[];
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

  const materials = materialsQuery.data || [];
  const filaments = filamentsQuery.data || [];
  return <div className="space-y-9">
    <h2 className="text-xl font-medium">{t('admin:materials_filaments')}</h2>
    <section>
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('admin:material_list')}</h3>
        <button className="btn text-sm" type="button" onClick={() => setEditingMaterial('new')}>{t('admin:add_material')}</button></div>
      <AdminQueryState loading={materialsQuery.isPending} error={materialsQuery.error} />
      {materials.length === 0 && !materialsQuery.isPending && <p className="mt-3 text-slate-500">{t('admin:no_materials')}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {materials.map((material) => <div key={material.id} className="rounded border p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><strong>{t_db(material.name, locale)} ({material.slug})</strong>
            <button type="button" className="text-brand-700 underline" onClick={() => setEditingMaterial(material.id)}>{t('common:edit')}</button></div>
          <p className="text-slate-600">{t_db(material.adjective, locale) || '—'} · {material.density_g_cm3} g/cm³ · {material.default_flow_mm3_s} mm³/s</p>
          {!material.is_active && <span className="badge">{t('admin:inactive')}</span>}
        </div>)}
      </div>
      {editingMaterial && <MaterialForm key={editingMaterial} material={materials.find((material) => material.id === editingMaterial)} onDone={() => setEditingMaterial(null)} />}
    </section>
    <section>
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('admin:filament_list')}</h3>
        <button className="btn text-sm" type="button" disabled={materials.length === 0} onClick={() => setEditingFilament('new')}>{t('admin:add_filament')}</button></div>
      <p className="mt-1 text-sm text-slate-600">{t('admin:filament_help')}</p>
      <AdminQueryState loading={filamentsQuery.isPending} error={filamentsQuery.error} />
      {filaments.length === 0 && !filamentsQuery.isPending && <p className="mt-3 text-slate-500">{t('admin:no_filaments')}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filaments.map((filament) => <div key={filament.id} className="rounded border p-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="swatch shrink-0" style={{ backgroundColor: filament.color_hex || '#ccc' }} />
            <strong className="min-w-0 flex-1">{t_db(filament.color, locale)} · {t_db(materials.find((m) => m.id === filament.material_id)?.name, locale)}</strong>
            <button type="button" className="text-brand-700 underline" onClick={() => setEditingFilament(filament.id)}>{t('common:edit')}</button>
          </div>
          <p className="mt-1 text-slate-600">{filament.manufacturer || '—'} · {filament.cost_per_gram} /g</p>
          {!filament.is_active && <span className="badge">{t('admin:inactive')}</span>}
        </div>)}
      </div>
      {editingFilament && <FilamentForm key={editingFilament} filament={filaments.find((filament) => filament.id === editingFilament)} materials={materials} onDone={() => setEditingFilament(null)} />}
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
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filaments.map((filament) => <label key={filament.id} className="flex items-center gap-2 rounded border p-3 text-sm">
            <input type="checkbox" checked={stocked.has(filament.id)} disabled={action.busy || stockQuery.isPending || !filament.is_active}
              onChange={(event) => void toggleStock(filament.id, event.target.checked)} />
            <span>{t_db(materials.find((m) => m.id === filament.material_id)?.name, locale)} · {t_db(filament.color, locale)}</span>
          </label>)}
        </div>
      </>}
    </section>
  </div>;
}
