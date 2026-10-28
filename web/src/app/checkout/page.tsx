'use client';
import { useTranslation } from 'react-i18next';
import { useCart } from '@/store/cart';
import { useLocale } from '@/store/locale';
import { useLocation } from '@/store/location';
import { formatMoney } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useState } from 'react';
import type { Coupon, Location } from '@/lib/types';
import { couponDiscountLabel } from '@/lib/rewards';
import { withBasePath } from '@/lib/paths';

export default function CheckoutPage() {
  const { t } = useTranslation(['common','checkout','errors','rewards','cart']);
  const locale = useLocale((s) => s.locale);
  const { items, location_id, coupon_code, setCoupon, note, setNote } = useCart();
  const cartLocationId = useLocation((s) => s.selectedLocationId) || location_id;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orderNote, setOrderNote] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: location } = useQuery<Location>({
    queryKey: ['location', cartLocationId],
    enabled: !!cartLocationId,
    queryFn: async () => (await supabase().from('locations').select('*').eq('id', cartLocationId).single()).data as Location,
  });

  const { data: coupons = [] } = useQuery<Coupon[]>({
    queryKey: ['checkout_coupons'],
    enabled: !!cartLocationId,
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase().from('coupons').select('*')
        .eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Coupon[];
    },
  });

  const { data: pricing, error: pricingError } = useQuery<any>({
    queryKey: ['price_cart', items, cartLocationId, coupon_code],
    enabled: !!cartLocationId && items.length > 0,
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      const { data, error } = await supabase().rpc('price_cart', {
        p_cart: {
          location_id: cartLocationId,
          items,
          user_id: user?.id || null,
          coupon_code: coupon_code || null,
        }
      });
      if (error) throw error;
      return data;
    },
  });

  const { data: basePricing } = useQuery<any>({
    queryKey: ['price_cart_coupon_eligibility', items, cartLocationId],
    enabled: !!cartLocationId && items.length > 0 && !!coupon_code,
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      const { data, error } = await supabase().rpc('price_cart', {
        p_cart: { location_id: cartLocationId, items, user_id: user?.id || null, coupon_code: null },
      });
      if (error) throw error;
      return data;
    },
  });

  const eligibilityPricing = coupon_code ? basePricing : pricing;
  const cartProductIds = new Set(items.filter((item) => item.kind === 'premade').map((item) => item.product_id));
  const applicableCoupons = coupons.filter((coupon) => {
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) return false;
    if (coupon.min_subtotal != null && Number(eligibilityPricing?.subtotal ?? 0) < Number(coupon.min_subtotal)) return false;
    if (coupon.product_id && !cartProductIds.has(coupon.product_id)) return false;
    return true;
  });

  async function handlePay() {
    setBusy(true); setError(null);
    try {
      const origin = window.location.origin;
      const { data: { user } } = await supabase().auth.getUser();
      const cart = {
        location_id: cartLocationId,
        items,
        user_id: user?.id || null,
        contact_email: email,
        contact_name: name,
        coupon_code: coupon_code || null,
        note: orderNote.trim() || null,
      };
      const { data, error } = await supabase().functions.invoke('stripe-checkout', {
        body: {
          cart,
          success_url: `${origin}${withBasePath('/checkout/success/')}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}${withBasePath('/cart/')}`,
          contact_email: email,
          contact_name: name,
          locale,
        },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (!cartLocationId) {
    return <div className="container-ma py-10"><p>{t('errors:select_location_first')}</p></div>;
  }

  return (
    <div className="container-ma py-10 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">{t('checkout:title')}</h1>
      <section className="space-y-4">
        <div>
          <label className="label">{t('checkout:contact_info')}</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="input" placeholder={t('checkout:name')} value={name} onChange={(e)=>setName(e.target.value)} />
            <input className="input" type="email" placeholder={t('checkout:email')} value={email} onChange={(e)=>setEmail(e.target.value)} />
          </div>
          <p className="mt-2 text-xs text-slate-500">{t('checkout:guest_ok')}</p>
        </div>
        <div className="rounded border border-slate-200 p-4 text-sm">
          <p className="font-medium">{t('cart:pickup_location')}</p>
          <p className="text-slate-700">{location?.name} — {location?.address}</p>
        </div>
        <label className="block">
          <span className="mt-1 block text-sm text-slate-600">{t('checkout:order_note')}</span>
          <textarea className="input mt-1 w-full min-h-[80px]" value={orderNote}
            onChange={(e) => { setOrderNote(e.target.value); setNote(e.target.value); }}
            placeholder={t('checkout:order_note_placeholder')} />
        </label>
        <div className="rounded border border-slate-200 p-4 text-sm">
          <h2 className="font-medium">{t('rewards:my_coupons')}</h2>
          {coupon_code && (
            <div className="mt-3 flex items-center justify-between rounded border border-brand-200 bg-brand-50 px-3 py-2">
              <span className="font-mono text-xs">{t('rewards:coupon_applied')}: <strong>{coupon_code}</strong></span>
              <button
                type="button"
                className="text-slate-500 hover:text-red-600"
                aria-label={t('rewards:coupon_remove')}
                onClick={() => setCoupon(null)}
              >✕</button>
            </div>
          )}
          {applicableCoupons.length ? (
            <ul className="mt-3 space-y-2">
              {applicableCoupons.map((coupon) => (
                <li key={coupon.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 rounded border px-3 py-2 text-left ${coupon_code === coupon.code ? 'border-brand-300 bg-brand-50' : 'border-slate-200 hover:border-brand-300'}`}
                    aria-pressed={coupon_code === coupon.code}
                    onClick={() => setCoupon(coupon_code === coupon.code ? null : coupon.code)}
                  >
                    <span className="font-mono">{coupon.code}</span>
                    <span>{couponDiscountLabel(coupon, t)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-slate-500">{t('rewards:no_applicable_coupons')}</p>
          )}
          {pricingError && coupon_code && (
            <p className="mt-2 text-xs text-red-700">{(pricingError as Error).message}</p>
          )}
        </div>
        {pricing && (
          <div className="rounded border border-slate-200 p-4 text-sm">
            <h3 className="font-medium mb-2">{t('checkout:review_order')}</h3>
            <dl className="space-y-1">
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
              <div className="flex justify-between font-semibold pt-2 border-t"><dt>{t('common:total')}</dt><dd>{formatMoney(pricing.total_amount, locale, pricing.currency)}</dd></div>
            </dl>
          </div>
        )}
        {error && <p className="text-red-700">{error}</p>}
        <button className="btn w-full" disabled={busy || !email || !name} onClick={handlePay}>
          {busy ? t('common:loading') : t('checkout:pay_with_stripe')}
        </button>
        <p className="text-xs text-slate-500">{t('checkout:pickup_only')}</p>
      </section>
    </div>
  );
}
