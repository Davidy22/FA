'use client';
import { useTranslation } from 'react-i18next';
import { useCart } from '@/store/cart';
import { useLocale } from '@/store/locale';
import { useLocation } from '@/store/location';
import { formatMoney, t_db } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';
import type { Coupon, Location, PremadeProduct, Profile } from '@/lib/types';
import { couponConditions, couponDiscountLabel } from '@/lib/rewards';
import {
  FREE_DELIVERY_THRESHOLD,
  addressIsComplete,
  deliveryFee,
  formatDeliveryAddress,
  parseDeliveryAddress,
  type DeliveryAddress,
  type Fulfilment,
} from '@/lib/shipping';
import { withBasePath } from '@/lib/paths';
import { edgeErrorMessage } from '@/lib/edge-errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CheckoutPage() {
  const { t } = useTranslation(['common','checkout','errors','rewards','cart']);
  const locale = useLocale((s) => s.locale);
  const {
    items, location_id, coupon_code, setCoupon, note, setNote,
    fulfilment, setFulfilment, delivery_address, setDeliveryAddress,
  } = useCart();
  const cartLocationId = useLocation((s) => s.selectedLocationId) || location_id;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState<DeliveryAddress>(() => parseDeliveryAddress(delivery_address));
  const [saveAddress, setSaveAddress] = useState(true);
  const [orderNote, setOrderNote] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressSaved, setAddressSaved] = useState(false);

  const { data: profile, isPending: profilePending } = useQuery<Profile | null>({
    queryKey: ['me'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      const { data } = await supabase().from('profiles').select('*').eq('id', user.id).single();
      return (data as Profile) ?? null;
    },
  });

  // Signed-in customers never retype their details: fill them from the account
  // and reuse the saved delivery address.
  useEffect(() => {
    if (!profile) return;
    setName((current) => current || profile.display_name || '');
    setEmail((current) => current || profile.email);
    const saved = parseDeliveryAddress(profile.delivery_address);
    if (saved.line1) {
      setAddress((current) => (addressIsComplete(current) ? current : saved));
    }
  }, [profile]);

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

  const deliveryReady = fulfilment === 'pickup' || addressIsComplete(address);

  const { data: pricing, error: pricingError } = useQuery<any>({
    // Keyed on completeness, not the address text: the fee depends on the
    // merchandise total, so typing an address must not reprice on every keystroke.
    queryKey: ['price_cart', items, cartLocationId, coupon_code, fulfilment, deliveryReady],
    enabled: !!cartLocationId && items.length > 0,
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      const { data, error } = await supabase().rpc('price_cart', {
        p_cart: {
          location_id: cartLocationId,
          items,
          user_id: user?.id || null,
          coupon_code: coupon_code || null,
          // Hold the order as a collection while a delivery address is still
          // incomplete; the page asks for the missing fields instead.
          fulfilment: deliveryReady ? fulfilment : 'pickup',
          ...(deliveryReady && fulfilment === 'delivery' ? { shipping_address: address } : {}),
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
        p_cart: {
          location_id: cartLocationId, items, user_id: user?.id || null,
          coupon_code: null, fulfilment: 'pickup',
        },
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

  // A product-scoped coupon says which product it applies to, without showing codes.
  const couponProductIds = Array.from(new Set(
    applicableCoupons.map((coupon) => coupon.product_id).filter((id): id is string => !!id)
  ));
  const { data: couponProducts } = useQuery<Pick<PremadeProduct, 'id' | 'name'>[]>({
    queryKey: ['coupon_products', couponProductIds],
    enabled: couponProductIds.length > 0,
    queryFn: async () =>
      (await supabase().from('premade_products').select('id,name').in('id', couponProductIds)).data || [],
  });
  const couponProductName = (id: string | null) =>
    id ? t_db(couponProducts?.find((product) => product.id === id)?.name, locale) : null;

  // Final total after coupons and delivery, mirroring what price_cart charges.
  const subtotal = Number(pricing?.subtotal ?? 0);
  const discount = Number(pricing?.discount_amount ?? 0);
  const tax = Number(pricing?.tax_amount ?? 0);
  const merchandise = Math.max(0, subtotal - discount);
  // Use the server's fee once the address is complete; before that, preview it.
  const shipping = fulfilment === 'delivery'
    ? (deliveryReady ? Number(pricing?.shipping_amount ?? 0) : deliveryFee(merchandise, 'delivery'))
    : 0;
  const finalTotal = Math.round((merchandise + tax + shipping) * 100) / 100;
  const currency = pricing?.currency ?? location?.currency;
  const freeDelivery = fulfilment === 'delivery' && merchandise >= FREE_DELIVERY_THRESHOLD;

  const contactName = profile ? (profile.display_name || profile.email) : name.trim();
  const contactEmail = profile ? profile.email : email.trim();
  const canPay = !!cartLocationId && items.length > 0 && !!pricing &&
    EMAIL_PATTERN.test(contactEmail) && !!contactName &&
    (fulfilment === 'pickup' || addressIsComplete(address));

  async function saveAddressToAccount() {
    if (!profile || fulfilment !== 'delivery' || !saveAddress || !addressIsComplete(address)) return;
    setDeliveryAddress(address);
    if (formatDeliveryAddress(parseDeliveryAddress(profile.delivery_address)) === formatDeliveryAddress(address)) return;
    const { error: saveError } = await supabase().from('profiles')
      .update({ delivery_address: address }).eq('id', profile.id);
    if (saveError) console.warn('Could not save delivery address', saveError.message);
    else setAddressSaved(true);
  }

  /**
   * A stable key for "this exact cart". Double-clicking Pay (or retrying after a
   * network blip) reuses one Stripe session instead of opening a second one;
   * editing the cart produces a new key, so the price still follows the cart.
   */
  function checkoutIdempotencyKey(): string {
    const material = JSON.stringify({
      location: cartLocationId,
      items,
      coupon: coupon_code || null,
      fulfilment,
      address: fulfilment === 'delivery' ? address : null,
      email: contactEmail,
    });
    // FNV-1a: tiny, stable, and only needs to avoid accidental collisions.
    let hash = 0x811c9dc5;
    for (let index = 0; index < material.length; index += 1) {
      hash ^= material.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `ma-${hash.toString(36)}-${material.length.toString(36)}`;
  }

  async function handlePay() {
    if (!canPay || busy) return;
    setBusy(true); setError(null);
    try {
      await saveAddressToAccount();
      const origin = window.location.origin;
      const { data: { user } } = await supabase().auth.getUser();
      const cart = {
        location_id: cartLocationId,
        items,
        user_id: user?.id || null,
        contact_email: contactEmail,
        contact_name: contactName,
        coupon_code: coupon_code || null,
        note: orderNote.trim() || null,
        fulfilment,
        ...(fulfilment === 'delivery' ? { shipping_address: address } : {}),
      };
      const { data, error } = await supabase().functions.invoke('stripe-checkout', {
        body: {
          cart,
          success_url: `${origin}${withBasePath('/checkout/success/')}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}${withBasePath('/cart/')}`,
          contact_email: contactEmail,
          contact_name: contactName,
          locale,
          idempotency_key: checkoutIdempotencyKey(),
        },
      });
      if (error) throw error;
      // Only follow a Stripe-hosted URL: a misconfigured or spoofed response
      // must not be able to bounce the customer to another origin.
      if (data?.url) {
        let target: URL;
        try { target = new URL(data.url); } catch { throw new Error('Checkout returned an invalid URL'); }
        if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') {
          throw new Error('Checkout returned an unexpected URL');
        }
        window.location.href = target.toString();
      }
    } catch (e) {
      setError(await edgeErrorMessage(e, t('checkout:payment_error')));
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
          {profilePending ? (
            <p className="text-sm text-slate-500">{t('common:loading')}</p>
          ) : profile ? (
            <div className="rounded border border-slate-200 p-3 text-sm">
              <p className="font-medium">{profile.display_name || profile.email}</p>
              <p className="text-slate-600">{profile.email}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input className="input" placeholder={t('checkout:name')} aria-label={t('checkout:name')}
                  value={name} onChange={(e)=>setName(e.target.value)} />
                <input className="input" type="email" placeholder={t('checkout:email')} aria-label={t('checkout:email')}
                  value={email} onChange={(e)=>setEmail(e.target.value)} />
              </div>
              <p className="mt-2 text-xs text-slate-500">{t('checkout:guest_ok')}</p>
            </>
          )}
        </div>

        <fieldset className="rounded border border-slate-200 p-4 text-sm">
          <legend className="px-1 font-medium">{t('checkout:fulfilment_title')}</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {(['pickup', 'delivery'] as Fulfilment[]).map((option) => (
              <label key={option} className={`flex cursor-pointer items-start gap-2 rounded border p-3 ${fulfilment === option ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
                <input
                  type="radio"
                  name="fulfilment"
                  className="mt-1"
                  checked={fulfilment === option}
                  onChange={() => setFulfilment(option)}
                />
                <span>
                  <span className="block font-medium">
                    {option === 'pickup' ? t('checkout:pickup') : t('checkout:delivery')}
                  </span>
                  <span className="block text-xs text-slate-600">
                    {option === 'pickup'
                      ? t('checkout:pickup_at', { location: location?.name || '' })
                      : t('checkout:delivery_summary')}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {fulfilment === 'pickup' && (
            <div className="mt-3 rounded bg-slate-50 p-3">
              <p className="font-medium">{location?.name}</p>
              {location?.address && <p className="text-slate-700">{location.address}</p>}
            </div>
          )}

          {fulfilment === 'delivery' && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">{t('checkout:address_recipient')} *
                  <input className="input mt-1" value={address.recipient}
                    onChange={(e) => setAddress({ ...address, recipient: e.target.value })} />
                </label>
                <label className="text-sm">{t('checkout:address_phone')} *
                  <input className="input mt-1" type="tel" value={address.phone}
                    onChange={(e) => setAddress({ ...address, phone: e.target.value })} />
                </label>
              </div>
              <label className="block text-sm">{t('checkout:address_line1')} *
                <input className="input mt-1" value={address.line1}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })} />
              </label>
              <label className="block text-sm">{t('checkout:address_line2')}
                <input className="input mt-1" value={address.line2}
                  onChange={(e) => setAddress({ ...address, line2: e.target.value })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">{t('checkout:address_district')} *
                  <input className="input mt-1" value={address.district}
                    onChange={(e) => setAddress({ ...address, district: e.target.value })} />
                </label>
                <label className="text-sm">{t('checkout:address_region')}
                  <input className="input mt-1" value={address.region}
                    onChange={(e) => setAddress({ ...address, region: e.target.value })} />
                </label>
                <label className="text-sm">{t('checkout:address_postal')}
                  <input className="input mt-1" value={address.postal_code}
                    onChange={(e) => setAddress({ ...address, postal_code: e.target.value })} />
                </label>
              </div>
              <p className="text-xs text-slate-500">{t('checkout:delivery_cost_note')}</p>
              {profile && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                  {t('checkout:save_address')}
                </label>
              )}
              {addressSaved && <p role="status" className="text-xs text-green-800">{t('checkout:address_saved')}</p>}
              {!addressIsComplete(address) && (
                <p className="text-xs text-amber-700">{t('checkout:address_incomplete')}</p>
              )}
            </div>
          )}
        </fieldset>

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
              <span className="text-xs">{t('rewards:coupon_applied')}</span>
              <button
                type="button"
                className="text-slate-500 hover:text-red-600"
                aria-label={t('rewards:coupon_remove')}
                onClick={() => setCoupon(null)}
              >✕</button>
            </div>
          )}
          {applicableCoupons.length ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {applicableCoupons.map((coupon) => {
                const selected = coupon_code === coupon.code;
                return (
                  <li key={coupon.id}>
                    <button
                      type="button"
                      className={`flex h-full w-full flex-col gap-1 rounded border p-3 text-left ${selected ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-brand-300'}`}
                      aria-pressed={selected}
                      onClick={() => setCoupon(selected ? null : coupon.code)}
                    >
                      <span className="font-medium">{couponDiscountLabel(coupon, t)}</span>
                      {couponConditions(coupon, couponProductName(coupon.product_id), t).map((condition) => (
                        <span key={condition} className="text-xs text-slate-600">{condition}</span>
                      ))}
                      <span className="text-xs text-slate-500">
                        {coupon.expires_at
                          ? t('rewards:expires_on', { date: new Date(coupon.expires_at).toLocaleDateString(locale) })
                          : t('rewards:no_expiry')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-slate-500">{t('rewards:no_applicable_coupons')}</p>
          )}
          {pricingError && (
            <p role="alert" className="mt-2 text-xs text-red-700">{(pricingError as Error).message}</p>
          )}
        </div>

        {pricing && (
          <div className="rounded border border-slate-200 p-4 text-sm">
            <h3 className="font-medium mb-2">{t('checkout:review_order')}</h3>
            <dl className="space-y-1">
              <div className="flex justify-between"><dt>{t('checkout:items')}</dt><dd>{formatMoney(subtotal, locale, currency)}</dd></div>
              {discount > 0 && (
                <div className="flex justify-between text-green-700">
                  <dt>{t('rewards:discount')}</dt>
                  <dd>−{formatMoney(discount, locale, currency)}</dd>
                </div>
              )}
              {fulfilment === 'delivery' && (
                <div className="flex justify-between">
                  <dt>{t('checkout:delivery')}</dt>
                  <dd>{shipping > 0 ? formatMoney(shipping, locale, currency) : t('checkout:free')}</dd>
                </div>
              )}
              {tax > 0 && (
                <div className="flex justify-between"><dt>{t('common:tax')}</dt><dd>{formatMoney(tax, locale, currency)}</dd></div>
              )}
              <div className="flex justify-between font-semibold pt-2 border-t">
                <dt>{t('checkout:final_total')}</dt>
                <dd>{formatMoney(finalTotal, locale, currency)}</dd>
              </div>
            </dl>
            {fulfilment === 'delivery' && !freeDelivery && (
              <p className="mt-2 text-xs text-slate-500">
                {t('checkout:free_delivery_hint', { amount: formatMoney(FREE_DELIVERY_THRESHOLD, locale, currency) })}
              </p>
            )}
          </div>
        )}
        {error && <p className="text-red-700">{error}</p>}
        <button className="btn w-full" disabled={busy || !canPay} onClick={handlePay}>
          {busy ? t('common:loading') : t('checkout:pay_with_stripe')}
        </button>
      </section>
    </div>
  );
}
