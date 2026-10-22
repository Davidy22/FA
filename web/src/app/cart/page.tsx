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
import { effectivePrice } from '@/lib/sale';
import { filamentSwatchStyle } from '@/lib/filaments';
import type { Filament, Material, PremadeProduct, ProductMaterialSlot, QuoteRequest, TicketQuote } from '@/lib/types';
import { DEFAULT_DOCUMENT_PRICES, useDocumentPrices } from '@/hooks/useDocumentPrices';

export default function CartPage() {
  const { t } = useTranslation(['common','cart','quote','errors','rewards']);
  const locale = useLocale((s) => s.locale);
  const { items, removeItem, updateQuantity, location_id, coupon_code, setCoupon } = useCart();
  const locationId = useLocation((s) => s.selectedLocationId) || location_id;
  const [livePricing, setLivePricing] = useState<any>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const { data: documentPrices } = useDocumentPrices();

  const productIds = items.filter(i => i.kind==='premade').map(i=>i.product_id!).filter(Boolean);
  const quoteIds = items.filter(i => i.kind==='custom').map(i=>i.quote_request_id!).filter(Boolean);
  const ticketQuoteIds = items.filter(i => i.kind==='ticket').map(i=>i.ticket_quote_id!).filter(Boolean);

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

  const slotPicks = items.flatMap((i) => Object.values(i.slots || {}));
  const filamentIds = Array.from(new Set([
    ...items.map((i) => i.color_filament_id),
    ...slotPicks.map((pick) => pick.color_filament_id),
  ].filter(Boolean))) as string[];

  const { data: filaments } = useQuery<Filament[]>({
    queryKey: ['filaments_by_ids', filamentIds],
    enabled: filamentIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase().from('filaments')
          .select('*, finish_info:filament_finishes(name)').in('id', filamentIds);
      return data || [];
    },
  });

  // Slot names, so a multi-material line reads "Body: TPU · Black".
  const { data: productSlots } = useQuery<ProductMaterialSlot[]>({
    queryKey: ['cart_product_slots', productIds],
    enabled: productIds.length > 0 && slotPicks.length > 0,
    queryFn: async () => {
      const { data } = await supabase().from('product_material_slots')
        .select('*').in('product_id', productIds).order('sort_order');
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

  const { data: ticketQuotes } = useQuery<TicketQuote[]>({
    queryKey: ['ticket_quotes', ticketQuoteIds],
    enabled: ticketQuoteIds.length>0,
    queryFn: async () => {
      const { data } = await supabase().from('ticket_quotes').select('*').in('id', ticketQuoteIds);
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
        // A running sale is charged by price_cart; mirror it here so the page
        // is not showing a stale number before the RPC answers.
        subtotal += effectivePrice(p.base_price, p) * it.quantity;
      } else if (it.kind === 'document') {
        subtotal += (it.pages || 0) * (documentPrices || DEFAULT_DOCUMENT_PRICES)[it.color || 'grayscale'] * it.quantity;
      } else if (it.kind === 'custom') {
        const q = quotes?.find((x) => x.id === it.quote_request_id);
        if (q?.estimated_price != null) subtotal += q.estimated_price * it.quantity / Math.max(q.quantity||1,1);
      } else if (it.kind === 'ticket') {
        const q = ticketQuotes?.find((x) => x.id === it.ticket_quote_id);
        if (q) subtotal += q.unit_price * q.quantity;
      }
    }
    return { subtotal: Math.round(subtotal*100)/100 };
  }, [items, products, quotes, ticketQuotes, documentPrices]);

  useEffect(() => {
    async function run() {
      if (!locationId || items.length === 0) return setLivePricing(null);
      setLoadingPrice(true);
      try {
        const { data: { user } } = await supabase().auth.getUser();
        const { data, error } = await supabase().rpc('price_cart', {
          p_cart: {
            location_id: locationId,
            items,
            user_id: user?.id || null,
            coupon_code: coupon_code || null,
          }
        });
        if (!error) setLivePricing(data);
      } finally { setLoadingPrice(false); }
    }
    run();
  }, [items, locationId, coupon_code]);

  async function applyCoupon(e: React.FormEvent) {
    e.preventDefault();
    const candidate = couponInput.trim().toUpperCase();
    if (!candidate) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const { data: { user } } = await supabase().auth.getUser();
      const { error } = await supabase().rpc('price_cart', {
        p_cart: {
          location_id: locationId,
          items,
          user_id: user?.id || null,
          coupon_code: candidate,
        }
      });
      if (error) throw new Error(error.message);
      setCoupon(candidate);
      setCouponInput('');
    } catch (err) {
      setCouponError((err as Error).message);
    } finally {
      setCouponBusy(false);
    }
  }

  const pricing = livePricing || { total_amount: localTotal.subtotal, subtotal: localTotal.subtotal, tax_amount: 0 };
  if (items.length === 0) {
    return <div className="container-ma py-10"><p>{t('cart:empty')}</p>
      <Link href="/catalog" className="btn mt-4">{t('common:nav.catalog')}</Link></div>;
  }

  return (
    <div className="container-ma py-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
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
                    {it.slots && Object.keys(it.slots).length > 0 ? (
                      <ul className="mt-0.5 space-y-0.5 text-sm text-slate-600">
                        {Object.entries(it.slots).map(([slotId, pick]) => {
                          const slot = productSlots?.find((row) => row.id === slotId);
                          const slotMaterial = materials?.find((x) => x.id === pick.material_id);
                          const slotColor = filaments?.find((x) => x.id === pick.color_filament_id);
                          return (
                            <li key={slotId}>
                              {slot ? t_db(slot.name, locale) : '—'}:{' '}
                              {slotMaterial ? formatMaterial(slotMaterial, locale) : '—'}
                              {slotColor && <> · <span className="inline-block align-middle"><span className="swatch" style={filamentSwatchStyle(slotColor)}/></span> {t_db(slotColor.color, locale)}</>}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-600">
                        {m && formatMaterial(m, locale)}
                        {f && <> · <span className="inline-block align-middle"><span className="swatch" style={filamentSwatchStyle(f)}/></span> {t_db(f.color, locale)}</>}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={99} value={it.quantity}
                      onChange={(e) => updateQuantity(idx, parseInt(e.target.value,10))}
                      className="w-16 input" />
                    <button onClick={() => removeItem(idx)} aria-label={t('cart:remove')} className="text-slate-400 hover:text-red-600">✕</button>
                  </div>
                </li>
              );
            } else if (it.kind === 'document') {
              return <li key={idx} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-medium">A4 document printing</p><p className="text-sm text-slate-600">{it.pages} sides · {it.color} · {it.duplex ? 'Double-sided' : 'Single-sided'} · {it.quantity} copies</p></div>
                <button onClick={() => removeItem(idx)} className="btn-outline">{t('cart:remove')}</button>
              </li>;
            } else if (it.kind === 'ticket') {
              const q = ticketQuotes?.find((x) => x.id === it.ticket_quote_id);
              return (
                <li key={idx} className="p-4 flex gap-4 items-center">
                  <div className="h-16 w-16 bg-slate-100 rounded flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{t('cart:ticket_item')}</p>
                    <p className="text-sm text-slate-600">
                      {(it.options as any)?.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={99} value={it.quantity} readOnly className="w-16 input" />
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
            <div className="flex justify-between"><dt>{t('common:subtotal')}</dt><dd>{formatMoney(pricing.subtotal, locale, pricing.currency)}</dd></div>
            {Number(pricing.sale_savings || 0) > 0 && (
              <div className="flex justify-between text-rose-700">
                <dt>{t('cart:sale_savings')}</dt>
                <dd>−{formatMoney(Number(pricing.sale_savings), locale, pricing.currency)}</dd>
              </div>
            )}
            {pricing.discount_amount > 0 && (
              <div className="flex justify-between text-green-700">
                <dt>{t('rewards:discount')}</dt>
                <dd>−{formatMoney(pricing.discount_amount, locale, pricing.currency)}</dd>
              </div>
            )}
            {/* Hong Kong charges no sales tax, so a zero tax line is omitted entirely. */}
            {Number(pricing.tax_amount) > 0 && (
              <div className="flex justify-between"><dt>{t('common:tax')}</dt><dd>{formatMoney(pricing.tax_amount, locale, pricing.currency)}</dd></div>
            )}
            <div className="flex justify-between font-semibold text-base pt-2 border-t"><dt>{t('common:total')}</dt><dd>{formatMoney(pricing.total_amount, locale, pricing.currency)}</dd></div>
          </dl>
        )}
        <div className="mt-3 text-sm">
          {!coupon_code ? (
            <form onSubmit={applyCoupon} className="flex gap-2">
              <input
                className="input flex-1 py-1.5 text-sm"
                placeholder={t('rewards:coupon_placeholder')}
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                aria-label={t('rewards:coupon_placeholder')}
              />
              <button type="submit" className="btn-outline px-3 py-1.5 text-sm" disabled={couponBusy || !couponInput.trim()}>
                {t('rewards:coupon_apply')}
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-between rounded border border-brand-200 bg-brand-50 px-3 py-2">
              <span className="font-mono text-xs">{t('rewards:coupon_applied')}: <strong>{coupon_code}</strong></span>
              <button
                className="text-slate-500 hover:text-red-600"
                aria-label={t('rewards:coupon_remove')}
                onClick={() => setCoupon(null)}
              >✕</button>
            </div>
          )}
          {couponError && <p className="mt-2 text-xs text-red-700">{couponError}</p>}
        </div>
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
