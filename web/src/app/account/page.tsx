'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User, UserIdentity } from '@supabase/supabase-js';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';
import {
  SOCIAL_PROVIDERS,
  authCallbackUrl,
  authErrorKind,
  providerLabel,
  rememberAuthNext,
  type SocialProviderId,
} from '@/lib/auth';
import { ProviderIcon } from '@/components/ProviderIcon';
import type { Order, Profile } from '@/lib/types';

export default function AccountPage() {
  const { t } = useTranslation(['common', 'orders', 'rewards']);
  const locale = useLocale((s) => s.locale);
  const queryClient = useQueryClient();
  const [busyProvider, setBusyProvider] = useState<SocialProviderId | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: authUser, isLoading: userLoading, refetch: refetchUser } = useQuery<User | null>({
    queryKey: ['auth_user'],
    queryFn: async () => (await supabase().auth.getUser()).data.user ?? null,
  });

  const { data: profile, isLoading: profileLoading } = useQuery<Profile | null>({
    queryKey: ['me_account'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['my_orders'],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase().from('orders').select('*').order('created_at', { ascending: false }).limit(50);
      return data || [];
    },
  });

  const identities: UserIdentity[] = authUser?.identities ?? [];
  const linkedProviders = new Set(identities.map((identity) => identity.provider));
  const canUnlink = identities.length > 1;

  function describeAuthError(message: string, provider?: string) {
    const kind = authErrorKind(message);
    if (kind === 'manual_linking_disabled') return t('auth.err_manual_linking');
    if (kind === 'provider_not_enabled') {
      return t('auth.err_provider_not_enabled', { provider: provider ? providerLabel(provider) : t('auth.this_provider') });
    }
    if (/unlink.*last|last.*identity/i.test(message)) return t('auth.err_last_identity');
    return message;
  }

  async function connect(provider: SocialProviderId) {
    setBusyProvider(provider);
    setError(null);
    setNotice(null);
    try {
      rememberAuthNext('/account');
      const { error } = await supabase().auth.linkIdentity({
        provider,
        options: { redirectTo: authCallbackUrl() },
      });
      if (error) throw error;
      // The browser is redirected to the provider; the callback finishes the link.
    } catch (e) {
      setError(describeAuthError((e as Error).message, provider));
      setBusyProvider(null);
    }
  }

  async function disconnect(identity: UserIdentity) {
    const label = providerLabel(identity.provider);
    if (!window.confirm(t('auth.unlink_confirm', { provider: label }))) return;
    setUnlinkingId(identity.identity_id);
    setError(null);
    setNotice(null);
    try {
      const { error } = await supabase().auth.unlinkIdentity(identity);
      if (error) throw error;
      await Promise.all([
        refetchUser(),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
      setNotice(t('auth.unlinked', { provider: label }));
    } catch (e) {
      setError(describeAuthError((e as Error).message, identity.provider));
    } finally {
      setUnlinkingId(null);
    }
  }

  if (userLoading || profileLoading) {
    return <div className="container-ma py-10">{t('loading')}</div>;
  }
  if (!authUser) {
    return (
      <div className="container-ma py-10">
        <h1 className="text-2xl font-semibold">{t('nav.account')}</h1>
        <p className="mt-3 text-slate-600">{t('auth.sign_in_to_manage')}</p>
        <Link href="/login" className="btn mt-4 inline-flex">{t('nav.login')}</Link>
      </div>
    );
  }

  return (
    <div className="container-ma py-10">
      <h1 className="text-2xl font-semibold">{t('nav.account')}</h1>
      <p className="mt-2 text-slate-600">{authUser.email}</p>
      {profile?.display_name && <p className="text-sm text-slate-500">{profile.display_name}</p>}
      <p className="mt-3 text-sm text-slate-700">
        {t('rewards:balance_label')}: <strong>{t('rewards:points', { count: profile?.points_balance ?? 0 })}</strong>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/rewards" className="btn-outline inline-block">{t('nav.rewards')}</Link>
        <Link href="/offers" className="btn-outline inline-block">{t('rewards:offers_promo_cta')}</Link>
        {profile?.is_creator && <Link href="/creator" className="btn-outline inline-block">{t('nav.creator_dashboard')}</Link>}
      </div>

      <section className="mt-8 max-w-2xl">
        <h2 className="text-xl font-medium">{t('auth.sign_in_methods')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('auth.sign_in_methods_desc')}</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-green-800">{notice}</p>}
        <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {linkedProviders.has('email') && (
            <li className="flex flex-wrap items-center gap-3 p-4">
              <ProviderIcon provider="email" className="h-5 w-5 text-slate-600" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t('auth.email_password')}</p>
                <p className="truncate text-sm text-slate-500">{authUser.email}</p>
              </div>
              <span className="badge">{t('auth.connected')}</span>
            </li>
          )}
          {SOCIAL_PROVIDERS.map((provider) => {
            const identity = identities.find((item) => item.provider === provider.id);
            const isLinked = !!identity;
            const isOnlyMethod = identities.length <= 1;
            return (
              <li key={provider.id} className="flex flex-wrap items-center gap-3 p-4">
                <ProviderIcon provider={provider.id} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{provider.label}</p>
                  <p className="truncate text-sm text-slate-500">
                    {isLinked
                      ? (identity.identity_data?.email || identity.identity_data?.user_name || t('auth.connected'))
                      : t('auth.not_connected')}
                  </p>
                </div>
                {isLinked ? (
                  <div className="flex items-center gap-3">
                    <span className="badge">{t('auth.connected')}</span>
                    <button
                      type="button"
                      className="text-sm text-red-700 underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                      disabled={!canUnlink || isOnlyMethod || unlinkingId !== null}
                      title={!canUnlink ? t('auth.last_method_hint') : undefined}
                      onClick={() => void disconnect(identity)}
                    >
                      {unlinkingId === identity.identity_id ? t('auth.working') : t('auth.disconnect')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-outline px-3 py-1.5 text-sm"
                    disabled={busyProvider !== null}
                    onClick={() => void connect(provider.id)}
                  >
                    {busyProvider === provider.id ? t('auth.redirecting') : t('auth.connect')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!canUnlink && <p className="mt-2 text-xs text-slate-500">{t('auth.last_method_hint')}</p>}
      </section>

      <h2 className="mt-8 text-xl font-medium">{t('orders:title')}</h2>
      {!orders?.length ? <p className="text-slate-500 mt-3">{t('orders:none')}</p> : (
        <div className="overflow-x-auto"><table className="mt-4 w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="py-2">#</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="py-2 font-mono">{o.order_number}</td>
                <td>{new Date(o.created_at).toLocaleDateString(locale)}</td>
                <td>{t(`common:status.${o.status}`)}</td>
                <td className="text-right">{formatMoney(o.total_amount, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
