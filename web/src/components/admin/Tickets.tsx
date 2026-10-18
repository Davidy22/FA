'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Location, Ticket } from '@/lib/types';
import { ADMIN_PAGE_SIZE, AdminPagination, AdminQueryState } from './Shared';

export function AdminTickets() {
  const { t } = useTranslation(['admin', 'tickets']);
  const locale = useLocale((state) => state.locale);
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(0);
  const { data, isPending, error } = useQuery<(Ticket & { location: Pick<Location, 'name'> | null })[]>({
    queryKey: ['admin_tickets', status, page],
    queryFn: async () => {
      let request = supabase().from('tickets').select('*,location:locations(name)')
        .order('updated_at', { ascending: false })
        .range(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE - 1);
      if (status !== 'all') request = request.eq('status', status);
      const { data, error } = await request;
      if (error) throw error;
      return (data || []) as (Ticket & { location: Pick<Location, 'name'> | null })[];
    },
  });

  return <>
    <h2 className="text-xl font-medium">{t('admin:tickets')}</h2>
    <p className="mt-1 text-sm text-slate-600">{t('admin:tickets_help')}</p>
    <div className="mt-4 flex flex-wrap gap-2">{['all', 'open', 'answered', 'resolved'].map((value) =>
      <button key={value} type="button" onClick={() => { setStatus(value); setPage(0); }} aria-pressed={status === value}
        className={'rounded-full px-3 py-1 text-sm ' + (status === value ? 'bg-brand-600 text-white' : 'bg-slate-100')}>
        {value === 'all' ? t('admin:all') : t(`tickets:status.${value}`)}
      </button>)}</div>
    <AdminQueryState loading={isPending} error={error} />
    {data?.length === 0 && <p className="mt-4 text-slate-500">{t('admin:no_tickets')}</p>}
    <div className="mt-4 space-y-2">{data?.map((ticket) => <div key={ticket.id} className="rounded border p-3 text-sm">
      <Link href={`/employee/tickets?id=${ticket.id}`} className="font-medium text-brand-700 underline">{ticket.subject}</Link>
      <p className="text-slate-600">{ticket.customer_name || ticket.customer_email} · {ticket.location?.name || '—'} · {t(`tickets:status.${ticket.status}`)}</p>
      <p className="text-xs text-slate-500">{new Date(ticket.updated_at).toLocaleString(locale)}</p>
    </div>)}</div>
    <AdminPagination page={page} hasNext={data?.length === ADMIN_PAGE_SIZE} onPageChange={setPage} />
  </>;
}
