'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/store/locale';
import { t_db, formatMoney } from '@/lib/format';
import { useState } from 'react';
import Link from 'next/link';
import type { ModelSubmission, Profile } from '@/lib/types';

export default function CreatorDashboard() {
  const { t } = useTranslation(['common','creator']);
  const locale = useLocale((s) => s.locale);
  const [agreed, setAgreed] = useState(false);
  const { data: profile } = useQuery<Profile|null>({
    queryKey: ['me_creator'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });

  const { data: submissions } = useQuery<ModelSubmission[]>({
    queryKey: ['my_submissions'],
    enabled: !!profile?.is_creator,
    queryFn: async () => {
      const { data } = await supabase().from('model_submissions').select('*').order('created_at',{ascending:false});
      return data || [];
    },
  });

  const { data: earnings } = useQuery<{balance:number; sales:number}>({
    queryKey: ['my_earnings'],
    enabled: !!profile?.is_creator,
    queryFn: async () => {
      const { data: rows } = await supabase().from('creator_earnings').select('amount');
      const balance = (rows||[]).reduce((s,r) => s + Number(r.amount),0);
      const sales = (rows||[]).filter((r:any)=>r.type==='sale').length;
      return { balance, sales };
    },
  });

  async function acceptAgreement() {
    const { error } = await supabase().from('profiles').update({
      is_creator: true,
      creator_agreement_version: '1.0',
      creator_agreed_at: new Date().toISOString(),
    }).eq('id', profile!.id);
    if (!error) window.location.reload();
  }

  async function requestPayout() {
    const amount = earnings?.balance ?? 0;
    const { error } = await supabase().rpc('request_payout', { p_amount: amount });
    if (error) alert(error.message);
    else alert('Payout requested');
  }

  if (!profile) return <div className="container-fa py-10">Please sign in.</div>;
  if (!profile.is_creator || !agreed) {
    return (
      <div className="container-fa py-16 max-w-xl">
        <h1 className="text-2xl font-semibold mb-3">{t('creator:title')}</h1>
        <p className="text-slate-700">{t('creator:agreement_prompt')}</p>
        <p className="mt-3 text-sm text-slate-500">
          By submitting designs you grant Fab Anything a license to print and sell them, with an 85% revenue share to you.
        </p>
        <button className="btn mt-6" onClick={acceptAgreement}>{t('creator:agreement')} — {t('common:confirm')}</button>
      </div>
    );
  }

  return (
    <div className="container-fa py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('creator:title')}</h1>
        <Link href="/creator/submit" className="btn">{t('creator:submit')}</Link>
      </div>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-slate-500">{t('creator:balance')}</p>
          <p className="text-2xl font-semibold">{formatMoney(earnings?.balance||0, locale)}</p>
          <button className="btn-outline mt-3 text-sm" onClick={requestPayout}>{t('creator:request_payout')}</button>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-slate-500">{t('creator:sales_count')}</p>
          <p className="text-2xl font-semibold">{earnings?.sales ?? 0}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-slate-500">{t('creator:my_submissions')}</p>
          <p className="text-2xl font-semibold">{submissions?.length ?? 0}</p>
        </div>
      </div>
      <h2 className="mt-8 text-xl font-medium">{t('creator:my_submissions')}</h2>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="py-2">Title</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          {(submissions||[]).map((s) => (
            <tr key={s.id} className="border-t">
              <td className="py-2">{t_db(s.title, locale)}</td>
              <td><span className="badge">{t(`creator:status.${s.status}`)}</span></td>
              <td className="text-slate-600">{s.review_notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
