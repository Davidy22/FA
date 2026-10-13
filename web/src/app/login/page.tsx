'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [referral, setReferral] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const fn = mode === 'signin' ? supabase().auth.signInWithPassword : supabase().auth.signUp;
      const { error } = await fn({ email, password, ...(mode === 'signup' ? { options: { data: { referral_code: referral.trim().toUpperCase() } } } : {}) });
      if (error) throw error;
      router.push('/');
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="container-ma py-16 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">{mode === 'signin' ? t('nav.login') : t('nav.register')}</h1>
      <form onSubmit={submit} className="space-y-3">
        <input required type="email" className="input" placeholder="email@example.com" value={email} onChange={(e)=>setEmail(e.target.value)} />
        <input required type="password" className="input" placeholder="password" minLength={8} value={password} onChange={(e)=>setPassword(e.target.value)} />
        {mode === 'signup' && <div><label htmlFor="referral" className="label">Referral code (optional)</label><input id="referral" className="input" maxLength={12} value={referral} onChange={e => setReferral(e.target.value)} /><Link href="/referrals" className="text-sm text-brand-700 underline">How referrals work</Link></div>}
        {error && <p className="text-red-700 text-sm">{error}</p>}
        <button type="submit" className="btn w-full" disabled={busy}>
          {mode === 'signin' ? t('nav.login') : t('nav.register')}
        </button>
        <button type="button" className="btn-outline w-full"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? t('nav.register') : t('nav.login')}
        </button>
      </form>
    </div>
  );
}
