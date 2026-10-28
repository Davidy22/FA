'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { couponDiscountLabel } from '@/lib/rewards';
import type { Coupon } from '@/lib/types';

export default function CouponClaimPage() {
  const { t } = useTranslation(['common', 'rewards']);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const autoAttempted = useRef(false);

  const claim = useCallback(async (codeToClaim = code) => {
    if (!codeToClaim || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase().rpc('redeem_coupon_code', { p_code: codeToClaim });
      if (rpcError) throw rpcError;
      const row = Array.isArray(data) ? data[0] : data;
      setCoupon(row as Coupon);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, code]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCode((params.get('code') || '').trim().toUpperCase());
    void supabase().auth.getUser().then(({ data }) => {
      setSignedIn(!!data.user);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (loading || !signedIn || !code || autoAttempted.current) return;
    autoAttempted.current = true;
    void claim(code);
  }, [loading, signedIn, code, claim]);


  const loginHref = `/login?next=${encodeURIComponent(`/coupon/?code=${encodeURIComponent(code)}`)}`;
  return <div className="container-ma max-w-xl py-12">
    <h1 className="text-2xl font-semibold">{t('rewards:coupon_claim_title')}</h1>
    {loading ? <p className="mt-4">{t('common:loading')}</p> : coupon ? <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
      <p className="font-medium">{t('rewards:coupon_claim_success')}</p>
      {Number(coupon.discount_value) === 0 && Number(coupon.grant_points) > 0
        ? <p className="mt-2">{t('rewards:coupon_points_added', { count: Number(coupon.grant_points) })}</p>
        : <><p className="mt-2">{couponDiscountLabel({ discount_type: coupon.discount_type, discount_value: Number(coupon.discount_value), grant_points: coupon.grant_points }, t)}</p>
          <p className="mt-1 text-sm">{t('rewards:coupon_saved_account')}</p></>}
      <Link className="mt-4 inline-block underline" href="/rewards">{t('rewards:back_to_rewards')}</Link>
    </div> : !signedIn ? <div className="mt-4 space-y-3">
      <p className="text-slate-600">{t('rewards:coupon_sign_in_to_claim')}</p>
      <Link className="btn inline-flex" href={loginHref}>{t('common:nav.login')}</Link>
    </div> : <>
      <p className="mt-2 text-slate-600">{t('rewards:coupon_claim_intro')}</p>
      <label className="label mt-5" htmlFor="coupon-code">{t('rewards:coupon_code')}</label>
      <input id="coupon-code" className="input font-mono uppercase" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} />
      <button type="button" className="btn mt-3" disabled={!code || busy} onClick={() => void claim()}>{busy ? t('common:loading') : t('rewards:coupon_claim_action')}</button>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </>}
  </div>;
}
