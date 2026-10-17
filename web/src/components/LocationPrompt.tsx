'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLocations } from '@/hooks/useLocations';
import { useLocation } from '@/store/location';

export function LocationPrompt() {
  const { t } = useTranslation('common');
  const { data: locations } = useLocations();
  const selectedLocationId = useLocation((s) => s.selectedLocationId);

  // No prompt when there is nothing to pick, and no flash while locations load.
  if (!locations || locations.length <= 1 || selectedLocationId) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 text-sm text-amber-900">
      <div className="container-ma flex items-center gap-3 py-2">
        <span aria-hidden>⚠️</span>
        <span>{t('location.prompt')}</span>
        <Link href="/locations" className="ml-auto font-medium underline">{t('location.title')} →</Link>
      </div>
    </div>
  );
}
