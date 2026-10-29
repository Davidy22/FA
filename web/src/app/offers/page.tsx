'use client';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Coupon, Profile } from '@/lib/types';

export default function OffersPage() {
  const { t } = useTranslation(['common', 'rewards']);
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Coupon | null>(null);

  const { data: profile, isLoading } = useQuery<Profile | null>({
    queryKey: ['me_account'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setClaimed(null);
    try {
      const { data, error: rpcErr } = await supabase().rpc('claim_offer_code', { p_code: code.trim() });
      if (rpcErr) throw new Error(rpcErr.message);
      setClaimed(data as Coupon);
      setCode('');
      // The coupons table and points balance on /rewards must not wait for a
      // manual refresh after a successful claim.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my_coupons'] }),
        queryClient.invalidateQueries({ queryKey: ['me_account'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['rewards_activity'] }),
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <div className="container-ma py-10">{t('common:loading')}</div>;

  if (!profile) {
    return (
      <div className="container-ma py-10 max-w-xl">
        <h1 className="text-2xl font-semibold">{t('rewards:offers_title')}</h1>
        <p className="mt-3 text-slate-600">{t('rewards:sign_in_required')}</p>
        <Link href="/login" className="btn mt-4 inline-block">{t('common:nav.login')}</Link>
      </div>
    );
  }

  return (
    <div className="container-ma py-10 max-w-xl">
      <h1 className="text-2xl font-semibold">{t('rewards:offers_title')}</h1>
      <p className="mt-2 text-slate-600">{t('rewards:offers_intro')}</p>

      <form onSubmit={claim} className="mt-6 rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <div>
          <label className="label" htmlFor="offer-code">{t('rewards:offer_label')}</label>
          <input
            id="offer-code"
            className="input font-mono uppercase"
            placeholder={t('rewards:offer_placeholder')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn w-full" disabled={busy || !code.trim()}>
          {busy ? t('common:loading') : t('rewards:claim')}
        </button>
        <p className="text-xs text-slate-500">{t('rewards:hints')}</p>
      </form>

      {claimed && (
        <div role="status" className="mt-4 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p>{t('rewards:claim_success')}</p>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <p className="mt-6 text-sm">
        <Link href="/rewards" className="text-brand-700 underline">{t('rewards:back_to_rewards')}</Link>
      </p>
    </div>
  );
}
