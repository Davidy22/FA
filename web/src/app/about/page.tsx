'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Location } from '@/lib/types';

export default function AboutPage() {
  const { t } = useTranslation(['pages', 'common']);

  const { data: locations } = useQuery<Location[]>({
    queryKey: ['active_locations'],
    queryFn: async () => {
      const { data } = await supabase().from('locations').select('*')
        .eq('is_active', true).order('name');
      return (data || []) as Location[];
    },
  });

  const values = [
    { title: t('pages:about.value_local_title'), body: t('pages:about.value_local') },
    { title: t('pages:about.value_craft_title'), body: t('pages:about.value_craft') },
    { title: t('pages:about.value_custom_title'), body: t('pages:about.value_custom') },
  ];

  return (
    <div className="container-ma py-10 max-w-3xl">
      <h1 className="text-3xl font-semibold">{t('pages:about.title')}</h1>
      <p className="mt-3 text-lg text-slate-700">{t('pages:about.lede')}</p>

      <section className="mt-8">
        <h2 className="text-xl font-medium">{t('pages:about.story_title')}</h2>
        <p className="mt-2 text-slate-700">{t('pages:about.story')}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-medium">{t('pages:about.values_title')}</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          {values.map((value) => (
            <div key={value.title} className="rounded-lg border border-slate-200 p-4">
              <dt className="font-medium">{value.title}</dt>
              <dd className="mt-1 text-sm text-slate-600">{value.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link href="/catalog" className="btn">{t('pages:about.cta_catalog')}</Link>
        <Link href="/quote" className="btn-outline">{t('pages:about.cta_quote')}</Link>
        <Link href="/contact" className="btn-outline">{t('pages:about.cta_contact')}</Link>
      </div>
    </div>
  );
}
