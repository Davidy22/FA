'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Payout } from '@/lib/types';
import { ADMIN_PAGE_SIZE, AdminFeedback, AdminPagination, AdminQueryState, useAdminAction } from './Shared';

type PayoutWithCreator = Payout & { creator: { email: string; display_name: string | null } | null };

export function AdminPayouts() {
  const { t } = useTranslation('admin');
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [reference, setReference] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(0);
  const { data, isPending, error } = useQuery<PayoutWithCreator[]>({
    queryKey: ['admin_payouts', status, page],
    queryFn: async () => {
      let request = supabase().from('payouts').select('*,creator:profiles!payouts_creator_id_fkey(email,display_name)')
        .order('created_at', { ascending: false }).order('id', { ascending: true })
        .range(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE - 1);
      if (status === 'open') request = request.in('status', ['requested', 'processing']);
      else if (status !== 'all') request = request.eq('status', status);
      const { data, error } = await request;
      if (error) throw error;
      return (data || []) as PayoutWithCreator[];
    },
  });

  async function decide(payout: Payout, next: 'processing' | 'paid' | 'rejected') {
    await action.run(async () => {
      if (next === 'paid' && !reference[payout.id]?.trim()) throw new Error(t('reference_required'));
      const { error } = await supabase().rpc('admin_decide_payout', {
        p_payout_id: payout.id, p_status: next, p_reference: reference[payout.id]?.trim() || null,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['admin_payouts'] });
    });
  }

  return <>
    <h2 className="text-xl font-medium">{t('payouts')}</h2>
    <p className="mt-1 text-sm text-slate-600">{t('payouts_help')}</p>
    <div className="mt-4 flex flex-wrap gap-2">{['open', 'all', 'paid', 'rejected'].map((value) => <button type="button" key={value}
      aria-pressed={status === value} onClick={() => { setStatus(value); setPage(0); }} className={'rounded-full px-3 py-1 text-sm ' + (value === status ? 'bg-brand-600 text-white' : 'bg-slate-100')}>
      {t(`payout_filter.${value}`)}</button>)}</div>
    <AdminFeedback error={action.error} notice={action.notice} />
    <AdminQueryState loading={isPending} error={error} />
    {data?.length === 0 && <p className="mt-4 text-slate-500">{t('no_payouts')}</p>}
    <div className="mt-4 space-y-3">{data?.map((payout) => <article key={payout.id} className="rounded-lg border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><div>
        <p className="font-medium">{payout.creator?.display_name || payout.creator?.email || payout.creator_id}</p>
        <p className="text-slate-600">{payout.creator?.email} · {t(`payout_status.${payout.status}`)} · {payout.method}</p>
        <p className="text-xs text-slate-500">{new Date(payout.created_at).toLocaleString(locale)}{payout.reference ? ` · ${payout.reference}` : ''}</p>
      </div><strong>{formatMoney(Number(payout.amount), locale)}</strong></div>
      {['requested', 'processing'].includes(payout.status) && <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="w-full max-w-sm text-xs">{t('fields.payout_reference')}
          <input className="input mt-1 text-sm" value={reference[payout.id] || ''}
            onChange={(event) => setReference((previous) => ({ ...previous, [payout.id]: event.target.value }))} />
        </label>
        {payout.status === 'requested' && <button className="btn-outline text-sm" disabled={action.busy} onClick={() => void decide(payout, 'processing')}>{t('mark_processing')}</button>}
        <button className="btn text-sm" disabled={action.busy} onClick={() => void decide(payout, 'paid')}>{t('mark_paid')}</button>
        <button className="btn-outline text-sm text-red-700" disabled={action.busy}
          onClick={() => { if (window.confirm(t('reject_payout_confirm'))) void decide(payout, 'rejected'); }}>{t('reject')}</button>
      </div>}
    </article>)}</div>
    <AdminPagination page={page} hasNext={data?.length === ADMIN_PAGE_SIZE} onPageChange={setPage} />
  </>;
}
