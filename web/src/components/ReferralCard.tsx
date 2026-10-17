'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

export function ReferralCard({ code }: { code?: string | null }) {
  const { t } = useTranslation('rewards');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  // The app renders client-side, so the browser's initial #hash jump can happen
  // before this card exists. Scroll once it mounts.
  useEffect(() => {
    if (window.location.hash !== '#referrals') return;
    const timer = window.setTimeout(() => {
      document.getElementById('referrals')?.scrollIntoView({ block: 'start' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function copyCode() {
    if (!code) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <section
      id="referrals"
      className="mt-8 scroll-mt-24 rounded-lg border border-slate-200 bg-white p-5"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-xl font-medium">{t('referral_title')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('referral_desc')}</p>
          {code ? (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t('referral_my_code')}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <strong className="break-all font-mono text-2xl tracking-wide">{code}</strong>
                <button type="button" className="btn-outline px-3 py-1.5 text-sm" onClick={() => void copyCode()}>
                  {copied ? t('referral_copied') : t('referral_copy')}
                </button>
              </div>
              {copyError && <p role="alert" className="mt-2 text-xs text-red-700">{t('referral_copy_error')}</p>}
            </div>
          ) : (
            <p className="mt-4 text-sm">
              <Link href="/login" className="text-brand-700 underline">{t('referral_signin_cta')}</Link>
            </p>
          )}
        </div>
        <div>
          <h3 className="font-medium">{t('referral_how_title')}</h3>
          <ol className="mt-2 space-y-2 text-sm text-slate-600">
            <li>1. {t('referral_step_share')}</li>
            <li>2. {t('referral_step_signup')}</li>
            <li>3. {t('referral_step_reward')}</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">{t('referral_terms')}</p>
        </div>
      </div>
    </section>
  );
}
