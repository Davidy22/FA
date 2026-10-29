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
import { CartItemOptions } from '@/components/CartItemOptions';
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from '@/lib/shipping';
import type { Filament, Material, PremadeProduct, ProductMaterialSlot, QuoteRequest, TicketQuote } from '@/lib/types';
import { DEFAULT_DOCUMENT_PRICES, useDocumentPrices } from '@/hooks/useDocumentPrices';

export default function CartPage() {
  const { t } = useTranslation(['common','cart','quote','errors','pages']);
  const locale = useLocale((s) => s.locale);
  const { items, removeItem, updateQuantity, updateItem, location_id } = useCart();
  const locationId = useLocation((s) => s.selectedLocationId) || location_id;
  const [livePricing, setLivePricing] = useState<any>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
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

  // A display estimate used only until price_cart answers; the RPC is authoritative.
  const localTotal = useMemo(() => {
    let itemsTotal = 0;
    for (const it of items) {
      if (it.kind === 'premade') {
        const p = products?.find((x) => x.id === it.product_id);
        if (!p) continue;
        itemsTotal += effectivePrice(p.base_price, p) * it.quantity;
      } else if (it.kind === 'document') {
        itemsTotal += (it.pages || 0) * (documentPrices || DEFAULT_DOCUMENT_PRICES)[it.color || 'grayscale'] * it.quantity;
      } else if (it.kind === 'custom') {
        const q = quotes?.find((x) => x.id === it.quote_request_id);
        if (q?.estimated_price != null) itemsTotal += q.estimated_price * it.quantity / Math.max(q.quantity||1,1);
      } else if (it.kind === 'ticket') {
        const q = ticketQuotes?.find((x) => x.id === it.ticket_quote_id);
        if (q) itemsTotal += q.unit_price * q.quantity;
      }
    }
    return Math.round(itemsTotal*100)/100;
  }, [items, products, quotes, ticketQuotes, documentPrices]);

  // The cart always prices as a collection; delivery is chosen at checkout.
  useEffect(() => {
    async function run() {
      if (!locationId || items.length === 0) return setLivePricing(null);
      setLoadingPrice(true);
      setPriceError(null);
      try {
        const { data: { user } } = await supabase().auth.getUser();
        const { data, error } = await supabase().rpc('price_cart', {
          p_cart: {
            location_id: locationId,
            items,
            user_id: user?.id || null,
            fulfilment: 'pickup',
          }
        });
        if (error) {
          setLivePricing(null);
          setPriceError(error.message);
        } else {
          setLivePricing(data);
        }
      } finally { setLoadingPrice(false); }
    }
    run();
  }, [items, locationId]);

  const pricing = livePricing || { total_amount: localTotal, subtotal: localTotal, tax_amount: 0, currency: undefined };
  const lines: any[] = Array.isArray(pricing.lines) ? pricing.lines : [];
  const lineTotal = (index: number): number | null => {
    const line = lines.find((entry) => entry.line_id === index + 1);
    return line ? Number(line.line_total) : null;
  };
  const lineUnit = (index: number): number | null => {
    const line = lines.find((entry) => entry.line_id === index + 1);
    return line ? Number(line.unit_price) : null;
  };

  if (items.length === 0) {
    return <div className="container-ma py-10"><p>{t('cart:empty')}</p>
      <Link href="/catalog" className="btn mt-4">{t('common:nav.catalog')}</Link></div>;
  }

  function describeSlot(slotId: string, pick: { material_id?: string | null; color_filament_id?: string | null }) {
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
              const total = lineTotal(idx);
              const unit = lineUnit(idx);
              return (
                <li key={idx} className="p-4">
                  <div className="flex gap-4 items-start">
                    <div className="h-16 w-16 bg-slate-100 rounded flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{p ? t_db(p.name, locale) : '…'}</p>
                      {it.slots && Object.keys(it.slots).length > 0 ? (
                        <ul className="mt-0.5 space-y-0.5 text-sm text-slate-600">
                          {Object.entries(it.slots).map(([slotId, pick]) => describeSlot(slotId, pick))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-600">
                          {m && formatMaterial(m, locale)}
                          {f && <> · <span className="inline-block align-middle"><span className="swatch" style={filamentSwatchStyle(f)}/></span> {t_db(f.color, locale)}</>}
                        </p>
                      )}
                      <button
                        type="button"
                        className="mt-2 text-sm text-brand-700 underline"
                        aria-expanded={editingIndex === idx}
                        onClick={() => setEditingIndex(editingIndex === idx ? null : idx)}
                      >
                        {editingIndex === idx ? t('common:close') : t('cart:change_options')}
                      </button>
                      {editingIndex === idx && (
                        <CartItemOptions
                          line={it}
                          locationId={locationId}
                          onCancel={() => setEditingIndex(null)}
                          onSave={(patch) => { updateItem(idx, patch); setEditingIndex(null); }}
                        />
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-right">
                        <p className="font-medium">
                          {total === null ? '…' : formatMoney(total, locale, pricing.currency)}
                        </p>
                        {it.quantity > 1 && unit !== null && (
                          <p className="text-xs text-slate-500">
                            {t('cart:each', { price: formatMoney(unit, locale, pricing.currency) })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="number" min={1} max={99} value={it.quantity}
                          aria-label={t('common:quantity')}
                          onChange={(e) => updateQuantity(idx, parseInt(e.target.value,10))}
                          className="w-16 input" />
                        <button onClick={() => removeItem(idx)} aria-label={t('cart:remove')} className="text-slate-400 hover:text-red-600">✕</button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            } else if (it.kind === 'document') {
              const total = lineTotal(idx);
              const prices = documentPrices || DEFAULT_DOCUMENT_PRICES;
              return <li key={idx} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Document Printing</p>
                    <p className="text-sm text-slate-600">
                      {it.pages} sides · {it.color === 'color' ? t('pages:document.color_price', { price: formatMoney(prices.color, locale) }) : t('pages:document.grayscale_price', { price: formatMoney(prices.grayscale, locale) })}
                      {' · '}{it.duplex ? t('pages:document.duplex') : t('cart:single_sided')} · {t('cart:copies', { count: it.quantity })}
                    </p>
                    <button
                      type="button"
                      className="mt-1 text-sm text-brand-700 underline"
                      aria-expanded={editingIndex === idx}
                      onClick={() => setEditingIndex(editingIndex === idx ? null : idx)}
                    >
                      {editingIndex === idx ? t('common:close') : t('cart:change_options')}
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-medium">{total === null ? '…' : formatMoney(total, locale, pricing.currency)}</p>
                    <button onClick={() => removeItem(idx)} className="btn-outline">{t('cart:remove')}</button>
                  </div>
                </div>
                {editingIndex === idx && (
                  <div className="mt-3 space-y-2 rounded border border-brand-200 bg-brand-50/30 p-3">
                    <label className="block text-sm">{t('pages:document.ink')}
                      <select
                        className="input mt-1"
                        value={it.color || 'grayscale'}
                        onChange={(event) => updateItem(idx, { color: event.target.value as 'grayscale' | 'color' })}
                      >
                        <option value="grayscale">{t('pages:document.grayscale_price', { price: formatMoney(prices.grayscale, locale) })}</option>
                        <option value="color">{t('pages:document.color_price', { price: formatMoney(prices.color, locale) })}</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!it.duplex}
                        onChange={(event) => updateItem(idx, { duplex: event.target.checked })}
                      />
                      {t('pages:document.duplex')}
                    </label>
                  </div>
                )}
              </li>;
            } else if (it.kind === 'ticket') {
              const total = lineTotal(idx);
              return (
                <li key={idx} className="p-4 flex gap-4 items-start">
                  <div className="h-16 w-16 bg-slate-100 rounded flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{t('cart:ticket_item')}</p>
                    <p className="text-sm text-slate-600">
                      {(it.options as any)?.description}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="font-medium">{total === null ? '…' : formatMoney(total, locale, pricing.currency)}</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={99} value={it.quantity} readOnly className="w-16 input" />
                      <button onClick={() => removeItem(idx)} aria-label={t('cart:remove')} className="text-slate-400 hover:text-red-600">✕</button>
                    </div>
                  </div>
                </li>
              );
            } else {
              const q = quotes?.find((x) => x.id === it.quote_request_id);
              const m = materials?.find((x) => x.id === it.material_id);
              const f = filaments?.find((x) => x.id === it.color_filament_id);
              const total = lineTotal(idx);
              return (
                <li key={idx} className="p-4 flex gap-4 items-start">
                  <div className="h-16 w-16 bg-slate-100 rounded flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{t('cart:custom_print')}</p>
                    <p className="text-sm text-slate-600">
                      {(it.options as any)?.filename} · {m && formatMaterial(m, locale)} · {f && t_db(f.color, locale)}
                      {' · '}{(q?.material_usage_grams||0).toFixed(1)}g · ~{q?.print_time_minutes}min
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="font-medium">{total === null ? '…' : formatMoney(total, locale, pricing.currency)}</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={10} value={it.quantity} readOnly className="w-16 input" />
                      <button onClick={() => removeItem(idx)} aria-label={t('cart:remove')} className="text-slate-400 hover:text-red-600">✕</button>
                    </div>
                  </div>
                </li>
              );
            }
          })}
        </ul>
      </div>
      <aside className="rounded-lg border border-slate-200 bg-white p-4 h-fit sticky top-20">
        <h2 className="font-semibold mb-3">{t('common:total')}</h2>
        {loadingPrice && !lines.length ? <p className="text-sm text-slate-500">{t('common:loading')}</p> : (
          <dl className="space-y-1 text-sm">
            {/* The total is the sum of the line prices above. */}
            {Number(pricing.tax_amount) > 0 && (
              <div className="flex justify-between">
                <dt>{t('common:tax')}</dt>
                <dd>{formatMoney(pricing.tax_amount, locale, pricing.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base pt-2 border-t">
              <dt>{t('common:total')}</dt>
              <dd>{formatMoney(pricing.total_amount, locale, pricing.currency)}</dd>
            </div>
          </dl>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {t('cart:delivery_hint', {
            fee: formatMoney(DELIVERY_FEE, locale),
            threshold: formatMoney(FREE_DELIVERY_THRESHOLD, locale),
          })}
        </p>
        {priceError && <p role="alert" className="mt-3 text-sm text-red-700">{priceError}</p>}
        {!locationId ? (
          <p className="mt-3 text-sm text-amber-700">{t('errors:select_location_first')}</p>
        ) : (
          <Link href="/checkout" className="btn w-full mt-4">{t('cart:proceed_to_checkout')}</Link>
        )}
      </aside>
    </div>
  );
}
