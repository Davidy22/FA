'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const { t } = useTranslation('common');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;

    async function prepareRecovery() {
      try {
        const client = supabase();
        // createBrowserClient handles both PKCE recovery codes and hash links.
        const { error: initError } = await client.auth.initialize();
        if (initError) throw initError;
        const { data: { session }, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error(t('auth.recovery_invalid'));
        if (active) setReady(true);
      } catch (reason) {
        if (active) setError((reason as Error).message);
      } finally {
        if (active) setChecking(false);
      }
    }

    void prepareRecovery();
    return () => { active = false; };
  }, [t]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setError(null);
    if (password !== confirmation) {
      setError(t('auth.passwords_no_match'));
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase().auth.updateUser({ password });
      if (updateError) throw updateError;
      setUpdated(true);
      setPassword('');
      setConfirmation('');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-ma max-w-md py-16">
      <h1 className="text-2xl font-semibold">{t('auth.reset_title')}</h1>
      {checking ? (
        <p className="mt-4 text-slate-600" role="status">{t('auth.recovery_checking')}</p>
      ) : updated ? (
        <div className="mt-5">
          <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
            {t('auth.password_updated')}
          </p>
          <Link href="/account" className="btn mt-5 w-full">{t('auth.password_reset_continue')}</Link>
        </div>
      ) : ready ? (
        <form onSubmit={submit} className="mt-6 space-y-4" aria-busy={busy}>
          <p className="text-sm text-slate-600">{t('auth.reset_new_hint')}</p>
          <div>
            <label htmlFor="new-password" className="label">{t('auth.new_password')}</label>
            <input id="new-password" className="input" type="password" required minLength={8}
              autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div>
            <label htmlFor="confirm-password" className="label">{t('auth.confirm_password')}</label>
            <input id="confirm-password" className="input" type="password" required minLength={8}
              autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn w-full gap-2" disabled={busy} aria-busy={busy}>
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" aria-hidden="true" />}
            {busy ? t('auth.updating_password') : t('auth.update_password')}
          </button>
        </form>
      ) : (
        <div className="mt-5">
          <p role="alert" className="text-sm text-red-700">{error || t('auth.recovery_invalid')}</p>
          <Link href="/login" className="btn-outline mt-5 inline-flex">{t('auth.back_to_login')}</Link>
        </div>
      )}
    </div>
  );
}
