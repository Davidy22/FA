'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cleanLocalized, decimal, isoDateTime, lines, localDateTime, localizedInput, PRODUCT_STATUSES } from '@/lib/admin';
import { formatMoney, t_db } from '@/lib/format';
import { isOnSale } from '@/lib/sale';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type {
  Filament, Localized, Material, PremadeProduct, ProductCategory, ProductMaterial, ProductMaterialSlot, ProductSlotMaterial,
} from '@/lib/types';
import { AdminFeedback, AdminQueryState, FormActions, LocalizedFields, useAdminAction, useAdminLanguage, useFormPanel } from './Shared';
import { ProductOptions } from './ProductOptions';

type SlotRow = ProductMaterialSlot & { product_slot_materials: ProductSlotMaterial[] };

/** One editable part of a multi-material print. */
type SlotDraft = {
  key: string;
  linkedKey: string;
  name: Localized;
  allowed: Record<string, string>;
  defaultMaterialId: string;
  defaultFilamentId: string;
};

type Draft = {
  name: Localized; description: Localized; price: string;
  category: string; tags: string; imageUrls: string;
  sourcePath: string; featured: boolean; status: PremadeProduct['status'];
  defaultMaterialId: string; allowed: Record<string, string>;
  salePrice: string; saleStartsAt: string; saleEndsAt: string;
  slots: SlotDraft[];
};

function slotDraft(slot: SlotRow): SlotDraft {
  return {
    key: slot.id, linkedKey: slot.linked_slot_id || '',
    name: localizedInput(slot.name),
    allowed: Object.fromEntries((slot.product_slot_materials || [])
      .map((row) => [row.material_id, row.price_modifier.toString()])),
    defaultMaterialId: slot.default_material_id || '',
    defaultFilamentId: slot.default_filament_id || '',
  };
}

function draft(product?: PremadeProduct, allowed: ProductMaterial[] = [], slots: SlotRow[] = []): Draft {
  return {
    name: localizedInput(product?.name), description: localizedInput(product?.description),
    price: product?.base_price?.toString() || '0', category: product?.category || 'other',
    tags: product?.tags?.join(', ') || '', imageUrls: product?.image_urls?.join('\n') || '',
    sourcePath: product?.source_model_path || '', featured: product?.is_featured ?? false,
    status: product?.status || 'draft', defaultMaterialId: product?.default_material_id || '',
    allowed: Object.fromEntries(allowed.map((row) => [row.material_id, row.price_modifier.toString()])),
    salePrice: product?.sale_price != null ? product.sale_price.toString() : '',
    saleStartsAt: localDateTime(product?.sale_starts_at),
    saleEndsAt: localDateTime(product?.sale_ends_at),
    slots: slots.map(slotDraft),
  };
}

function ProductForm({ product, allowed, slots, materials, filaments, onDone }: {
  product?: PremadeProduct; allowed: ProductMaterial[]; slots: SlotRow[];
  materials: Material[]; filaments: Filament[]; onDone: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [form, setForm] = useState(() => draft(product, allowed, slots));
  const [showOptions, setShowOptions] = useState(!!product);
  // One language picker edits the name, the description and every slot name.
  const [language, setLanguage] = useAdminLanguage();
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const allowedIds = Object.keys(form.allowed);

  // Categories are admin-managed rows, not a fixed list in the bundle.
  const { data: categories } = useQuery<ProductCategory[]>({
    queryKey: ['product_categories'],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_categories')
        .select('*').order('sort_order', { ascending: true }).order('slug');
      if (error) throw error;
      return (data || []) as ProductCategory[];
    },
  });
  const categoryOptions = (categories || []).filter(
    (category) => category.is_active || category.slug === form.category,
  );

  function setSlot(index: number, patch: Partial<SlotDraft>) {
    setForm((previous) => ({
      ...previous,
      slots: previous.slots.map((slot, position) => (position === index ? { ...slot, ...patch } : slot)),
    }));
  }
  function moveSlot(index: number, by: number) {
    setForm((previous) => {
      const target = index + by;
      if (target < 0 || target >= previous.slots.length) return previous;
      const slots = [...previous.slots];
      [slots[index], slots[target]] = [slots[target], slots[index]];
      return { ...previous, slots };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!product && !modelFile) throw new Error(t('admin:model_required'));
      if (modelFile && !/\.(stl|obj|3mf)$/i.test(modelFile.name)) {
        throw new Error(t('admin:model_invalid'));
      }
      for (const file of imageFiles) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          throw new Error(t('admin:image_invalid'));
        }
      }
      const selected = allowedIds.map((material_id) => ({
        material_id, price_modifier: decimal(form.allowed[material_id], t('admin:fields.price_modifier'), -99999999, 99999999),
      }));
      const basePrice = decimal(form.price, t('admin:fields.base_price'), 0, 99999999);
      const salePrice = form.salePrice.trim() === ''
        ? null : decimal(form.salePrice, t('admin:fields.sale_price'), 0, 99999999);
      if (salePrice !== null && salePrice >= basePrice) throw new Error(t('admin:sale_below_price'));
      const saleStartsAt = isoDateTime(form.saleStartsAt);
      const saleEndsAt = isoDateTime(form.saleEndsAt);
      if (saleStartsAt && saleEndsAt && new Date(saleEndsAt) <= new Date(saleStartsAt)) {
        throw new Error(t('admin:invalid_date_range'));
      }

      // Multi-material prints: every slot needs a name, at least one material it
      // can be printed in, and a default material from that list.
      const slotPayload = form.slots.map((slot, index) => {
        const name = cleanLocalized(slot.name, t('admin:fields.slot_name'))!;
        const sourceIndex = slot.linkedKey ? form.slots.findIndex((candidate) => candidate.key === slot.linkedKey) : -1;
        if (slot.linkedKey && (sourceIndex < 0 || sourceIndex === index || form.slots[sourceIndex].linkedKey)) {
          throw new Error(t('admin:linked_slot_invalid'));
        }
        const settings = sourceIndex >= 0 ? form.slots[sourceIndex] : slot;
        const ids = Object.keys(settings.allowed);
        const position = index + 1;
        if (!ids.length) throw new Error(t('admin:slot_needs_material', { number: position }));
        if (!settings.defaultMaterialId || !ids.includes(settings.defaultMaterialId)) {
          throw new Error(t('admin:slot_default_required', { number: position }));
        }
        if (form.status === 'published' && !materials.some((material) => material.id === settings.defaultMaterialId && material.is_active)) {
          throw new Error(t('admin:slot_default_inactive', { number: position }));
        }
        if (settings.defaultFilamentId && !filaments.some((filament) =>
          filament.id === settings.defaultFilamentId && filament.material_id === settings.defaultMaterialId && filament.is_active)) {
          throw new Error(t('admin:slot_default_color_invalid', { number: position }));
        }
        return {
          name, sort_order: index,
          default_material_id: settings.defaultMaterialId || null,
          default_filament_id: settings.defaultFilamentId || null,
          ...(sourceIndex >= 0 ? { linked_ordinal: sourceIndex + 1 } : {}),
          materials: ids.map((material_id) => ({
            material_id,
            price_modifier: decimal(settings.allowed[material_id], t('admin:fields.price_modifier'), -99999999, 99999999),
          })),
        };
      });

      // A product printed from slots takes its materials from them, so the
      // product-level default only applies to single-material prints.
      if (!slotPayload.length && form.status === 'published' && (!selected.length || !form.defaultMaterialId ||
        !selected.some((row) => row.material_id === form.defaultMaterialId) ||
        !materials.some((material) => material.id === form.defaultMaterialId && material.is_active))) {
        throw new Error(t('admin:publish_requires_material'));
      }
      if (!slotPayload.length && form.defaultMaterialId && !allowedIds.includes(form.defaultMaterialId)) {
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
          ...(product ? { id: product.id } : {}), slug: product?.slug || '',
          name: cleanLocalized(form.name, t('admin:fields.name'))!,
          description: cleanLocalized(form.description, t('admin:fields.description'), true),
          base_price: basePrice,
          default_material_id: slotPayload.length ? null : (form.defaultMaterialId || null),
          category: form.category, tags: lines(form.tags), image_urls: imageUrls,
          source_model_path: sourcePath, is_featured: form.featured, status: form.status,
          sale_price: salePrice, sale_starts_at: saleStartsAt, sale_ends_at: saleEndsAt,
        };
        const { error } = await supabase().rpc('admin_save_product', {
          p_product: payload, p_materials: selected, p_slots: slotPayload,
        });
        if (error) throw error;
      } catch (error) {
        await Promise.all(uploaded.map(({ bucket, path }) => supabase().storage.from(bucket).remove([path])));
        throw error;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_products'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_product_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_product_slots'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product'] }),
        queryClient.invalidateQueries({ queryKey: ['product_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['product_slots'] }),
        queryClient.invalidateQueries({ queryKey: ['product_slot_materials'] }),
      ]);
    }, onDone);
  }

  return <><form ref={panel} onSubmit={(event) => void submit(event)} className="mt-5 space-y-4 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h3 className="font-medium">{product ? t('admin:edit_product') : t('admin:add_product')}</h3>
    {product && <p className="text-xs text-slate-500">{t('admin:fields.product_id')}: <span className="font-mono">{product.id}</span></p>}
    <LocalizedFields language={language} onLanguageChange={setLanguage} fields={[
      { label: t('admin:fields.name'), value: form.name, onChange: (value) => set('name', value) },
      { label: t('admin:fields.description'), value: form.description, onChange: (value) => set('description', value), multiline: true, required: false },
    ]} />
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm">{t('admin:fields.base_price')}<input className="input mt-1" type="number" required min="0" step="0.01" value={form.price} onChange={(event) => set('price', event.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.category')}<select className="input mt-1" value={form.category} onChange={(event) => set('category', event.target.value)}>
        {categoryOptions.map((category) => <option key={category.slug} value={category.slug}>
          {category.parent_id ? '— ' : ''}{t_db(category.name, locale)}{category.is_active ? '' : ` (${t('admin:inactive')})`}
        </option>)}
        {!categoryOptions.some((category) => category.slug === form.category) && form.category &&
          <option value={form.category}>{form.category}</option>}
      </select></label>
      <label className="text-sm">{t('admin:fields.status')}<select className="input mt-1" value={form.status} onChange={(event) => set('status', event.target.value as Draft['status'])}>
        {PRODUCT_STATUSES.map((status) => <option key={status} value={status}>{t(`admin:product_status.${status}`)}</option>)}
      </select></label>
    </div>
    <fieldset className="rounded border p-3"><legend className="px-1 text-sm font-medium">{t('admin:sale_price')}</legend>
      <p className="text-xs text-slate-600">{t('admin:sale_help')}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">{t('admin:fields.sale_price')}
          <input className="input mt-1" type="number" min="0" step="0.01" value={form.salePrice}
            placeholder={t('admin:no_sale')} onChange={(event) => set('salePrice', event.target.value)} />
        </label>
        <label className="text-sm">{t('admin:fields.sale_starts_at')}
          <input className="input mt-1" type="datetime-local" value={form.saleStartsAt}
            onChange={(event) => set('saleStartsAt', event.target.value)} />
        </label>
        <label className="text-sm">{t('admin:fields.sale_ends_at')}
          <input className="input mt-1" type="datetime-local" value={form.saleEndsAt}
            onChange={(event) => set('saleEndsAt', event.target.value)} />
        </label>
      </div>
      {salePreview(form.price, form.salePrice) && (
        <p className="mt-2 text-xs text-rose-700">{salePreview(form.price, form.salePrice)}</p>
      )}
    </fieldset>
    <label className="block text-sm">{t('admin:fields.tags')}<input className="input mt-1" value={form.tags} onChange={(event) => set('tags', event.target.value)} placeholder="gift, desk" /></label>
    <label className="block text-sm">{t('admin:fields.model_file')}{!product ? ' *' : ''}<input className="mt-1 block w-full text-sm" type="file" accept=".stl,.obj,.3mf" onChange={(event) => setModelFile(event.target.files?.[0] || null)} /></label>
    {product && <p className="break-all text-xs text-slate-500">{t('admin:current_file')}: {form.sourcePath}</p>}
    <label className="block text-sm">{t('admin:fields.image_upload')}<input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImageFiles(Array.from(event.target.files || []))} /></label>
    <label className="block text-sm">{t('admin:fields.image_urls')}<textarea className="input mt-1 min-h-20" value={form.imageUrls} onChange={(event) => set('imageUrls', event.target.value)} placeholder="https://…" /></label>
    <p className="text-xs text-slate-500">{t('admin:images_hint')}</p>

    <fieldset className="rounded border p-3"><legend className="px-1 text-sm font-medium">{t('admin:material_slots')}</legend>
      <p className="text-xs text-slate-600">{t('admin:material_slots_help')}</p>
      <div className="mt-3 space-y-3">
        {form.slots.map((slot, index) => {
          const linkedSource = form.slots.find((candidate) => candidate.key === slot.linkedKey);
          const settings = linkedSource || slot;
          const slotMaterialIds = Object.keys(settings.allowed);
          const defaultColors = filaments.filter((filament) =>
            filament.material_id === settings.defaultMaterialId && filament.is_active);
          return (
            <div key={slot.key} className="rounded border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm">{t('admin:slot_number', { number: index + 1 })}</strong>
                <span className="flex gap-2">
                  <button type="button" className="btn-outline text-xs" aria-label={t('admin:move_up')}
                    disabled={index === 0} onClick={() => moveSlot(index, -1)}>↑</button>
                  <button type="button" className="btn-outline text-xs" aria-label={t('admin:move_down')}
                    disabled={index === form.slots.length - 1} onClick={() => moveSlot(index, 1)}>↓</button>
                  <button type="button" className="text-xs text-red-700 underline"
                    onClick={() => set('slots', form.slots.filter((_, position) => position !== index).map((candidate) => candidate.linkedKey === slot.key ? { ...candidate, linkedKey: '', allowed: { ...slot.allowed }, defaultMaterialId: slot.defaultMaterialId, defaultFilamentId: slot.defaultFilamentId } : candidate))}>{t('common:delete')}</button>
                </span>
              </div>
              <label className="mt-2 block text-xs text-slate-600">{t('admin:fields.linked_material_slot')}
                <select className="input mt-1 text-sm" value={slot.linkedKey} onChange={(event) => setSlot(index, { linkedKey: event.target.value })}>
                  <option value="">{t('admin:independent_material_slot')}</option>
                  {form.slots.map((candidate, candidateIndex) => candidateIndex !== index && !candidate.linkedKey &&
                    <option key={candidate.key} value={candidate.key}>{t('admin:slot_number', { number: candidateIndex + 1 })}</option>)}
                </select>
                <span className="mt-1 block text-xs text-slate-500">{t('admin:linked_slot_help')}</span>
              </label>
              {/* Slot names follow the form's single language picker. */}
              <label className="mt-2 block text-xs text-slate-600">{t('admin:fields.slot_name')} *
                <input className="input mt-1 text-sm" value={slot.name[language] || ''}
                  onChange={(event) => setSlot(index, { name: { ...slot.name, [language]: event.target.value } })} />
              </label>
              <p className="mt-2 text-xs font-medium text-slate-600">{t('admin:slot_materials')}</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {materials.map((material) => <div key={material.id} className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={!!linkedSource} checked={material.id in settings.allowed} onChange={(event) => {
                      const next = { ...slot.allowed };
                      if (event.target.checked) next[material.id] = '0'; else delete next[material.id];
                      const patch: Partial<SlotDraft> = { allowed: next };
                      if (!event.target.checked && slot.defaultMaterialId === material.id) {
                        patch.defaultMaterialId = '';
                        patch.defaultFilamentId = '';
                      }
                      setSlot(index, patch);
                    }} />{t_db(material.name, locale)} {!material.is_active && `(${t('admin:inactive')})`}
                  </label>
                  {material.id in settings.allowed && !linkedSource && <label className="ml-auto text-xs">{t('admin:fields.price_modifier')}
                    <input className="input mt-1 w-24 text-sm" type="number" step="0.01" value={settings.allowed[material.id]}
                      onChange={(event) => setSlot(index, { allowed: { ...slot.allowed, [material.id]: event.target.value } })} />
                  </label>}
                </div>)}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">{t('admin:fields.slot_default_material')}
                  <select className="input mt-1" value={settings.defaultMaterialId} disabled={!!linkedSource} onChange={(event) =>
                    setSlot(index, { defaultMaterialId: event.target.value, defaultFilamentId: '' })}>
                    <option value="">—</option>
                    {materials.filter((material) => slotMaterialIds.includes(material.id)).map((material) =>
                      <option key={material.id} value={material.id}>{t_db(material.name, locale)}</option>)}
                  </select>
                </label>
                <label className="text-sm">{t('admin:fields.slot_default_color')}
                  <select className="input mt-1" value={settings.defaultFilamentId} disabled={!!linkedSource || !settings.defaultMaterialId}
                    onChange={(event) => setSlot(index, { defaultFilamentId: event.target.value })}>
                    <option value="">{t('admin:first_in_stock')}</option>
                    {defaultColors.map((filament) => <option key={filament.id} value={filament.id}>{t_db(filament.color, locale)}</option>)}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn-outline mt-3 text-sm" onClick={() =>
        set('slots', [...form.slots, { key: crypto.randomUUID(), linkedKey: '', name: localizedInput(null), allowed: {}, defaultMaterialId: '', defaultFilamentId: '' }])}>
        {t('admin:add_slot')}
      </button>
    </fieldset>

    {!form.slots.length && <fieldset className="rounded border p-3"><legend className="px-1 text-sm font-medium">{t('admin:allowed_materials')}</legend>
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
      <p className="mt-2 text-xs text-slate-500">{t('admin:single_material_hint')}</p>
    </fieldset>}
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.featured} onChange={(event) => set('featured', event.target.checked)} />{t('admin:fields.featured')}</label>
    <p className="text-xs text-slate-600">{t('admin:archive_hint')}</p>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>
  {product && showOptions && <ProductOptions product={product} onClose={() => setShowOptions(false)} />}
  {product && !showOptions && <button type="button" className="btn-outline mt-3 text-sm" onClick={() => setShowOptions(true)}>{t('admin:edit_options')}</button>}
  </>;
}

/** Live preview of the struck-through price while an admin types a sale. */
function salePreview(price: string, salePrice: string): string | null {
  const regular = Number(price);
  const sale = Number(salePrice);
  if (!salePrice.trim() || !Number.isFinite(regular) || !Number.isFinite(sale)) return null;
  if (sale >= regular) return null;
  return `${formatMoney(regular, 'en')} → ${formatMoney(sale, 'en')}`;
}

export function AdminProducts() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editing, setEditing] = useState<string | null>(null);
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
      const { data, error } = await supabase().from('materials').select('*').order('name->>en');
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
  const allowedQuery = useQuery<ProductMaterial[]>({
    queryKey: ['admin_product_materials'],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_materials').select('*');
      if (error) throw error;
      return (data || []) as ProductMaterial[];
    },
  });
  const slotsQuery = useQuery<SlotRow[]>({
    queryKey: ['admin_product_slots'],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_material_slots')
        .select('*, product_slot_materials(*)').order('sort_order');
      if (error) throw error;
      return (data || []) as unknown as SlotRow[];
    },
  });
  const products = productsQuery.data || [];
  const slots = slotsQuery.data || [];
  const filtered = products.filter((product) =>
    `${product.slug} ${product.name.en}`.toLowerCase().includes(search.trim().toLowerCase()));
  const loading = productsQuery.isPending || materialsQuery.isPending || allowedQuery.isPending ||
    slotsQuery.isPending || filamentsQuery.isPending;
  const queryError = productsQuery.error || materialsQuery.error || allowedQuery.error || slotsQuery.error || filamentsQuery.error;

  async function deleteProduct(product: PremadeProduct) {
    if (!window.confirm(`${t('common:delete')} ${t_db(product.name, locale)}?`)) return;
    await action.run(async () => {
      const { error } = await supabase().from('premade_products').delete().eq('id', product.id);
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_products'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_product_materials'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_product_slots'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
    });
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <h2 className="text-xl font-medium">{t('admin:products')}</h2>
      <p className="text-sm text-slate-600">{t('admin:products_help')}</p>
    </div><button type="button" className="btn text-sm" onClick={() => setEditing('new')}>{t('admin:add_product')}</button></div>
    {editing && !loading && !queryError && <ProductForm key={editing}
      product={products.find((product) => product.id === editing)} materials={materialsQuery.data || []}
      filaments={filamentsQuery.data || []}
      allowed={(allowedQuery.data || []).filter((row) => row.product_id === editing)}
      slots={slots.filter((slot) => slot.product_id === editing)} onDone={() => setEditing(null)} />}
    <AdminFeedback error={action.error} notice={action.notice} />
    <AdminQueryState loading={loading} error={queryError} />
    <label className="mt-4 block max-w-sm text-sm">{t('common:search')}<input className="input mt-1" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {products.length === 0 && !productsQuery.isPending && <p className="mt-4 text-slate-500">{t('admin:no_products')}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {filtered.map((product) => {
        const productSlots = slots.filter((slot) => slot.product_id === product.id);
        const onSale = isOnSale(product);
        return <article key={product.id} className="rounded-lg border p-4">
          <div className="flex justify-between gap-3"><div>
            <h3 className="font-medium">{t_db(product.name, locale)}</h3>
            <p className="text-xs text-slate-500">/{product.slug} · {t(`admin:product_status.${product.status}`)}</p>
            {productSlots.length > 0 && (
              <p className="mt-1"><span className="badge">{t('admin:slots_badge', { number: productSlots.length })}</span></p>
            )}
          </div><strong className="whitespace-nowrap text-sm">
            {onSale ? <>
              <s className="mr-1 font-normal text-slate-400">{formatMoney(product.base_price, locale)}</s>
              <span className="text-rose-700">{formatMoney(Number(product.sale_price), locale)}</span>
            </> : formatMoney(product.base_price, locale)}
          </strong></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-outline text-sm" onClick={() => setEditing(product.id)}>{t('common:edit')}</button>
            <button type="button" className="text-sm text-red-700 underline" disabled={action.busy}
              onClick={() => void deleteProduct(product)}>{t('common:delete')}</button>
          </div>
        </article>;
      })}
    </div>
  </>;
}
