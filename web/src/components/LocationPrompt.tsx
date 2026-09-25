'use client';
import { useTranslation } from 'react-i18next';
import { useLocation } from '@/store/location';
import Link from 'next/link';

export function LocationPrompt() {
  const { t } = useTranslation('common');
  const selectedLocationId = useLocation((s) => s.selectedLocationId);
  if (selectedLocationId) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="container-fa py-2 flex items-center gap-3">
        <span aria-hidden>⚠️</span>
        <span>{t('location.prompt')}</span>
        <Link href="/locations" className="ml-auto underline font-medium">{t('location.title')} →</Link>
      </div>
    </div>
  );
}
