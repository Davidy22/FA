'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { t_db, formatMaterial, formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';
import { useLocation } from '@/store/location';
import { useCart } from '@/store/cart';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import type {
  Filament, Material, PremadeProduct, ProductMaterial,
  ProductOptionChoice, ProductOptionGroup, TextOptionConfig,
} from '@/lib/types';
import { Suspense } from 'react';

function ProductDetail({ slug }: { slug: string }) {
  const { t } = useTranslation(['common','catalog','errors']);
  const locale = useLocale((s) => s.locale);
  const locationId = useLocation((s) => s.selectedLocationId);
  const addItem = useCart((s) => s.addItem);

  const { data: product, isLoading } = useQuery<PremadeProduct>({
    queryKey: ['product', slug],
    queryFn: async () => {
      const { data } = await supabase().from('premade_products').select('*')
        .eq('slug', slug).eq('status','published').single();
      return data as PremadeProduct;
    },
  });

  const { data: materials } = useQuery<(ProductMaterial & { material: Material })[]>({
    queryKey: ['product_materials', product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data } = await supabase().from('product_materials')
        .select('*, material:materials(*)').eq('product_id', product!.id);
      return data as any;
    },
  });

  const [materialId, setMaterialId] = useState<string | null>(null);
  const [filamentId, setFilamentId] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, any>>({});

  const selectedMaterialId = materialId || product?.default_material_id || materials?.[0]?.material_id || null;

  const { data: colors } = useQuery<Filament[]>({
    queryKey: ['available_filaments', locationId, selectedMaterialId],
    enabled: !!locationId && !!selectedMaterialId,
    queryFn: async () => {
      const { data } = await supabase().rpc('available_filaments', {
        p_location_id: locationId, p_material_id: selectedMaterialId,
      });
      return (data || []) as unknown as Filament[];
    },
  });

  const { data: groups } = useQuery<ProductOptionGroup[]>({
    queryKey: ['groups', product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data } = await supabase().from('product_option_groups')
        .select('*').eq('product_id', product!.id).order('sort_order');
      return data || [];
    },
  });

  const { data: choicesByGroup } = useQuery<Record<string, ProductOptionChoice[]>>({
    queryKey: ['choices', product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data } = await supabase().from('product_option_choices')
        .select('*').in('group_id', (groups || []).map((g) => g.id));
      const out: Record<string, ProductOptionChoice[]> = {};
      for (const c of data || []) (out[c.group_id] ||= []).push(c);
      return out;
    },
  });

  const { data: textConfigs } = useQuery<Record<string, TextOptionConfig>>({
    queryKey: ['text_configs', product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data } = await supabase().from('text_option_config')
        .select('*').in('group_id', (groups || []).map((g) => g.id));
      const out: Record<string, TextOptionConfig> = {};
      for (const c of data || []) out[c.group_id] = c;
      return out;
    },
  });

  const price = useMemo(() => {
    if (!product) return 0;
    let p = product.base_price;
    const pm = materials?.find((m) => m.material_id === selectedMaterialId);
    if (pm) p += pm.price_modifier;
    for (const g of groups || []) {
      const sel = options[g.id];
      if (!sel) continue;
      if (g.option_type === 'select_one' && sel.choice_id) {
        const c = choicesByGroup?.[g.id]?.find((x) => x.id === sel.choice_id);
        if (c) p += c.price_modifier;
      } else if (g.option_type === 'select_many' && sel.choice_ids) {
        for (const cid of sel.choice_ids as string[]) {
          const c = choicesByGroup?.[g.id]?.find((x) => x.id === cid);
          if (c) p += c.price_modifier;
        }
      } else if (g.option_type === 'text' && sel.text) {
        const cfg = textConfigs?.[g.id];
        if (cfg) p += cfg.price_modifier;
      }
    }
    return Math.max(p, 0);
  }, [product, materials, selectedMaterialId, groups, options, choicesByGroup, textConfigs]);

  const canAdd = useMemo(() => {
    if (!product) return false;
    if (!locationId) return false;
    if (!filamentId) return false;
    for (const g of groups || []) {
      if (!g.required) continue;
      const sel = options[g.id];
      if (!sel) return false;
      if (g.option_type === 'select_one' && !sel.choice_id) return false;
      if (g.option_type === 'select_many' && (!sel.choice_ids || sel.choice_ids.length === 0)) return false;
    }
    return true;
  }, [product, locationId, filamentId, groups, options]);

  if (isLoading || !product) return <div className="container-fa py-8">{t('common:loading')}</div>;

  return (
    <div className="container-fa py-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
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
        <p className="mt-4 text-2xl font-semibold">{formatMoney(price, locale)}</p>

        {!locationId && <p className="mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded text-sm">{t('errors:select_location_first')}</p>}

        {materials && materials.length > 1 && (
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
        {materials && materials.length === 1 && <p className="mt-4 badge">{formatMaterial(materials[0].material, locale)}</p>}

        <div className="mt-6">
          <label className="label">{t('catalog:select_color')}</label>
          {!colors?.length ? <p className="text-sm text-slate-500">—</p> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {colors.map((f) => (
                <label key={f.id} className={'flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer ' + (filamentId === f.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
                  <input type="radio" name="color" className="sr-only" checked={filamentId === f.id} onChange={() => setFilamentId(f.id)} />
                  <span className="swatch" style={{ background: f.color_hex || '#ccc' }} />
                  <span className="text-sm">{t_db(f.color, locale)}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {groups?.map((g) => {
          const cs = choicesByGroup?.[g.id] || [];
          return (
            <div key={g.id} className="mt-6">
              <label className="label">{t_db(g.label, locale)}{g.required && <span aria-hidden="true"> *</span>}</label>
              {g.option_type === 'select_one' && (
                <div className="space-y-2">
                  {cs.sort((a,b)=>a.sort_order-b.sort_order).map((c) => (
                    <label key={c.id} className="flex items-center gap-2">
                      <input type="radio" name={`g-${g.id}`}
                        checked={options[g.id]?.choice_id === c.id}
                        onChange={() => setOptions((o) => ({ ...o, [g.id]: { choice_id: c.id } }))}
                      />
                      <span>{t_db(c.label, locale)} {c.price_modifier ? `+$${c.price_modifier.toFixed(2)}` : ''}</span>
                    </label>
                  ))}
                </div>
              )}
              {g.option_type === 'select_many' && (
                <div className="space-y-2">
                  {cs.sort((a,b)=>a.sort_order-b.sort_order).map((c) => {
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
                        <span>{t_db(c.label, locale)} {c.price_modifier ? `+$${c.price_modifier.toFixed(2)}` : ''}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {g.option_type === 'text' && (
                <input className="input" maxLength={textConfigs?.[g.id]?.max_length || 100}
                  value={options[g.id]?.text || ''}
                  onChange={(e) => setOptions((o) => ({ ...o, [g.id]: { text: e.target.value } }))}
                />
              )}
            </div>
          );
        })}

        <button className="btn mt-8 w-full" disabled={!canAdd}
          onClick={() => addItem({
            kind: 'premade', product_id: product.id, material_id: selectedMaterialId,
            color_filament_id: filamentId, quantity: 1, options,
          })}>
          {t('common:add_to_cart')} — {formatMoney(price, locale)}
        </button>

        <details className="mt-6 rounded border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">{t('common:advanced_details')}</summary>
          <div className="mt-2 text-sm text-slate-600 space-y-1">
            {materials?.map((pm) => (
              <div key={pm.material_id}>
                {formatMaterial(pm.material, locale, { technicalFirst: true })}{' '}
                — density {pm.material.density_g_cm3} g/cm³, flow {pm.material.default_flow_mm3_s} mm³/s
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

export default function ProductPage() {
  const params = useSearchParams();
  const slug = params.get('slug');
  if (!slug) {
    return <div className="container-fa py-10">Missing product slug.</div>;
  }
  return (
    <Suspense fallback={<div className="container-fa py-8">Loading…</div>}>
      <ProductDetail slug={slug} />
    </Suspense>
  );
}
