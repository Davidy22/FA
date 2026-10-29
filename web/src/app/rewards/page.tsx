'use client';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import { t_db } from '@/lib/format';
import {
  DEFAULT_POINTS_PER_DOLLAR,
  DEFAULT_REDEEM_OPTIONS,
  DEFAULT_TIERS,
  couponConditions,
  couponDiscountLabel,
  parseRedeemOptions,
  parseTiers,
  tierProgress,
} from '@/lib/rewards';
import { ReferralCard } from '@/components/ReferralCard';
import type { Coupon, PremadeProduct, Profile, RewardTransaction } from '@/lib/types';

export default function RewardsPage() {
  const { t } = useTranslation(['common', 'rewards']);
  const locale = useLocale((s) => s.locale);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);
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
      const [opts, rate, tiers] = await Promise.all([
        supabase().rpc('get_setting', { p_key: 'rewards.redeem_options' }),
        supabase().rpc('get_setting', { p_key: 'rewards.points_per_dollar' }),
        supabase().rpc('get_setting', { p_key: 'rewards.tiers' }),
      ]);
      return {
        options: parseRedeemOptions(opts.data),
        pointsPerDollar: Number(rate.data) || DEFAULT_POINTS_PER_DOLLAR,
        tiers: parseTiers(tiers.data),
      };
    },
  });

  const { data: coupons } = useQuery<Coupon[]>({
    queryKey: ['my_coupons'],
    enabled: !!profile,
    queryFn: async () =>
      (await supabase().from('coupons').select('*').order('created_at', { ascending: false }).limit(50)).data || [],
  });

  // Names for the products a coupon or redemption option is restricted to.
  const productIds = Array.from(new Set([
    ...(coupons || []).map((coupon) => coupon.product_id),
    ...(settings?.options || []).map((option) => option.product_id ?? null),
  ].filter((id): id is string => !!id)));
  const { data: products } = useQuery<Pick<PremadeProduct, 'id' | 'name' | 'slug'>[]>({
    queryKey: ['coupon_products', productIds],
    enabled: productIds.length > 0,
    queryFn: async () =>
      (await supabase().from('premade_products').select('id,name,slug').in('id', productIds)).data || [],
  });
  const productName = (id: string | null | undefined) =>
    id ? (t_db(products?.find((product) => product.id === id)?.name, locale) || id) : null;

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

  if (isLoading) return <div className="container-ma py-10">{t('common:loading')}</div>;
  if (!profile) {
    return (
      <div className="container-ma py-10 max-w-3xl">
        <h1 className="text-2xl font-semibold">{t('rewards:title')}</h1>
        <p className="mt-3 text-slate-600">{t('rewards:sign_in_required')}</p>
        <Link href="/login" className="btn mt-4 inline-block">{t('common:nav.login')}</Link>
        <ReferralCard />
      </div>
    );
  }

  const balance = profile.points_balance ?? 0;
  const options = settings?.options ?? DEFAULT_REDEEM_OPTIONS;
  const pointsPerDollar = settings?.pointsPerDollar ?? DEFAULT_POINTS_PER_DOLLAR;
  const tiers = settings?.tiers ?? DEFAULT_TIERS;
  const membership = tierProgress(profile.lifetime_points ?? 0, tiers);
  const tierName = (tier: { name: string; multiplier: number }, index: number) =>
    tier.name || t('rewards:tier_default_name', { number: index + 1 });

  return (
    <div className="container-ma py-10 max-w-3xl">
      <h1 className="text-2xl font-semibold">{t('rewards:title')}</h1>
      <p className="mt-1 text-slate-600">{t('rewards:subtitle')}</p>
      <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200" role="tablist" aria-label={t('rewards:tabs_label')}>
        {[t('rewards:tab_balance'), t('rewards:tab_redeem'), t('rewards:tab_membership')].map((label, index) => (
          <button key={label} type="button" role="tab" aria-selected={activeTab === index}
            className={`border-b-2 px-3 py-2 text-sm ${activeTab === index ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-slate-600'}`}
            onClick={() => setActiveTab(index as 0 | 1 | 2)}>{label}</button>
        ))}
      </div>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5" hidden={activeTab !== 0}>
        <p className="text-sm text-slate-500">{t('rewards:balance_label')}</p>
        <p className="mt-1 text-3xl font-semibold text-brand-700">{t('rewards:points', { count: balance })}</p>
        <p className="mt-2 text-sm text-slate-600">{t('rewards:earn_rate', { count: pointsPerDollar })}</p>
        {membership.current.multiplier > 1 && (
          <p className="mt-1 text-sm font-medium text-brand-700">
            {t('rewards:earn_rate_tier', {
              multiplier: membership.current.multiplier,
              count: Math.round(pointsPerDollar * membership.current.multiplier * 100) / 100,
            })}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="membership-heading" hidden={activeTab !== 2}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="membership-heading" className="text-xl font-medium">{t('rewards:membership_title')}</h2>
          <p className="text-sm text-slate-600">
            {t('rewards:lifetime_points', { count: profile.lifetime_points ?? 0 })}
          </p>
        </div>
        <p className="mt-2 text-lg font-semibold text-brand-700">
          {tierName(membership.current, Math.max(0, tiers.indexOf(membership.current)))}
          <span className="ml-2 text-sm font-normal text-slate-600">
            {t('rewards:tier_multiplier', { multiplier: membership.current.multiplier })}
          </span>
        </p>
        {membership.next ? (
          <>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(membership.ratio * 100)}
              aria-label={t('rewards:tier_progress_label')}>
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.round(membership.ratio * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {t('rewards:tier_next', {
                points: membership.remaining,
                tier: tierName(membership.next, Math.max(0, tiers.indexOf(membership.next))),
                multiplier: membership.next.multiplier,
              })}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600">{t('rewards:tier_top')}</p>
        )}
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map((tier, index) => (
            <li key={`${tier.min_lifetime_points}-${tier.multiplier}-${index}`}
              className={'rounded border p-2 ' + (tier === membership.current ? 'border-brand-600 bg-brand-50' : 'border-slate-200')}>
              <p className="font-medium">{tierName(tier, index)}</p>
              <p className="text-xs text-slate-600">
                {t('rewards:tier_requirement', { points: tier.min_lifetime_points, multiplier: tier.multiplier })}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div hidden={activeTab !== 2}><ReferralCard code={profile.referral_code} /></div>

      <section className="mt-8" hidden={activeTab !== 1}>
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
                {opt.product_id && <p className="text-sm text-brand-700">
                  {t('rewards:redeem_for_product', { product: productName(opt.product_id) })}
                </p>}
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

      <section className="mt-8" hidden={activeTab !== 0}>
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
          <div className="overflow-x-auto"><table className="mt-3 w-full text-sm">
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
                  <td>
                    {couponDiscountLabel(c, t)}
                    {couponConditions(c, productName(c.product_id), t).map((condition) => (
                      <span key={condition} className="block text-xs text-slate-500">{condition}</span>
                    ))}
                  </td>
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
          </table></div>
        )}
      </section>

      <section className="mt-8" hidden={activeTab !== 2}>
        <h2 className="text-xl font-medium">{t('rewards:activity')}</h2>
        {!activity?.length ? (
          <p className="mt-3 text-slate-500">{t('rewards:no_activity')}</p>
        ) : (
          <div className="overflow-x-auto"><table className="mt-3 w-full text-sm">
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
          </table></div>
        )}
      </section>
    </div>
  );
}
