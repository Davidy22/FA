'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useCart } from '@/store/cart';
import { useLocale } from '@/store/locale';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatMoney, t_db, formatMaterial } from '@/lib/format';
import { useLocation } from '@/store/location';
import { useMemo, useState, useEffect } from 'react';
import type { Filament, Material, PremadeProduct, QuoteRequest } from '@/lib/types';

export default function CartPage() {
  const { t } = useTranslation(['common','cart','quote','errors']);
  const locale = useLocale((s) => s.locale);
  const { items, removeItem, updateQuantity, location_id } = useCart();
  const locationId = useLocation((s) => s.selectedLocationId) || location_id;
  const [livePricing, setLivePricing] = useState<any>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);

  const productIds = items.filter(i => i.kind==='premade').map(i=>i.product_id!).filter(Boolean);
  const quoteIds = items.filter(i => i.kind==='custom').map(i=>i.quote_request_id!).filter(Boolean);

  const { data: products } = useQuery<PremadeProduct[]>({
    queryKey: ['products_by_ids', productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase().from('premade_products').select('*').in('id', productIds);
      return data || [];
    },
  });

  const { data: materials } = useQuery<Material[]>({
    queryKey: ['materials'],
    queryFn: async () => {
      const { data } = await supabase().from('materials').select('*').eq('is_active', true);
      return data || [];
    },
  });

  const { data: filaments } = useQuery<Filament[]>({
    queryKey: ['filaments_by_ids', items.map(i=>i.color_filament_id).filter(Boolean)],
    enabled: items.some(i => !!i.color_filament_id),
    queryFn: async () => {
      const ids = Array.from(new Set(items.map(i=>i.color_filament_id).filter(Boolean))) as string[];
      const { data } = await supabase().from('filaments').select('*').in('id', ids);
      return data || [];
    },
  });

  const { data: quotes } = useQuery<QuoteRequest[]>({
    queryKey: ['quotes', quoteIds],
    enabled: quoteIds.length>0,
    queryFn: async () => {
      const { data } = await supabase().from('quote_requests').select('*').in('id', quoteIds);
      return data || [];
    },
  });

  // Compute authoritative pricing from local estimate, same formula as server (for display only).
  const localTotal = useMemo(() => {
    let subtotal = 0;
    for (const it of items) {
      if (it.kind === 'premade') {
        const p = products?.find((x) => x.id === it.product_id);
        if (!p) continue;
        let price = p.base_price;
        if (p && materials) {
          const pm = materials.find(m => m.id === it.material_id);
          // default pricing: no option pricing on cart (simplified)
          subtotal += price * it.quantity;
        }
      } else if (it.kind === 'custom') {
        const q = quotes?.find((x) => x.id === it.quote_request_id);
        if (q?.estimated_price != null) subtotal += q.estimated_price * it.quantity / Math.max(q.quantity||1,1);
      }
    }
    return { subtotal: Math.round(subtotal*100)/100 };
  }, [items, products, materials, quotes]);

  useEffect(() => {
    async function run() {
      if (!locationId || items.length === 0) return setLivePricing(null);
      setLoadingPrice(true);
      try {
        const { data, error } = await supabase().rpc('price_cart', {
          p_cart: { location_id: locationId, items }
        });
        if (!error) setLivePricing(data);
      } finally { setLoadingPrice(false); }
    }
    run();
  }, [items, locationId]);

  const pricing = livePricing || { total_amount: localTotal.subtotal, subtotal: localTotal.subtotal, tax_amount: 0 };

  if (items.length === 0) {
    return <div className="container-fa py-10"><p>{t('cart:empty')}</p>
      <Link href="/catalog" className="btn mt-4">{t('common:nav.catalog')}</Link></div>;
  }

  return (
    <div className="container-fa py-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
      <div>
        <h1 className="text-2xl font-semibold mb-4">{t('cart:title')}</h1>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((it, idx) => {
            if (it.kind === 'premade') {
              const p = products?.find((x) => x.id === it.product_id);
              const m = materials?.find((x) => x.id === it.material_id);
              const f = filaments?.find((x) => x.id === it.color_filament_id);
              return (
                <li key={idx} className="p-4 flex gap-4 items-center">
                  <div className="h-16 w-16 bg-slate-100 rounded flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{p ? t_db(p.name, locale) : '…'}</p>
                    <p className="text-sm text-slate-600">
                      {m && formatMaterial(m, locale)}
                      {f && <> · <span className="inline-block align-middle"><span className="swatch" style={{background:f.color_hex||'#ccc'}}/></span> {t_db(f.color, locale)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={99} value={it.quantity}
                      onChange={(e) => updateQuantity(idx, parseInt(e.target.value,10))}
                      className="w-16 input" />
                    <button onClick={() => removeItem(idx)} aria-label={t('cart:remove')} className="text-slate-400 hover:text-red-600">✕</button>
                  </div>
                </li>
              );
            } else {
              const q = quotes?.find((x) => x.id === it.quote_request_id);
              const m = materials?.find((x) => x.id === it.material_id);
              const f = filaments?.find((x) => x.id === it.color_filament_id);
              return (
                <li key={idx} className="p-4 flex gap-4 items-center">
                  <div className="h-16 w-16 bg-slate-100 rounded flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{t('cart:custom_print')}</p>
                    <p className="text-sm text-slate-600">
                      {(it.options as any)?.filename} · {m && formatMaterial(m, locale)} · {f && t_db(f.color, locale)}
                      {' · '}{(q?.material_usage_grams||0).toFixed(1)}g · ~{q?.print_time_minutes}min
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={10} value={it.quantity} readOnly className="w-16 input" />
                    <button onClick={() => removeItem(idx)} aria-label={t('cart:remove')} className="text-slate-400 hover:text-red-600">✕</button>
                  </div>
                </li>
              );
            }
          })}
        </ul>
      </div>
      <aside className="rounded-lg border border-slate-200 bg-white p-4 h-fit sticky top-20">
        <h2 className="font-semibold mb-3">{t('common:total')}</h2>
        {loadingPrice ? <p className="text-sm text-slate-500">{t('common:loading')}</p> : (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>{t('common:subtotal')}</dt><dd>{formatMoney(pricing.subtotal, locale)}</dd></div>
            <div className="flex justify-between"><dt>{t('common:tax')}</dt><dd>{formatMoney(pricing.tax_amount || 0, locale)}</dd></div>
            <div className="flex justify-between font-semibold text-base pt-2 border-t"><dt>{t('common:total')}</dt><dd>{formatMoney(pricing.total_amount, locale)}</dd></div>
          </dl>
        )}
        {!locationId ? (
          <p className="mt-3 text-sm text-amber-700">{t('errors:select_location_first')}</p>
        ) : (
          <Link href="/checkout" className="btn w-full mt-4">{t('cart:proceed_to_checkout')}</Link>
        )}
        <p className="mt-3 text-xs text-slate-500">{t('cart:pickup_only')}</p>
      </aside>
    </div>
  );
}
