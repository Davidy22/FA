'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cleanLocalized, decimal, isoDateTime, localDateTime, localizedInput } from '@/lib/admin';
import { t_db } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { JobListing, Localized, Location } from '@/lib/types';
import {
  AdminFeedback, AdminQueryState, FormActions, LocalizedFields, useAdminAction, useAdminLanguage, useFormPanel,
} from './Shared';
import { FuzzySelect } from './FuzzySelect';

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship'] as const;

type Draft = {
  slug: string; title: Localized; summary: Localized; description: Localized;
  department: string; employmentType: JobListing['employment_type']; locationId: string;
  remote: boolean; published: boolean; sortOrder: string; closesAt: string;
};

function draft(job?: JobListing, nextOrder = 10): Draft {
  return {
    slug: job?.slug || '',
    title: localizedInput(job?.title),
    summary: localizedInput(job?.summary),
    description: localizedInput(job?.description),
    department: job?.department || '',
    employmentType: job?.employment_type || 'full_time',
    locationId: job?.location_id || '',
    remote: job?.is_remote ?? false,
    published: job?.is_published ?? false,
    sortOrder: String(job?.sort_order ?? nextOrder),
    closesAt: job?.closes_at ? localDateTime(job.closes_at).slice(0, 10) : '',
  };
}

function JobForm({ job, nextOrder, locations, onDone }: {
  job?: JobListing; nextOrder: number; locations: Location[]; onDone: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [form, setForm] = useState(() => draft(job, nextOrder));
  const [language, setLanguage] = useAdminLanguage();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const slug = form.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(slug)) throw new Error(t('admin:invalid_slug'));
      const payload = {
        slug,
        title: cleanLocalized(form.title, t('admin:fields.title'))!,
        summary: cleanLocalized(form.summary, t('admin:fields.summary'), true),
        description: cleanLocalized(form.description, t('admin:fields.description'), true),
        department: form.department.trim() || null,
        employment_type: form.employmentType,
        location_id: form.locationId || null,
        is_remote: form.remote,
        is_published: form.published,
        sort_order: decimal(form.sortOrder, t('admin:fields.sort_order'), -999, 999, true),
        // A date input is a whole day; closing at the end of it keeps the listing
        // visible through the day the admin picked.
        closes_at: form.closesAt ? isoDateTime(`${form.closesAt}T23:59`) : null,
      };
      const { data: { user } } = await supabase().auth.getUser();
      const result = job
        ? await supabase().from('job_listings').update(payload).eq('id', job.id).select().single()
        : await supabase().from('job_listings').insert({ ...payload, created_by: user?.id ?? null }).select().single();
      if (result.error) throw result.error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['careers_jobs'] }),
      ]);
    }, onDone);
  }

  return <form ref={panel} onSubmit={(event) => void submit(event)}
    className="mt-4 space-y-4 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h4 className="font-medium">{job ? t('admin:edit_job') : t('admin:add_job')}</h4>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">{t('admin:fields.slug')} *
        <input className="input mt-1" required value={form.slug} onChange={(event) => set('slug', event.target.value)} />
      </label>
      <label className="block text-sm">{t('admin:fields.department')}
        <input className="input mt-1" value={form.department} onChange={(event) => set('department', event.target.value)} />
      </label>
    </div>
    <LocalizedFields language={language} onLanguageChange={setLanguage} fields={[
      { label: t('admin:fields.title'), value: form.title, onChange: (value) => set('title', value) },
      { label: t('admin:fields.summary'), value: form.summary, onChange: (value) => set('summary', value), required: false },
      { label: t('admin:fields.description'), value: form.description, onChange: (value) => set('description', value), multiline: true, required: false },
    ]} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">{t('admin:fields.employment_type')}
        <select className="input mt-1" value={form.employmentType}
          onChange={(event) => set('employmentType', event.target.value as Draft['employmentType'])}>
          {EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{t(`admin:employment_type.${type}`)}</option>)}
        </select>
      </label>
      <label className="block text-sm">{t('admin:fields.location')}
        <div className="mt-1"><FuzzySelect value={form.locationId} onChange={(value) => set('locationId', value)} emptyLabel="—"
          searchLabel={t('admin:fields.location')} options={locations.map((location) => ({ value: location.id, label: location.name }))} /></div>
      </label>
      <label className="block text-sm">{t('admin:fields.sort_order')}
        <input className="input mt-1" type="number" step="1" value={form.sortOrder}
          onChange={(event) => set('sortOrder', event.target.value)} />
      </label>
      <label className="block text-sm">{t('admin:fields.closes_at')}
        <input className="input mt-1" type="date" value={form.closesAt}
          onChange={(event) => set('closesAt', event.target.value)} />
      </label>
    </div>
    <div className="flex flex-wrap gap-4 text-sm">
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={form.remote} onChange={(event) => set('remote', event.target.checked)} />
        {t('admin:fields.remote')}
      </label>
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={form.published} onChange={(event) => set('published', event.target.checked)} />
        {t('admin:fields.published')}
      </label>
    </div>
    <p className="text-xs text-slate-600">{t('admin:job_visibility_hint')}</p>
    <AdminFeedback error={action.error} notice={action.notice} />
    <FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

export function AdminJobs() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editing, setEditing] = useState<string | null>(null);

  const jobsQuery = useQuery<JobListing[]>({
    queryKey: ['admin_jobs'],
    queryFn: async () => {
      const { data, error } = await supabase().from('job_listings')
        .select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as JobListing[];
    },
  });
  const locationsQuery = useQuery<Location[]>({
    queryKey: ['admin_locations'],
    queryFn: async () => {
      const { data, error } = await supabase().from('locations').select('*').order('name');
      if (error) throw error;
      return (data || []) as Location[];
    },
  });

  const jobs = jobsQuery.data || [];
  const locations = locationsQuery.data || [];

  async function remove(job: JobListing) {
    if (!window.confirm(t('admin:delete_job_confirm', { title: t_db(job.title, locale) }))) return;
    await action.run(async () => {
      const { error } = await supabase().from('job_listings').delete().eq('id', job.id);
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['careers_jobs'] }),
      ]);
    });
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-medium">{t('admin:jobs')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('admin:jobs_help')}</p>
      </div>
      <button type="button" className="btn text-sm" onClick={() => setEditing('new')}>{t('admin:add_job')}</button>
    </div>
    <AdminFeedback error={action.error} notice={action.notice} />
    {editing && <JobForm key={editing} job={jobs.find((job) => job.id === editing)}
      nextOrder={(jobs.at(-1)?.sort_order ?? 0) + 10} locations={locations}
      onDone={() => setEditing(null)} />}
    <AdminQueryState loading={jobsQuery.isPending || locationsQuery.isPending} error={jobsQuery.error || locationsQuery.error} />
    {jobs.length === 0 && !jobsQuery.isPending && <p className="text-slate-500">{t('admin:no_jobs')}</p>}
    <ul className="mt-3 divide-y rounded border">
      {jobs.map((job) => <li key={job.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
        <div>
          <p className="font-medium">{t_db(job.title, locale)} <span className="font-mono text-xs text-slate-500">{job.slug}</span></p>
          <p className="text-slate-600">
            {t(`admin:employment_type.${job.employment_type}`)}
            {job.department ? ` · ${job.department}` : ''}
            {job.is_remote ? ` · ${t('admin:fields.remote')}` : ''}
            {job.closes_at ? ` · ${t('admin:closes_on', { date: new Date(job.closes_at).toLocaleDateString(locale) })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge">{job.is_published ? t('admin:fields.published') : t('admin:draft')}</span>
          <button type="button" className="text-brand-700 underline" onClick={() => setEditing(job.id)}>{t('common:edit')}</button>
          <button type="button" className="text-red-700 underline" disabled={action.busy}
            onClick={() => void remove(job)}>{t('common:delete')}</button>
        </div>
      </li>)}
    </ul>
  </div>;
}
