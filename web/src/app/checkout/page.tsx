'use client';
import { useTranslation } from 'react-i18next';
import { useCart } from '@/store/cart';
import { useLocale } from '@/store/locale';
import { useLocation } from '@/store/location';
import { formatMoney } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Location } from '@/lib/types';

export default function CheckoutPage() {
  const { t } = useTranslation(['common','checkout','errors','rewards']);
  const locale = useLocale((s) => s.locale);
  const { items, location_id, coupon_code, setCoupon } = useCart();
  const cartLocationId = useLocation((s) => s.selectedLocationId) || location_id;
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);

  const { data: location } = useQuery<Location>({
    queryKey: ['location', cartLocationId],
    enabled: !!cartLocationId,
    queryFn: async () => (await supabase().from('locations').select('*').eq('id', cartLocationId).single()).data as Location,
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
          location_id: cartLocationId,
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
      };
      const { data, error } = await supabase().functions.invoke('stripe-checkout', {
        body: {
          cart,
          success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/cart`,
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
    return <div className="container-fa py-10"><p>{t('errors:select_location_first')}</p></div>;
  }

  return (
    <div className="container-fa py-10 max-w-2xl">
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
        <div className="rounded border border-slate-200 p-4 text-sm">
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
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs">{t('rewards:coupon_applied')}: <strong>{coupon_code}</strong></span>
              <button
                className="text-slate-500 hover:text-red-600"
                aria-label={t('rewards:coupon_remove')}
                onClick={() => setCoupon(null)}
              >✕</button>
            </div>
          )}
          {couponError && <p className="mt-2 text-xs text-red-700">{couponError}</p>}
          {pricingError && coupon_code && (
            <p className="mt-2 text-xs text-red-700">{(pricingError as Error).message}</p>
          )}
        </div>
        {pricing && (
          <div className="rounded border border-slate-200 p-4 text-sm">
            <h3 className="font-medium mb-2">{t('checkout:review_order')}</h3>
            <dl className="space-y-1">
              <div className="flex justify-between"><dt>{t('common:subtotal')}</dt><dd>{formatMoney(pricing.subtotal, locale)}</dd></div>
              {pricing.discount_amount > 0 && (
                <div className="flex justify-between text-green-700">
                  <dt>{t('rewards:discount')}</dt>
                  <dd>−{formatMoney(pricing.discount_amount, locale)}</dd>
                </div>
              )}
              <div className="flex justify-between"><dt>{t('common:tax')}</dt><dd>{formatMoney(pricing.tax_amount, locale)}</dd></div>
              <div className="flex justify-between font-semibold pt-2 border-t"><dt>{t('common:total')}</dt><dd>{formatMoney(pricing.total_amount, locale)}</dd></div>
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
