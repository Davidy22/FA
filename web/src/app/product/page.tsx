'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueries } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { t_db, formatMaterial, formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';
import { useLocation } from '@/store/location';
import { useSelectedLocation } from '@/hooks/useLocations';
import { fetchAvailableFilaments } from '@/hooks/useAvailableFilaments';
import { useCart } from '@/store/cart';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Price } from '@/components/Price';
import { effectivePrice } from '@/lib/sale';
import { ColorSwatchGrid } from '@/components/ColorSwatchGrid';
import type {
  FileOptionConfig, Filament, Material, PremadeProduct, ProductMaterial, ProductMaterialSlot,
  ProductOptionChoice, ProductOptionGroup, ProductSlotMaterial, SlotSelection, TextOptionConfig,
} from '@/lib/types';
import { Suspense } from 'react';

function ProductDetail({ slug }: { slug: string }) {
  const { t } = useTranslation(['common','catalog','errors']);
  const locale = useLocale((s) => s.locale);
  const locationId = useLocation((s) => s.selectedLocationId);
  const currency = useSelectedLocation()?.currency;
  const addItem = useCart((s) => s.addItem);

  const { data: product, isPending: productPending, error: productError } = useQuery<PremadeProduct | null>({
    queryKey: ['product', slug],
    queryFn: async () => {
      const { data, error } = await supabase().from('premade_products').select('*')
        .eq('slug', slug).eq('status', 'published').single();
      if (error && error.code !== 'PGRST116') throw error;
      return data as PremadeProduct | null;
    },
  });

  const { data: materials, error: materialsError } = useQuery<(ProductMaterial & { material: Material })[]>({
    queryKey: ['product_materials', product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data, error } = await supabase().from('product_materials')
        .select('*, material:materials(*)').eq('product_id', product!.id);
      if (error) throw error;
      return (data || []).filter((row) => row.material?.is_active) as (ProductMaterial & { material: Material })[];
    },
  });

  // Multi-material prints: each slot is a named part of the print with its own
  // list of materials it can be printed in, plus a default material and colour.
  const { data: slots, error: slotsError } = useQuery<ProductMaterialSlot[]>({
    queryKey: ['product_slots', product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data, error } = await supabase().from('product_material_slots')
        .select('*').eq('product_id', product!.id).order('sort_order').order('id');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: slotMaterials, error: slotMaterialsError } = useQuery<Record<string, (ProductSlotMaterial & { material: Material })[]>>({
    queryKey: ['product_slot_materials', slots?.map((slot) => slot.id)],
    enabled: !!slots?.length,
    queryFn: async () => {
      const { data, error } = await supabase().from('product_slot_materials')
        .select('*, material:materials(*)').in('slot_id', slots!.map((slot) => slot.id));
      if (error) throw error;
      const out: Record<string, (ProductSlotMaterial & { material: Material })[]> = {};
      for (const row of (data || []).filter((entry) => entry.material?.is_active)) {
        (out[row.slot_id] ||= []).push(row);
      }
      return out;
    },
  });

  const [materialId, setMaterialId] = useState<string | null>(null);
  const [filamentId, setFilamentId] = useState<string | null>(null);
  const [slotPicks, setSlotPicks] = useState<Record<string, SlotSelection>>({});
  const [options, setOptions] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [adding, setAdding] = useState(false);
  const [fileInputRevision, setFileInputRevision] = useState(0);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const hasSlots = !!slots?.length;

  const eligibleFor = (slot: ProductMaterialSlot) => slotMaterials?.[slot.id] || [];
  const sourceSlot = (slot: ProductMaterialSlot) =>
    (slot.linked_slot_id && slots?.find((candidate) => candidate.id === slot.linked_slot_id)) || slot;

  /** The material a slot is printed in: the customer's pick, else the default. */
  function slotMaterialId(slot: ProductMaterialSlot): string | null {
    const source = sourceSlot(slot);
    const eligible = eligibleFor(slot);
    const picked = slotPicks[source.id]?.material_id;
    if (picked && eligible.some((entry) => entry.material_id === picked)) return picked;
    if (source.default_material_id && eligible.some((entry) => entry.material_id === source.default_material_id)) {
      return source.default_material_id;
    }
    return eligible[0]?.material_id || null;
  }

  /** The colour for a slot, from stock at the chosen location. */
  function slotColorId(slot: ProductMaterialSlot, colors: Filament[] | undefined): string | null {
    if (!colors?.length) return null;
    const source = sourceSlot(slot);
    const picked = slotPicks[source.id]?.color_filament_id;
    if (picked && colors.some((color) => color.id === picked)) return picked;
    if (source.default_filament_id && colors.some((color) => color.id === source.default_filament_id)) {
      return source.default_filament_id;
    }
    return null;
  }

  const selectedMaterialId = materialId ||
    materials?.find((row) => row.material_id === product?.default_material_id)?.material_id ||
    materials?.[0]?.material_id || null;

  const { data: colors, error: colorsError } = useQuery<Filament[]>({
    queryKey: ['available_filaments', locationId, selectedMaterialId],
    enabled: !hasSlots && !!locationId && !!selectedMaterialId,
    queryFn: () => fetchAvailableFilaments(locationId!, selectedMaterialId!),
  });

  const slotColors = useQueries({
    queries: (slots || []).map((slot) => {
      const slotMaterial = slotMaterialId(slot);
      return {
        queryKey: ['available_filaments', locationId, slotMaterial],
        enabled: !!locationId && !!slotMaterial,
        queryFn: () => fetchAvailableFilaments(locationId!, slotMaterial!),
      };
    }),
  });

  const { data: groups, error: groupsError } = useQuery<ProductOptionGroup[]>({
    queryKey: ['groups', product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data, error } = await supabase().from('product_option_groups')
        .select('*').eq('product_id', product!.id).order('sort_order');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: choicesByGroup, error: choicesError } = useQuery<Record<string, ProductOptionChoice[]>>({
    queryKey: ['choices', product?.id, groups?.map((group) => group.id)],
    enabled: !!product && !!groups,
    queryFn: async () => {
      if (!groups?.length) return {};
      const { data, error } = await supabase().from('product_option_choices')
        .select('*').in('group_id', groups.map((g) => g.id));
      if (error) throw error;
      const out: Record<string, ProductOptionChoice[]> = {};
      for (const c of data || []) (out[c.group_id] ||= []).push(c);
      return out;
    },
  });

  const { data: textConfigs, error: textConfigsError } = useQuery<Record<string, TextOptionConfig>>({
    queryKey: ['text_configs', product?.id, groups?.map((group) => group.id)],
    enabled: !!product && !!groups,
    queryFn: async () => {
      if (!groups?.length) return {};
      const { data, error } = await supabase().from('text_option_config')
        .select('*').in('group_id', groups.map((g) => g.id));
      if (error) throw error;
      const out: Record<string, TextOptionConfig> = {};
      for (const c of data || []) out[c.group_id] = c;
      return out;
    },
  });

  const { data: fileConfigs, error: fileConfigsError } = useQuery<Record<string, FileOptionConfig>>({
    queryKey: ['file_configs', product?.id, groups?.map((group) => group.id)],
    enabled: !!product && !!groups,
    queryFn: async () => {
      if (!groups?.length) return {};
      const { data, error } = await supabase().from('file_option_config')
        .select('*').in('group_id', groups.map((g) => g.id));
      if (error) throw error;
      return Object.fromEntries((data || []).map((config) => [config.group_id, config]));
    },
  });

  /** An estimate for the page; price_cart is the source of truth at checkout. */
  const price = useMemo(() => {
    if (!product) return { regular: 0, now: 0 };
    let modifiers = 0;
    if (hasSlots) {
      for (const slot of slots || []) {
        const entry = eligibleFor(slot).find((row) => row.material_id === slotMaterialId(slot));
        if (entry) modifiers += entry.price_modifier;
      }
    } else {
      const pm = materials?.find((m) => m.material_id === selectedMaterialId);
      if (pm) modifiers += pm.price_modifier;
    }
    for (const g of groups || []) {
      const sel = options[g.id];
      if (!sel) continue;
      if (g.option_type === 'select_one' && sel.choice_id) {
        const c = choicesByGroup?.[g.id]?.find((x) => x.id === sel.choice_id);
        if (c) modifiers += effectivePrice(c.price_modifier, c);
      } else if (g.option_type === 'select_many' && sel.choice_ids) {
        for (const cid of sel.choice_ids as string[]) {
          const c = choicesByGroup?.[g.id]?.find((x) => x.id === cid);
          if (c) modifiers += effectivePrice(c.price_modifier, c);
        }
      } else if (g.option_type === 'text' && sel.text?.trim()) {
        const cfg = textConfigs?.[g.id];
        if (cfg) modifiers += cfg.price_modifier;
      }
    }
    const regular = product.base_price + modifiers;
    const now = effectivePrice(product.base_price, product) + modifiers;
    return { regular: Math.max(regular, 0), now: Math.max(now, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, materials, selectedMaterialId, slots, slotMaterials, slotPicks, hasSlots,
      groups, options, choicesByGroup, textConfigs]);

  const everySlotHasColor = !hasSlots || (slots || []).every((slot, index) =>
    !!slotColorId(slot, slotColors[index]?.data as Filament[] | undefined));

  const canAdd = useMemo(() => {
    if (!product || !locationId || !groups || !everySlotHasColor) return false;
    if (!hasSlots && (!filamentId || !colors?.some((color) => color.id === filamentId))) return false;
    if (groups.some((group) => group.option_type === 'file') && !fileConfigs) return false;
    for (const group of groups) {
      if (!group.required && !fileConfigs?.[group.id]?.required) continue;
      const selected = options[group.id];
      if (group.option_type === 'select_one' && !selected?.choice_id) return false;
      if (group.option_type === 'select_many' && !selected?.choice_ids?.length) return false;
      if (group.option_type === 'text' && !selected?.text?.trim()) return false;
      if (group.option_type === 'file' && !files[group.id] && !selected?.file_path) return false;
    }
    return true;
  }, [product, locationId, groups, everySlotHasColor, hasSlots, filamentId, colors, options, files, fileConfigs]);

  function slotSelections(): Record<string, SlotSelection> {
    const out: Record<string, SlotSelection> = {};
    for (const [index, slot] of (slots || []).entries()) {
      out[slot.id] = {
        material_id: slotMaterialId(slot),
        color_filament_id: slotColorId(slot, slotColors[index]?.data as Filament[] | undefined),
      };
    }
    return out;
  }

  async function addToCart() {
    if (!product || !canAdd || adding) return;
    setAdding(true);
    setAddError(null);
    const uploaded: string[] = [];
    try {
      const nextOptions = { ...options };
      for (const group of groups || []) {
        const file = files[group.id];
        if (group.option_type !== 'file' || !file) continue;
        const config = fileConfigs?.[group.id];
        if (!config || !config.allowed_mime_types.includes(file.type) || file.size > config.max_size_bytes) {
          throw new Error(t('catalog:file_invalid'));
        }
        const { data: { user } } = await supabase().auth.getUser();
        if (!user) throw new Error(t('catalog:file_sign_in'));
        const extension = file.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0]?.toLowerCase() || '';
        const path = `${user.id}/${crypto.randomUUID()}${extension}`;
        const { error } = await supabase().storage.from('option-uploads').upload(path, file, { contentType: file.type });
        if (error) throw error;
        uploaded.push(path);
        nextOptions[group.id] = { file_path: path };
      }
      const picks = hasSlots ? slotSelections() : undefined;
      addItem({
        kind: 'premade',
        product_id: product.id,
        // The first slot's material doubles as the line's headline material.
        material_id: hasSlots ? (picks?.[(slots || [])[0].id]?.material_id ?? null) : selectedMaterialId,
        color_filament_id: hasSlots ? (picks?.[(slots || [])[0].id]?.color_filament_id ?? null) : filamentId,
        slots: picks,
        quantity: 1,
        options: nextOptions,
      });
      setOptions(nextOptions);
      setFiles({});
      setFileInputRevision((previous) => previous + 1);
      setAdded(true);
    } catch (error) {
      if (uploaded.length) await supabase().storage.from('option-uploads').remove(uploaded);
      setAddError((error as Error).message);
    } finally {
      setAdding(false);
    }
  }

  if (productPending) return <div className="container-ma py-8">{t('common:loading')}</div>;
  if (productError) return <div className="container-ma py-8 text-red-700" role="alert">{productError.message}</div>;
  if (!product) return <div className="container-ma py-8">
    <p>{t('catalog:product_unavailable')}</p>
    <Link className="mt-2 inline-block text-brand-700 underline" href="/catalog">{t('catalog:browse')}</Link>
  </div>;
  const detailError = materialsError || slotsError || slotMaterialsError || colorsError || groupsError ||
    choicesError || textConfigsError || fileConfigsError;

  return (
    <div className="container-ma py-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
      <div className="aspect-square bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
        {product.image_urls?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_urls[0]} alt="" className="w-full h-full object-cover rounded-lg" />
        ) : '3D Preview'}
      </div>
      <div>
        <h1 className="text-3xl font-bold">{t_db(product.name, locale)}</h1>
        {product.submitted_by && <p className="mt-1 text-sm text-emerald-700">{t('common:community_design')}</p>}
        <p className="mt-3 text-slate-700 whitespace-pre-wrap">{t_db(product.description, locale)}</p>
        <Price className="mt-4 block text-2xl" regular={price.regular} now={price.now} currency={currency} badge />
        {detailError && <p role="alert" className="mt-3 text-sm text-red-700">{t('catalog:product_load_error')}: {detailError.message}</p>}

        {!locationId && <p className="mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded text-sm">{t('errors:select_location_first')}</p>}

        {hasSlots && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-slate-600">{t('catalog:slots_intro')}</p>
            {(slots || []).map((slot, index) => {
              const eligible = eligibleFor(slot);
              const chosenMaterial = slotMaterialId(slot);
              const slotColorOptions = slotColors[index]?.data as Filament[] | undefined;
              const chosenColor = slotColorId(slot, slotColorOptions);
              const linkedSource = slot.linked_slot_id ? slots?.find((candidate) => candidate.id === slot.linked_slot_id) : null;
              const choiceSlotId = linkedSource?.id || slot.id;
              return (
                <div key={slot.id} className="rounded border border-slate-200 p-3">
                  <label className="label">{t_db(slot.name, locale)}</label>
                  {linkedSource && <p className="mb-2 text-xs text-slate-500">{t('catalog:linked_slot_choice_help', { slot: t_db(linkedSource.name, locale) })}</p>}
                  <div className="space-y-2">
                    {eligible.map((entry) => (
                      <label key={entry.material_id} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name={`slot-material-${slot.id}`} disabled={!!linkedSource}
                          checked={chosenMaterial === entry.material_id}
                          onChange={() => setSlotPicks((previous) => ({
                            ...previous,
                            [choiceSlotId]: { material_id: entry.material_id, color_filament_id: null },
                          }))} />
                        <span>{formatMaterial(entry.material, locale, { priceModifier: entry.price_modifier })}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3">
                    <span className="label">{t('catalog:select_color')}</span>
                    {!slotColorOptions?.length ? <p className="text-sm text-slate-500">{t('catalog:no_colors_in_stock')}</p> : (
                      <ColorSwatchGrid
                        colors={slotColorOptions}
                        selectedId={chosenColor}
                        name={`slot-color-${slot.id}`}
                        disabled={!!linkedSource}
                        onSelect={(colorId) => setSlotPicks((previous) => ({
                          ...previous,
                          [choiceSlotId]: { ...(previous[choiceSlotId] || {}), color_filament_id: colorId },
                        }))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!hasSlots && materials && materials.length > 1 && (
          <div className="mt-6">
            <label className="label">{t('catalog:select_material')}</label>
            <div className="space-y-2">
              {materials.map((pm) => (
                <label key={pm.material_id} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="material"
                    checked={selectedMaterialId === pm.material_id}
                    onChange={() => { setMaterialId(pm.material_id); setFilamentId(null); }} />
                  <span>{formatMaterial(pm.material, locale, { priceModifier: pm.price_modifier })}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {!hasSlots && materials && materials.length === 1 && <p className="mt-4 badge">{formatMaterial(materials[0].material, locale)}</p>}

        {!hasSlots && (
          <div className="mt-6">
            <label className="label">{t('catalog:select_color')}</label>
            {!colors?.length ? <p className="text-sm text-slate-500">—</p> : (
              <ColorSwatchGrid colors={colors} selectedId={filamentId} name="color" onSelect={setFilamentId} />
            )}
          </div>
        )}

        {groups?.map((g) => {
          const cs = choicesByGroup?.[g.id] || [];
          const choiceLabel = (c: ProductOptionChoice) => {
            const regular = c.price_modifier;
            const now = effectivePrice(regular, c);
            const modifier = now ? `${now > 0 ? '+' : '−'}${formatMoney(Math.abs(now), locale, currency)}` : '';
            return (
              <span>
                {t_db(c.label, locale)}{' '}
                {now !== regular
                  ? <><s className="text-slate-400">{regular ? `${regular > 0 ? '+' : '−'}${formatMoney(Math.abs(regular), locale, currency)}` : ''}</s> <span className="text-rose-700">{modifier}</span></>
                  : modifier}
              </span>
            );
          };
          return (
            <div key={g.id} className="mt-6">
              <label className="label">{t_db(g.label, locale)}{g.required && <span aria-hidden="true"> *</span>}</label>
              {g.option_type === 'select_one' && (
                <div className="space-y-2">
                  {[...cs].sort((a,b)=>a.sort_order-b.sort_order).map((c) => (
                    <label key={c.id} className="flex items-center gap-2">
                      <input type="radio" name={`g-${g.id}`}
                        checked={options[g.id]?.choice_id === c.id}
                        onChange={() => setOptions((o) => ({ ...o, [g.id]: { choice_id: c.id } }))}
                      />
                      {choiceLabel(c)}
                    </label>
                  ))}
                </div>
              )}
              {g.option_type === 'select_many' && (
                <div className="space-y-2">
                  {[...cs].sort((a,b)=>a.sort_order-b.sort_order).map((c) => {
                    const sel = new Set<string>(options[g.id]?.choice_ids || []);
                    return (
                      <label key={c.id} className="flex items-center gap-2">
                        <input type="checkbox"
                          checked={sel.has(c.id)}
                          onChange={(e) => {
                            const next = new Set(sel);
                            if (e.target.checked) next.add(c.id); else next.delete(c.id);
                            setOptions((o) => ({ ...o, [g.id]: { choice_ids: Array.from(next) } }));
                          }}
                        />
                        {choiceLabel(c)}
                      </label>
                    );
                  })}
                </div>
              )}
              {g.option_type === 'text' && (
                <input className="input" aria-label={t_db(g.label, locale)} maxLength={textConfigs?.[g.id]?.max_length || 100}
                  value={options[g.id]?.text || ''}
                  onChange={(e) => setOptions((o) => ({ ...o, [g.id]: { text: e.target.value } }))}
                />
              )}
              {g.option_type === 'file' && <>
                <input key={fileInputRevision} type="file" className="block w-full text-sm" aria-label={t_db(g.label, locale)}
                  accept={fileConfigs?.[g.id]?.allowed_mime_types.join(',')}
                  onChange={(event) => {
                    setFiles((previous) => ({ ...previous, [g.id]: event.target.files?.[0] || null }));
                    setOptions((previous) => { const next = { ...previous }; delete next[g.id]; return next; });
                  }} />
                {fileConfigs?.[g.id] && <p className="mt-1 text-xs text-slate-500">
                  {t('catalog:file_hint', {
                    types: fileConfigs[g.id].allowed_mime_types.join(', '),
                    size: (fileConfigs[g.id].max_size_bytes / 1024 / 1024).toFixed(1),
                  })}
                </p>}
              </>}
            </div>
          );
        })}

        {addError && <p role="alert" className="mt-4 text-sm text-red-700">{addError}{addError === t('catalog:file_sign_in') &&
          <> <Link href="/login" className="underline">{t('common:nav.login')}</Link></>}</p>}
        {added && <p role="status" className="mt-4 text-sm text-emerald-700">{t('catalog:added_to_cart')}
          {' '}<Link href="/cart" className="underline">{t('common:nav.cart')}</Link></p>}
        <button className="btn mt-8 w-full" disabled={!canAdd || adding} onClick={() => void addToCart()}>
          {adding ? t('common:loading') : t('common:add_to_cart')} — {formatMoney(price.now, locale, currency)}
        </button>
      </div>
    </div>
  );
}

export default function ProductPage() {
  const params = useSearchParams();
  const slug = params.get('slug');
  if (!slug) {
    return <div className="container-ma py-10">Missing product slug.</div>;
  }
  return (
    <Suspense fallback={<div className="container-ma py-8">Loading…</div>}>
      <ProductDetail key={slug} slug={slug} />
    </Suspense>
  );
}
