'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';

/** Referral details now live with points on /rewards; keep old links working. */
export default function ReferralsPage() {
  const router = useRouter();
  const { t } = useTranslation('rewards');

  useEffect(() => {
    router.replace('/rewards#referrals');
  }, [router]);

  return (
    <div className="container-ma max-w-2xl py-10">
      <p className="text-slate-600">{t('referral_redirecting')}</p>
      <Link href="/rewards#referrals" className="mt-3 inline-block text-brand-700 underline">
        {t('back_to_rewards')}
      </Link>
    </div>
  );
}
