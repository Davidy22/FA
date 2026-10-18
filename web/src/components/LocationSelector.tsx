'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLocations } from '@/hooks/useLocations';
import { useLocation } from '@/store/location';

/** The header opens the full searchable/map picker; it never changes a location in place. */
export function LocationSelector() {
  const { t } = useTranslation('common');
  const { data: locations } = useLocations();
  const selectedId = useLocation((s) => s.selectedLocationId);

  // LocationSync selects the sole active location automatically.
  if (!locations || locations.length <= 1) return null;

  const selected = locations.find((location) => location.id === selectedId);
  return (
    <Link
      href="/locations"
      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md px-2 py-1 text-sm text-brand-700 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
      aria-label={`${t('location.title')}: ${selected?.name || t('location.none_selected')}`}
    >
      <span aria-hidden="true">📍</span>
      <span className="truncate">{selected?.name || t('location.none_selected')}</span>
    </Link>
  );
}
