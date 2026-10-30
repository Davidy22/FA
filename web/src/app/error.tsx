'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

/**
 * Route-level error boundary. Without one, a single thrown render error blanked
 * the whole SPA — the page component unmounts and the visitor sees white, with
 * no way back except a manual reload.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation(['common', 'errors']);
  useEffect(() => { console.error('Route error', error); }, [error]);

  return (
    <div className="container-ma py-16 max-w-md text-center">
      <h1 className="text-2xl font-semibold">{t('errors:generic')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('common:error_retry_hint')}</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className="btn" onClick={reset}>{t('common:retry')}</button>
        {/* next/link keeps the deployment prefix (`/FA/` on Pages). */}
        <Link className="btn-outline" href="/">{t('common:back_home')}</Link>
      </div>
    </div>
  );
}
