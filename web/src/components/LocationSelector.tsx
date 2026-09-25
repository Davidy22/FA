'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLocation } from '@/store/location';
import { useTranslation } from 'react-i18next';
import type { Location } from '@/lib/types';

export function LocationSelector() {
  const { t } = useTranslation('common');
  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase().from('locations').select('*').eq('is_active', true).order('name');
      return data || [];
    },
  });
  const selectedId = useLocation((s) => s.selectedLocationId);
  const setLocation = useLocation((s) => s.setLocation);
  const selected = locations?.find((l) => l.id === selectedId);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span aria-hidden>📍</span>
      <select
        aria-label={t('location.title')}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm max-w-[200px]"
        value={selectedId || ''}
        onChange={(e) => setLocation(e.target.value || null)}
      >
        <option value="">{t('location.none_selected')}</option>
        {locations?.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
