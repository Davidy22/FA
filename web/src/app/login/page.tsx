'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import {
  authErrorKind,
  passwordRecoveryUrl,
  providerLabel,
  rememberReferral,
  type SocialProviderId,
} from '@/lib/auth';
import { SocialAuthButtons } from '@/components/SocialAuthButtons';

export default function LoginPage() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [referral, setReferral] = useState('');
  const [busy, setBusy] = useState(false);

  function describeAuthError(message: string, provider?: SocialProviderId) {
    const kind = authErrorKind(message);
    if (kind === 'manual_linking_disabled') return t('auth.err_manual_linking');
    if (kind === 'provider_not_enabled') {
      return t('auth.err_provider_not_enabled', {
        provider: provider ? providerLabel(provider) : t('auth.this_provider'),
      });
    }
    return message;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase().auth.resetPasswordForEmail(email, {
          redirectTo: passwordRecoveryUrl(),
        });
        if (error) throw error;
        // Do not reveal whether an account exists for this address.
        setNotice(t('auth.reset_sent'));
        return;
      }

      const { data, error } = mode === 'signin'
        ? await supabase().auth.signInWithPassword({ email, password })
        : await supabase().auth.signUp({
            email,
            password,
            options: {
              data: { referral_code: referral.trim().toUpperCase() },
            },
          });
      if (error) throw error;
      if (mode === 'signup' && !data.session) {
        setNotice(t('auth.confirm_email'));
        return;
      }
      router.push('/');
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  const copy = mode === 'signin'
    ? { title: t('nav.login'), sub: '' }
    : mode === 'signup'
      ? { title: t('nav.register'), sub: t('auth.create_account') }
      : { title: t('auth.forgot_password'), sub: t('auth.reset_hint') };

  const busyLabel = mode === 'signin' ? t('auth.signing_in') : t('auth.working');

  return (
    <div className="container-ma py-16 max-w-md">
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-1 text-slate-600">{copy.sub}</p>

      {mode !== 'forgot' && <>
        <div className="mt-6">
          <SocialAuthButtons
            disabled={busy}
            onStart={() => {
              if (mode === 'signup' && referral.trim()) rememberReferral(referral);
            }}
            onError={(message, provider) => setError(message ? describeAuthError(message, provider) : null)}
          />
          <p className="mt-2 text-xs text-slate-500">{t('auth.sso_hint')}</p>
        </div>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          <span>{t('auth.or')}</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      </>}

      <form onSubmit={submit} className="mt-6 space-y-3" aria-busy={busy}>
        <div>
          <label htmlFor="email" className="label">{t('auth.email')}</label>
          <input
            id="email"
            required
            type="email"
            autoComplete="email"
            className="input"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {mode !== 'forgot' && <div>
          <label htmlFor="password" className="label">{t('auth.password')}</label>
          <input
            id="password"
            required
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="input"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>}
        {mode === 'signup' && (
          <div>
            <label htmlFor="referral" className="label">{t('auth.referral_label')}</label>
            <input
              id="referral"
              className="input"
              maxLength={12}
              autoComplete="off"
              value={referral}
              onChange={(e) => setReferral(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              {t('auth.referral_hint')}{' '}
              <Link href="/rewards#referrals" className="text-brand-700 underline">
                {t('auth.referral_learn_more')}
              </Link>
            </p>
          </div>
        )}
        {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
        {notice && <p role="status" className="text-green-800 text-sm">{notice}</p>}
        <button type="submit" className="btn w-full gap-2" disabled={busy} aria-busy={busy}>
          {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" aria-hidden="true" />}
          {busy ? busyLabel : mode === 'forgot' ? t('auth.send_reset') : mode === 'signin' ? t('nav.login') : t('nav.register')}
        </button>
      </form>

      {mode === 'signin' && <p className="mt-3 text-sm">
        <button type="button" className="text-brand-700 underline" disabled={busy}
          onClick={() => { setMode('forgot'); setError(null); setNotice(null); }}>
          {t('auth.forgot_password')}
        </button>
      </p>}

      <p className="mt-4 text-sm text-slate-600">
        {mode === 'forgot' ? (
          <button type="button" className="font-medium text-brand-700 underline" disabled={busy}
            onClick={() => { setMode('signin'); setError(null); setNotice(null); }}>
            {t('auth.back_to_login')}
          </button>
        ) : <>
          {mode === 'signin' ? t('auth.no_account') : t('auth.have_account')}{' '}
          <button
            type="button"
            className="font-medium text-brand-700 underline"
            disabled={busy}
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null); }}
          >
            {mode === 'signin' ? t('nav.register') : t('nav.login')}
          </button>
        </>}
      </p>
    </div>
  );
}
