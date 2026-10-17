'use client';
import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';
import { useLocations } from '@/hooks/useLocations';
import { useLocation } from '@/store/location';
import {
  directionsUrl,
  filterLocations,
  hasCoordinates,
  mappableLocations,
} from '@/lib/locations';

const LocationsMap = dynamic(
  () => import('@/components/LocationsMap').then((mod) => mod.LocationsMap),
  {
    ssr: false,
    loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">…</div>,
  }
);

export default function LocationsPage() {
  const { t } = useTranslation('common');
  const { data: locations, isLoading } = useLocations();
  const selectedId = useLocation((s) => s.selectedLocationId);
  const setLocation = useLocation((s) => s.setLocation);
  const [query, setQuery] = useState('');
  const select = useCallback((id: string) => setLocation(id), [setLocation]);

  const filtered = useMemo(
    () => (locations ? filterLocations(locations, query) : []),
    [locations, query]
  );
  const mappable = useMemo(() => mappableLocations(filtered), [filtered]);

  if (isLoading) {
    return <div className="container-ma py-10">{t('loading')}</div>;
  }
  if (!locations) {
    return (
      <div className="container-ma max-w-3xl py-10">
        <h1 className="text-2xl font-semibold">{t('location.title')}</h1>
        <p className="mt-3 text-slate-600">{t('location.load_error')}</p>
      </div>
    );
  }

  // Zero or one location: skip the whole picker experience (no prompt, search, or map).
  if (locations.length === 0) {
    return (
      <div className="container-ma max-w-3xl py-10">
        <h1 className="text-2xl font-semibold">{t('location.title')}</h1>
        <p className="mt-3 text-slate-600">{t('location.no_locations')}</p>
      </div>
    );
  }

  if (locations.length === 1) {
    const only = locations[0];
    const directions = directionsUrl(only);
    return (
      <div className="container-ma max-w-3xl py-10">
        <h1 className="text-2xl font-semibold">{t('location.title')}</h1>
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-lg font-semibold">{only.name}</p>
          {only.address && <p className="mt-1 text-slate-600">{only.address}</p>}
          {only.phone && <p className="mt-1 text-sm text-slate-500">{only.phone}</p>}
          <p className="mt-4 text-sm text-slate-500">{t('location.single_location')}</p>
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-brand-700 underline"
            >
              {t('location.directions')}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container-ma py-10">
      <h1 className="text-2xl font-semibold">{t('location.title')}</h1>
      <p className="mt-1 text-slate-600">{t('location.subtitle')}</p>

      <div className="mt-6 max-w-xl">
        <label htmlFor="location-search" className="label">{t('location.search_label')}</label>
        <input
          id="location-search"
          type="search"
          className="input"
          placeholder={t('location.search_placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p aria-live="polite" className="mt-2 text-sm text-slate-500">
          {t('location.results_count', { count: filtered.length, total: locations.length })}
        </p>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="order-2 min-w-0 lg:order-1">
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-slate-500">
              {t('location.no_results', { query })}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {filtered.map((location) => {
                const selected = location.id === selectedId;
                const directions = directionsUrl(location);
                return (
                  <div
                    key={location.id}
                    className={
                      'rounded-lg border bg-white p-4 ' +
                      (selected ? 'border-brand-600 ring-1 ring-brand-600' : 'border-slate-200')
                    }
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      aria-pressed={selected}
                      onClick={() => select(location.id)}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{location.name}</span>
                        <span className="whitespace-nowrap text-xs font-medium text-brand-700">
                          {selected ? t('location.selected_badge') : t('location.select')}
                        </span>
                      </span>
                      {location.address && <span className="mt-1 block text-sm text-slate-600">{location.address}</span>}
                      {location.phone && <span className="mt-1 block text-sm text-slate-500">{location.phone}</span>}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      {directions && (
                        <a
                          href={directions}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-700 underline"
                        >
                          {t('location.directions')}
                        </a>
                      )}
                      {!hasCoordinates(location) && (
                        <span className="text-slate-400">{t('location.no_map_pin')}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="order-1 min-w-0 lg:order-2">
          <div className="relative z-0 h-72 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 sm:h-96 lg:sticky lg:top-24 lg:h-[520px]">
            {mappable.length > 0 ? (
              <LocationsMap locations={mappable} selectedId={selectedId} onSelect={select} />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
                {filtered.length === 0
                  ? t('location.no_results', { query })
                  : t('location.map_unavailable')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
