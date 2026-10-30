'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation('common');

  return (
    <div className="container-ma py-20 text-center">
      <h1 className="text-2xl font-semibold">{t('not_found_title')}</h1>
      <Link href="/" className="btn mt-6 inline-block">{t('back_home')}</Link>
    </div>
  );
}
