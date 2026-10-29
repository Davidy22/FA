'use client';
import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { t_db, formatMaterial } from '@/lib/format';
import { useLocale } from '@/store/locale';
import { ColorSwatchGrid } from '@/components/ColorSwatchGrid';
import { fetchAvailableFilaments } from '@/hooks/useAvailableFilaments';
import { effectivePrice } from '@/lib/sale';
import type {
  CartLineInput, Filament, Material, PremadeProduct, ProductMaterial, ProductMaterialSlot,
  ProductOptionChoice, ProductOptionGroup, ProductSlotMaterial, SlotSelection, TextOptionConfig,
} from '@/lib/types';

type OptionValues = Record<string, { choice_id?: string; choice_ids?: string[]; text?: string; file_path?: string }>;

/**
 * Edit the material, colour, and product options of a line that is already in
 * the cart. The page saves the result onto the line; price_cart then reprices.
 * File options keep whatever was uploaded from the product page.
 */
export function CartItemOptions({
  line,
  locationId,
  onSave,
  onCancel,
}: {
  line: CartLineInput;
  locationId: string | null;
  onSave: (patch: Partial<CartLineInput>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['cart', 'catalog', 'common']);
  const locale = useLocale((state) => state.locale);
  const productId = line.product_id!;

  const { data: product, isPending: productPending } = useQuery<PremadeProduct | null>({
    queryKey: ['cart_edit_product', productId],
    queryFn: async () => {
      const { data, error } = await supabase().from('premade_products').select('*').eq('id', productId).single();
      if (error) throw error;
      return data as PremadeProduct;
    },
  });

  const { data: materials } = useQuery<(ProductMaterial & { material: Material })[]>({
    queryKey: ['cart_edit_materials', productId],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_materials')
        .select('*, material:materials(*)').eq('product_id', productId);
      if (error) throw error;
      return (data || []).filter((row) => row.material?.is_active) as (ProductMaterial & { material: Material })[];
    },
  });

  const { data: slots } = useQuery<ProductMaterialSlot[]>({
    queryKey: ['cart_edit_slots', productId],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_material_slots')
        .select('*').eq('product_id', productId).order('sort_order').order('id');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: slotMaterials } = useQuery<Record<string, (ProductSlotMaterial & { material: Material })[]>>({
    queryKey: ['cart_edit_slot_materials', productId],
    enabled: !!slots?.length,
    queryFn: async () => {
      const { data, error } = await supabase().from('product_slot_materials')
        .select('*, material:materials(*)').in('slot_id', slots!.map((slot) => slot.id));
      if (error) throw error;
      const out: Record<string, (ProductSlotMaterial & { material: Material })[]> = {};
      for (const row of (data || []).filter((entry) => entry.material?.is_active)) (out[row.slot_id] ||= []).push(row);
      return out;
    },
  });

  const { data: groups } = useQuery<ProductOptionGroup[]>({
    queryKey: ['cart_edit_groups', productId],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_option_groups')
        .select('*').eq('product_id', productId).order('sort_order');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: choicesByGroup } = useQuery<Record<string, ProductOptionChoice[]>>({
    queryKey: ['cart_edit_choices', productId],
    queryFn: async () => {
      const { data, error } = await supabase().from('product_option_choices')
        .select('*').in('group_id', (groups || []).map((group) => group.id));
      if (error) throw error;
      const out: Record<string, ProductOptionChoice[]> = {};
      for (const choice of data || []) (out[choice.group_id] ||= []).push(choice);
      return out;
    },
  });

  const { data: textConfigs } = useQuery<Record<string, TextOptionConfig>>({
    queryKey: ['cart_edit_text_configs', productId],
    queryFn: async () => {
      const { data, error } = await supabase().from('text_option_config')
        .select('*').in('group_id', (groups || []).map((group) => group.id));
      if (error) throw error;
      return Object.fromEntries((data || []).map((config) => [config.group_id, config]));
    },
  });

  const [materialId, setMaterialId] = useState<string | null>(line.material_id ?? null);
  const [filamentId, setFilamentId] = useState<string | null>(line.color_filament_id ?? null);
  const [slotPicks, setSlotPicks] = useState<Record<string, SlotSelection>>(line.slots ?? {});
  const [options, setOptions] = useState<OptionValues>((line.options as OptionValues) || {});
  const [validationError, setValidationError] = useState<string | null>(null);

  const hasSlots = !!slots?.length;
  const eligibleFor = (slot: ProductMaterialSlot) => slotMaterials?.[slot.id] || [];
  const sourceSlot = (slot: ProductMaterialSlot) =>
    (slot.linked_slot_id && slots?.find((candidate) => candidate.id === slot.linked_slot_id)) || slot;

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

  const selectedMaterialId = materialId ||
    materials?.find((row) => row.material_id === product?.default_material_id)?.material_id ||
    materials?.[0]?.material_id || null;

  // One colour list per material this line can use, all in stock at the location.
  const colorMaterialIds = useMemo(() => {
    if (hasSlots) return Array.from(new Set((slots || []).map(slotMaterialId).filter(Boolean))) as string[];
    return selectedMaterialId ? [selectedMaterialId] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSlots, slots, slotPicks, slotMaterials, selectedMaterialId]);

  const colorQueries = useQueries({
    queries: colorMaterialIds.map((id) => ({
      queryKey: ['available_filaments', locationId, id],
      enabled: !!locationId,
      queryFn: () => fetchAvailableFilaments(locationId!, id),
    })),
  });
  const colorsFor = (material: string | null): Filament[] => {
    if (!material) return [];
    const index = colorMaterialIds.indexOf(material);
    return index >= 0 ? ((colorQueries[index]?.data as Filament[] | undefined) || []) : [];
  };

  function slotColorId(slot: ProductMaterialSlot): string | null {
    const colors = colorsFor(slotMaterialId(slot));
    if (!colors.length) return null;
    const source = sourceSlot(slot);
    const picked = slotPicks[source.id]?.color_filament_id;
    if (picked && colors.some((color) => color.id === picked)) return picked;
    if (source.default_filament_id && colors.some((color) => color.id === source.default_filament_id)) {
      return source.default_filament_id;
    }
    return null;
  }

  const colors = colorsFor(selectedMaterialId);
  const everySlotHasColor = !hasSlots ||
    (slots || []).every((slot) => !!slotColorId(slot));

  function requiredOptionsChosen(): boolean {
    for (const group of groups || []) {
      if (!group.required || group.option_type === 'file') continue;
      const selected = options[group.id];
      if (group.option_type === 'select_one' && !selected?.choice_id) return false;
      if (group.option_type === 'select_many' && !selected?.choice_ids?.length) return false;
      if (group.option_type === 'text' && !selected?.text?.trim()) return false;
    }
    return true;
  }

  const canSave = !!locationId && !!product && everySlotHasColor &&
    (hasSlots || (!!filamentId && colors.some((color) => color.id === filamentId))) &&
    requiredOptionsChosen();

  function save() {
    setValidationError(null);
    if (!canSave) {
      setValidationError(t('cart:edit_incomplete'));
      return;
    }
    if (hasSlots) {
      const picks: Record<string, SlotSelection> = {};
      for (const slot of slots || []) {
        const source = sourceSlot(slot);
        picks[slot.id] = {
          material_id: slotMaterialId(slot),
          color_filament_id: slotColorId(slot),
        };
        // A linked slot follows its source; keep the stored source pick too.
        if (slot.linked_slot_id) picks[source.id] = picks[slot.id];
      }
      const first = slots?.[0];
      onSave({
        material_id: first ? picks[first.id]?.material_id ?? null : null,
        color_filament_id: first ? picks[first.id]?.color_filament_id ?? null : null,
        slots: picks,
        options,
      });
    } else {
      onSave({ material_id: selectedMaterialId, color_filament_id: filamentId, slots: undefined, options });
    }
  }

  if (productPending) {
    return <p className="mt-2 text-sm text-slate-500">{t('common:loading')}</p>;
  }
  if (!product) {
    return (
      <div className="mt-2 text-sm">
        <p className="text-slate-500">{t('catalog:product_unavailable')}</p>
        <button type="button" className="btn-outline mt-2 px-3 py-1.5 text-sm" onClick={onCancel}>
          {t('common:close')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-brand-200 bg-brand-50/30 p-3">
      <p className="text-sm font-medium">{t('cart:edit_options')}</p>

      {hasSlots ? (
        <div className="mt-2 space-y-3">
          {(slots || []).map((slot) => {
            const eligible = eligibleFor(slot);
            const chosenMaterial = slotMaterialId(slot);
            const slotColors = colorsFor(chosenMaterial);
            const chosenColor = slotColorId(slot);
            const linkedSource = slot.linked_slot_id
              ? slots?.find((candidate) => candidate.id === slot.linked_slot_id)
              : null;
            const choiceSlotId = linkedSource?.id || slot.id;
            return (
              <div key={slot.id} className="rounded border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium">{t_db(slot.name, locale)}</p>
                {linkedSource && (
                  <p className="mt-1 text-xs text-slate-500">
                    {t('catalog:linked_slot_choice_help', { slot: t_db(linkedSource.name, locale) })}
                  </p>
                )}
                <div className="mt-2 space-y-1">
                  {eligible.map((entry) => (
                    <label key={entry.material_id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`cart-slot-material-${slot.id}`}
                        disabled={!!linkedSource}
                        checked={chosenMaterial === entry.material_id}
                        onChange={() => setSlotPicks((previous) => ({
                          ...previous,
                          [choiceSlotId]: { material_id: entry.material_id, color_filament_id: null },
                        }))}
                      />
                      <span>{formatMaterial(entry.material, locale, { priceModifier: entry.price_modifier })}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2">
                  <span className="label">{t('catalog:select_color')}</span>
                  {!slotColors.length ? (
                    <p className="text-sm text-slate-500">{t('catalog:no_colors_in_stock')}</p>
                  ) : (
                    <ColorSwatchGrid
                      colors={slotColors}
                      selectedId={chosenColor}
                      name={`cart-slot-color-${slot.id}`}
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
      ) : (
        <>
          {!!materials?.length && (
            <div className="mt-2">
              <span className="label">{t('catalog:select_material')}</span>
              <div className="space-y-1">
                {materials.map((entry) => (
                  <label key={entry.material_id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="cart-material"
                      checked={selectedMaterialId === entry.material_id}
                      onChange={() => { setMaterialId(entry.material_id); setFilamentId(null); }}
                    />
                    <span>{formatMaterial(entry.material, locale, { priceModifier: entry.price_modifier })}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2">
            <span className="label">{t('catalog:select_color')}</span>
            {!colors.length ? (
              <p className="text-sm text-slate-500">{t('catalog:no_colors_in_stock')}</p>
            ) : (
              <ColorSwatchGrid
                colors={colors}
                selectedId={filamentId}
                name="cart-color"
                onSelect={setFilamentId}
              />
            )}
          </div>
        </>
      )}

      {(groups || []).map((group) => {
        const groupChoices = [...(choicesByGroup?.[group.id] || [])].sort((a, b) => a.sort_order - b.sort_order);
        const choiceLabel = (choice: ProductOptionChoice) => {
          const regular = choice.price_modifier;
          const now = effectivePrice(regular, choice);
          const modifier = now ? ` (${now > 0 ? '+' : '−'}${Math.abs(now).toFixed(2)})` : '';
          return <span>{t_db(choice.label, locale)}{now !== regular && regular ? ` — ${t('common:sale_badge')}` : ''}{modifier}</span>;
        };
        return (
          <div key={group.id} className="mt-3">
            <p className="label">
              {t_db(group.label, locale)}
              {group.required && <span aria-hidden="true"> *</span>}
            </p>
            {group.option_type === 'select_one' && (
              <div className="space-y-1">
                {groupChoices.map((choice) => (
                  <label key={choice.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`cart-group-${group.id}`}
                      checked={options[group.id]?.choice_id === choice.id}
                      onChange={() => setOptions((previous) => ({ ...previous, [group.id]: { choice_id: choice.id } }))}
                    />
                    {choiceLabel(choice)}
                  </label>
                ))}
              </div>
            )}
            {group.option_type === 'select_many' && (
              <div className="space-y-1">
                {groupChoices.map((choice) => {
                  const selected = new Set<string>(options[group.id]?.choice_ids || []);
                  return (
                    <label key={choice.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(choice.id)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(choice.id); else next.delete(choice.id);
                          setOptions((previous) => ({ ...previous, [group.id]: { choice_ids: Array.from(next) } }));
                        }}
                      />
                      {choiceLabel(choice)}
                    </label>
                  );
                })}
              </div>
            )}
            {group.option_type === 'text' && (
              <input
                className="input mt-1"
                aria-label={t_db(group.label, locale)}
                maxLength={textConfigs?.[group.id]?.max_length || 100}
                value={options[group.id]?.text || ''}
                onChange={(event) => setOptions((previous) => ({ ...previous, [group.id]: { text: event.target.value } }))}
              />
            )}
            {group.option_type === 'file' && (
              <p className="text-xs text-slate-500">
                {options[group.id]?.file_path ? t('cart:file_option_kept') : t('cart:file_option_missing')}
              </p>
            )}
          </div>
        );
      })}

      {validationError && <p role="alert" className="mt-2 text-sm text-red-700">{validationError}</p>}
      {!locationId && <p className="mt-2 text-sm text-amber-700">{t('cart:choose_location_to_edit')}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn px-3 py-1.5 text-sm" onClick={save} disabled={!locationId}>
          {t('common:save')}
        </button>
        <button type="button" className="btn-outline px-3 py-1.5 text-sm" onClick={onCancel}>
          {t('common:cancel')}
        </button>
      </div>
    </div>
  );
}
