'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { t_db } from '@/lib/format';
import { useLocale } from '@/store/locale';
import { useState } from 'react';
import type { ModelSubmission, Profile } from '@/lib/types';

export default function AdminPage() {
  const { t } = useTranslation(['common','admin','creator']);
  const locale = useLocale((s) => s.locale);
  const [tab, setTab] = useState<'submissions'|'products'|'users'|'payouts'|'settings'>('submissions');

  const { data: profile } = useQuery<Profile|null>({
    queryKey: ['me_admin'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });

  const { data: submissions, refetch } = useQuery<ModelSubmission[]>({
    queryKey: ['submissions_queue'],
    enabled: profile?.role === 'admin',
    queryFn: async () => (await supabase().from('model_submissions')
      .select('*').in('status', ['pending_review','changes_requested']).order('submitted_at')).data || [],
  });

  async function decide(id: string, action: 'approve'|'reject'|'changes_requested', notes='') {
    const { error } = await supabase().functions.invoke('submissions-decide', {
      body: { action, submission_id: id, notes }
    });
    if (!error) refetch();
    else alert(error.message);
  }

  if (!profile || profile.role !== 'admin') {
    return <div className="container-fa py-10">Admin only.</div>;
  }

  return (
    <div className="container-fa py-10">
      <h1 className="text-2xl font-semibold">{t('admin:title')}</h1>
      <div className="mt-4 flex gap-2 flex-wrap">
        {(['submissions','products','users','payouts','settings'] as const).map(k => (
          <button key={k} onClick={()=>setTab(k)}
            className={'px-3 py-1 rounded-full text-sm ' + (tab===k?'bg-brand-600 text-white':'bg-slate-100')}>
            {t(`admin:${k}`)}
          </button>
        ))}
      </div>

      {tab === 'submissions' && (
        <div className="mt-6 space-y-3">
          {(submissions||[]).map((s) => (
            <div key={s.id} className="rounded border p-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{t_db(s.title, locale)}</p>
                <p className="text-sm text-slate-600">{t(`creator:status.${s.status}`)} — {s.category}</p>
                {s.review_notes && <p className="text-sm mt-1">Note: {s.review_notes}</p>}
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={()=>decide(s.id,'approve')}>{t('admin:approve')}</button>
                <button className="btn-outline" onClick={()=>decide(s.id,'changes_requested', prompt('Notes')||'')}>{t('admin:request_changes')}</button>
                <button className="btn-outline text-red-700" onClick={()=>decide(s.id,'reject', prompt('Reason')||'')}>{t('admin:reject')}</button>
              </div>
            </div>
          ))}
          {(submissions||[]).length === 0 && <p className="text-slate-500">Nothing in queue.</p>}
        </div>
      )}

      {tab === 'products' && (
        <p className="mt-6 text-slate-600">Product editor (CRUD): coming soon in this MVP. Use Supabase Studio or SQL for now.</p>
      )}
      {tab === 'users' && (
        <p className="mt-6 text-slate-600">User management UI: coming soon. Use create-staff Edge Function to invite staff.</p>
      )}
      {tab === 'payouts' && (
        <p className="mt-6 text-slate-600">Payouts queue: admin marks manual payouts as paid (SQL).</p>
      )}
      {tab === 'settings' && (
        <p className="mt-6 text-slate-600">Platform settings are managed via the platform_settings table.</p>
      )}
    </div>
  );
}
