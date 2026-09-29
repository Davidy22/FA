'use client';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import {
  DEFAULT_POINTS_PER_DOLLAR,
  DEFAULT_REDEEM_OPTIONS,
  couponDiscountLabel,
  parseRedeemOptions,
} from '@/lib/rewards';
import type { Coupon, Profile, RewardTransaction } from '@/lib/types';

export default function RewardsPage() {
  const { t } = useTranslation(['common', 'rewards']);
  const locale = useLocale((s) => s.locale);
  const queryClient = useQueryClient();
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [redeemedCode, setRedeemedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery<Profile | null>({
    queryKey: ['me_account'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ['rewards_settings'],
    queryFn: async () => {
      const [opts, rate] = await Promise.all([
        supabase().rpc('get_setting', { p_key: 'rewards.redeem_options' }),
        supabase().rpc('get_setting', { p_key: 'rewards.points_per_dollar' }),
      ]);
      return {
        options: parseRedeemOptions(opts.data),
        pointsPerDollar: Number(rate.data) || DEFAULT_POINTS_PER_DOLLAR,
      };
    },
  });

  const { data: coupons } = useQuery<Coupon[]>({
    queryKey: ['my_coupons'],
    enabled: !!profile,
    queryFn: async () =>
      (await supabase().from('coupons').select('*').order('created_at', { ascending: false }).limit(50)).data || [],
  });

  const { data: activity } = useQuery<RewardTransaction[]>({
    queryKey: ['rewards_activity'],
    enabled: !!profile,
    queryFn: async () =>
      (await supabase().from('reward_transactions').select('*').order('created_at', { ascending: false }).limit(50))
        .data || [],
  });

  async function redeem(optionIndex: number) {
    setBusyIndex(optionIndex);
    setError(null);
    setRedeemedCode(null);
    try {
      const { data, error: rpcErr } = await supabase().rpc('redeem_rewards', { p_option_index: optionIndex });
      if (rpcErr) throw new Error(rpcErr.message);
      setRedeemedCode((data as Coupon).code);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['me_account'] }),
        queryClient.invalidateQueries({ queryKey: ['my_coupons'] }),
        queryClient.invalidateQueries({ queryKey: ['rewards_activity'] }),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyIndex(null);
    }
  }

  if (isLoading) return <div className="container-fa py-10">{t('common:loading')}</div>;
  if (!profile) {
    return (
      <div className="container-fa py-10">
        <h1 className="text-2xl font-semibold">{t('rewards:title')}</h1>
        <p className="mt-3 text-slate-600">{t('rewards:sign_in_required')}</p>
        <Link href="/login" className="btn mt-4 inline-block">{t('common:nav.login')}</Link>
      </div>
    );
  }

  const balance = profile.points_balance ?? 0;
  const options = settings?.options ?? DEFAULT_REDEEM_OPTIONS;
  const pointsPerDollar = settings?.pointsPerDollar ?? DEFAULT_POINTS_PER_DOLLAR;

  return (
    <div className="container-fa py-10 max-w-3xl">
      <h1 className="text-2xl font-semibold">{t('rewards:title')}</h1>
      <p className="mt-1 text-slate-600">{t('rewards:subtitle')}</p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">{t('rewards:balance_label')}</p>
        <p className="mt-1 text-3xl font-semibold text-brand-700">{t('rewards:points', { count: balance })}</p>
        <p className="mt-2 text-sm text-slate-600">{t('rewards:earn_rate', { count: pointsPerDollar })}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-medium">{t('rewards:redeem_title')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {options.map((opt, i) => {
            const affordable = balance >= opt.points;
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-4 flex flex-col gap-2">
                <p className="font-semibold">
                  {couponDiscountLabel(
                    { discount_type: opt.discount_type, discount_value: opt.discount_value },
                    t,
                  )}
                </p>
                <p className="text-sm text-slate-500">{t('rewards:points', { count: opt.points })}</p>
                <button
                  className="btn mt-auto w-full"
                  disabled={!affordable || busyIndex !== null}
                  onClick={() => redeem(i)}
                >
                  {busyIndex === i ? t('common:loading') : t('rewards:redeem')}
                </button>
                {!affordable && <p className="text-xs text-slate-400">{t('rewards:not_enough')}</p>}
              </div>
            );
          })}
        </div>
        {redeemedCode && (
          <p className="mt-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {t('rewards:redeem_success', { code: redeemedCode })}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-medium">{t('rewards:my_coupons')}</h2>
          <div className="text-right">
            <p className="text-sm text-slate-600">{t('rewards:offers_promo')}</p>
            <Link href="/offers" className="text-sm text-brand-700 underline">{t('rewards:offers_promo_cta')}</Link>
          </div>
        </div>
        {!coupons?.length ? (
          <p className="mt-3 text-slate-500">{t('rewards:no_coupons')}</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-2">{t('rewards:coupon_code')}</th>
                <th>{t('rewards:discount')}</th>
                <th>{t('rewards:status')}</th>
                <th className="text-right">{t('rewards:expires')}</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2 font-mono">{c.code}</td>
                  <td>{couponDiscountLabel(c, t)}</td>
                  <td>
                    <span className={c.status === 'active' ? 'badge' : 'badge text-slate-500'}>
                      {c.status === 'active' ? t('rewards:status_active') : t('rewards:status_used')}
                    </span>
                  </td>
                  <td className="text-right">
                    {c.expires_at ? new Date(c.expires_at).toLocaleDateString(locale) : t('rewards:no_expiry')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-medium">{t('rewards:activity')}</h2>
        {!activity?.length ? (
          <p className="mt-3 text-slate-500">{t('rewards:no_activity')}</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-2">{t('rewards:date')}</th>
                <th>{t('rewards:points_label')}</th>
                <th>{t('rewards:detail')}</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="py-2">{new Date(a.created_at).toLocaleDateString(locale)}</td>
                  <td className={a.points >= 0 ? 'text-green-700 font-medium' : 'text-slate-700 font-medium'}>
                    {a.points > 0 ? `+${a.points}` : a.points}
                  </td>
                  <td className="text-slate-600">{a.memo || a.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
