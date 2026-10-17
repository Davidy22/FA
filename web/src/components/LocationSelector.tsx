'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLocations } from '@/hooks/useLocations';
import { useLocation } from '@/store/location';

export function LocationSelector() {
  const { t } = useTranslation('common');
  const { data: locations } = useLocations();
  const selectedId = useLocation((s) => s.selectedLocationId);
  const setLocation = useLocation((s) => s.setLocation);

  // With zero or one location there is nothing to choose; LocationSync picks the only one.
  if (!locations || locations.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span aria-hidden>📍</span>
      <select
        aria-label={t('location.title')}
        className="max-w-[200px] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        value={selectedId || ''}
        onChange={(e) => setLocation(e.target.value || null)}
      >
        <option value="">{t('location.none_selected')}</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>{location.name}</option>
        ))}
      </select>
      <Link href="/locations" className="whitespace-nowrap text-xs text-brand-700 underline">
        {t('location.view_map')}
      </Link>
    </div>
  );
}
