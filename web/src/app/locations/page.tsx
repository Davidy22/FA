'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLocation } from '@/store/location';
import { useTranslation } from 'react-i18next';
import type { Location } from '@/lib/types';

export default function LocationsPage() {
  const { t } = useTranslation('common');
  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations_all'],
    queryFn: async () => {
      const { data } = await supabase().from('locations').select('*').eq('is_active', true).order('name');
      return data || [];
    },
  });
  const setLocation = useLocation((s) => s.setLocation);
  const selected = useLocation((s) => s.selectedLocationId);
  return (
    <div className="container-fa py-10 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">{t('location.title')}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {locations?.map((l) => (
          <button key={l.id} onClick={() => setLocation(l.id)}
            className={'text-left rounded-lg border p-4 hover:border-brand-600 ' + (selected===l.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200')}>
            <p className="font-semibold">{l.name}</p>
            <p className="text-sm text-slate-600">{l.address}</p>
            <p className="text-sm text-slate-500 mt-1">{l.phone}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
