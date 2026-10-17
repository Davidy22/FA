'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { safeNextPath, takeAuthNext, takePendingReferral } from '@/lib/auth';

/**
 * OAuth redirect target. @supabase/ssr enables `detectSessionInUrl`, so the
 * client exchanges the PKCE code itself during initialize(). We wait for that
 * instead of exchanging twice, which would reject the second attempt.
 */
export default function AuthCallbackPage() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const next = safeNextPath(params.get('next') ?? takeAuthNext());
    // The provider can bounce back with ?error=access_denied&error_description=….
    const providerError = params.get('error_description') || params.get('error');

    async function finish() {
      if (providerError) throw new Error(providerError);
      const client = supabase();
      const { error: initError } = await client.auth.initialize();
      if (initError) throw initError;

      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error(t('auth.callback_missing_code'));

      const pendingReferral = takePendingReferral();
      if (pendingReferral && next !== '/account') {
        // Referral attribution is a bonus: never block a successful sign-in on it.
        const { error: claimError } = await client.rpc('claim_referral_code', {
          p_code: pendingReferral,
        });
        if (claimError) console.warn('Referral code was not applied:', claimError.message);
      }

      router.replace(next);
    }

    void finish().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [router, t]);

  return (
    <div className="container-ma py-16 max-w-md text-center">
      {error ? (
        <>
          <h1 className="text-2xl font-semibold">{t('auth.callback_failed_title')}</h1>
          <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>
          <Link href="/login" className="btn mt-6 inline-flex">{t('auth.back_to_login')}</Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{t('auth.callback_working_title')}</h1>
          <p className="mt-3 text-slate-600">{t('auth.callback_working')}</p>
          <div className="mx-auto mt-6 h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
        </>
      )}
    </div>
  );
}
