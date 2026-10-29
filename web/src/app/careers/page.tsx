'use client';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import { t_db } from '@/lib/format';
import type { JobListing, Location } from '@/lib/types';

const CAREERS_EMAIL = 'careers@makeanyth.ing';

export default function CareersPage() {
  const { t } = useTranslation(['pages', 'common']);
  const locale = useLocale((state) => state.locale);

  const { data: jobs } = useQuery<(JobListing & { location?: Pick<Location, 'name'> | null })[]>({
    queryKey: ['careers_jobs'],
    queryFn: async () => {
      const { data } = await supabase().from('job_listings')
        .select('*, location:locations(name)')
        .eq('is_published', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      const now = Date.now();
      return (data || []).filter((job) => !job.closes_at || new Date(job.closes_at).getTime() > now);
    },
  });

  return (
    <div className="container-ma py-10 max-w-3xl">
      <h1 className="text-3xl font-semibold">{t('pages:careers.title')}</h1>
      <p className="mt-2 text-slate-700">{t('pages:careers.lede')}</p>

      <h2 className="mt-8 text-xl font-medium">{t('pages:careers.open_roles')}</h2>
      {!jobs?.length ? (
        <div className="mt-3 rounded border border-slate-200 p-4 text-sm">
          <p className="font-medium">{t('pages:careers.no_roles')}</p>
          <p className="mt-1 text-slate-600">{t('pages:careers.no_roles_hint')}</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {jobs.map((job) => <li key={job.id} className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-lg font-medium">{t_db(job.title, locale)}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {t(`pages:careers.employment_type.${job.employment_type}`)}
              {job.department ? ` · ${job.department}` : ''}
              {job.location?.name ? ` · ${job.location.name}` : ''}
              {job.is_remote ? ` · ${t('pages:careers.remote')}` : ''}
            </p>
            {t_db(job.summary, locale) && <p className="mt-2 text-slate-700">{t_db(job.summary, locale)}</p>}
            {t_db(job.description, locale) && (
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{t_db(job.description, locale)}</p>
            )}
            {job.closes_at && <p className="mt-2 text-xs text-slate-500">
              {t('pages:careers.closes', { date: new Date(job.closes_at).toLocaleDateString(locale) })}
            </p>}
          </li>)}
        </ul>
      )}

      <section className="mt-9 rounded-lg border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-medium">{t('pages:careers.apply')}</h2>
        <p className="mt-1 text-sm text-slate-700">{t('pages:careers.apply_body')}</p>
        <a className="mt-2 inline-block text-brand-700 underline" href={`mailto:${CAREERS_EMAIL}`}>{CAREERS_EMAIL}</a>
      </section>
    </div>
  );
}
