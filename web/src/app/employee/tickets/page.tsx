'use client';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import { formatMoney } from '@/lib/format';
import { TicketThread } from '@/components/TicketThread';
import type {
  Location, Profile, Ticket, TicketAttachment, TicketMessage, TicketQuote,
} from '@/lib/types';

type TicketDetail = Ticket & {
  customer_name: string | null;
  customer_email: string | null;
  messages: TicketMessage[];
  attachments: TicketAttachment[];
  quotes: TicketQuote[];
  location: Location | null;
};

const STATUS_ORDER = ['open', 'answered', 'resolved'] as const;

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800',
    answered: 'bg-green-100 text-green-800',
    resolved: 'bg-slate-100 text-slate-600',
    pending: 'bg-amber-100 text-amber-800',
    accepted: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-slate-100 text-slate-500',
    ordered: 'bg-brand-100 text-brand-800',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? 'bg-slate-100'}`}>
      {t(`status.${status}`)}
    </span>
  );
}

function TicketDetail({ id, profile }: { id: string; profile: Profile }) {
  const { t } = useTranslation(['tickets', 'common']);
  const locale = useLocale((s) => s.locale);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: ticket, refetch } = useQuery<TicketDetail | null>({
    queryKey: ['emp_ticket', id],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from('tickets')
        .select(`
          *,
          messages:ticket_messages(*),
          attachments:ticket_attachments(*),
          quotes:ticket_quotes(*),
          location:locations(id, name, address)
        `)
        .eq('id', id)
        .single();
      if (error) return null;
      return data as unknown as TicketDetail;
    },
  });

  async function refresh() {
    await refetch();
    void queryClient.invalidateQueries({ queryKey: ['location_tickets'] });
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    const body = reply.trim();
    if (!body) return;
    setBusy(true); setError(null);
    try {
      const { error: mErr } = await supabase().from('ticket_messages').insert({
        ticket_id: id,
        author_id: profile.id,
        author_name: profile.display_name,
        author_role: profile.role,
        body,
      });
      if (mErr) throw mErr;
      await supabase().from('tickets').update({ status: 'answered' }).eq('id', id);
      setReply('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendQuote(e: React.FormEvent) {
    e.preventDefault();
    const desc = description.trim();
    const price = parseFloat(unitPrice);
    if (!desc) { setError(t('tickets:error_description_required')); return; }
    if (!Number.isFinite(price) || price < 0) { setError(t('tickets:error_price_invalid')); return; }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      setError(t('tickets:error_quantity_invalid'));
      return;
    }
    setBusy(true); setError(null);
    try {
      const { error: qErr } = await supabase().from('ticket_quotes').insert({
        ticket_id: id,
        staff_id: profile.id,
        staff_name: profile.display_name,
        description: desc,
        unit_price: price,
        quantity,
      });
      if (qErr) throw qErr;
      await supabase().from('tickets').update({ status: 'answered' }).eq('id', id);
      setDescription(''); setUnitPrice(''); setQuantity(1);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: 'open' | 'answered' | 'resolved') {
    setBusy(true); setError(null);
    try {
      const { error } = await supabase().from('tickets').update({ status }).eq('id', id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ticket) return <p className="py-10 text-slate-500">{t('tickets:not_found')}</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{ticket.subject}</h2>
          <StatusBadge status={ticket.status} t={t} />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {ticket.customer_name || ticket.customer_email || t('tickets:customer')}
          {ticket.location ? ` · ${ticket.location.name}` : ''}
          {' · '}{new Date(ticket.created_at).toLocaleString(locale)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ticket.status !== 'resolved' ? (
            <button className="btn-outline text-sm" disabled={busy} onClick={() => void setStatus('resolved')}>
              {t('tickets:mark_resolved')}
            </button>
          ) : (
            <button className="btn-outline text-sm" disabled={busy} onClick={() => void setStatus('open')}>
              {t('tickets:reopen')}
            </button>
          )}
        </div>
      </div>

      <TicketThread
        messages={ticket.messages ?? []}
        attachments={ticket.attachments ?? []}
        ticketId={ticket.id}
      />

      {(ticket.quotes ?? []).length > 0 && (
        <section>
          <h3 className="text-lg font-medium">{t('tickets:quotes')}</h3>
          <div className="mt-2 space-y-3">
            {(ticket.quotes ?? []).map((q) => (
              <div key={q.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm">{q.description}</p>
                  <StatusBadge status={q.status} t={t} />
                </div>
                <p className="mt-1 text-sm">
                  {formatMoney(q.unit_price, locale)} × {q.quantity} ={' '}
                  <strong>{formatMoney(q.unit_price * q.quantity, locale)}</strong>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <form onSubmit={sendReply} className="space-y-2 rounded-lg border border-slate-200 p-4">
        <label className="label" htmlFor="emp-reply">{t('tickets:reply_as_staff')}</label>
        <textarea
          id="emp-reply"
          className="input min-h-24 w-full"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={5000}
        />
        <button className="btn" disabled={busy || !reply.trim()}>
          {busy ? t('common:loading') : t('tickets:send_reply')}
        </button>
      </form>

      <form onSubmit={sendQuote} className="space-y-4 rounded-lg border border-brand-200 bg-brand-50 p-4">
        <h3 className="text-lg font-medium">{t('tickets:quote_price')}</h3>
        <div>
          <label className="label" htmlFor="quote-desc">{t('tickets:quote_description')}</label>
          <input
            id="quote-desc"
            className="input mt-1"
            value={description}
            maxLength={500}
            placeholder={t('tickets:quote_description_placeholder')}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="quote-price">{t('tickets:unit_price')}</label>
            <input
              id="quote-price"
              className="input mt-1"
              type="number"
              min={0}
              step={0.01}
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="quote-qty">{t('common:quantity')}</label>
            <input
              id="quote-qty"
              className="input mt-1"
              type="number"
              min={1}
              max={99}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
              required
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('tickets:quote_hint')}</p>
        <button className="btn" disabled={busy || !description.trim() || !unitPrice}>
          {busy ? t('common:loading') : t('tickets:send_quote')}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function LocationTicketList({ profile }: { profile: Profile }) {
  const { t } = useTranslation(['tickets']);
  const locale = useLocale((s) => s.locale);
  const router = useRouter();
  const [filter, setFilter] = useState<string>('open');

  const { data: tickets, error } = useQuery<(Ticket & { location: Pick<Location, 'name'> | null })[]>({
    queryKey: ['location_tickets', filter, profile.role, profile.location_id],
    enabled: profile.role === 'admin' || !!profile.location_id,
    queryFn: async () => {
      let q = supabase().from('tickets').select('*,location:locations(name)')
        .order('updated_at', { ascending: false }).limit(100);
      if (profile.role !== 'admin') q = q.eq('location_id', profile.location_id!);
      if (filter && filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as (Ticket & { location: Pick<Location, 'name'> | null })[];
    },
  });

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {['all', ...STATUS_ORDER].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={'rounded-full px-3 py-1 text-sm ' + (filter === s ? 'bg-brand-600 text-white' : 'bg-slate-100')}
          >
            {s === 'all' ? t('tickets:all') : t(`tickets:status.${s}`)}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 text-red-700">{error.message}</p>}
      {tickets?.length === 0 ? (
        <p className="mt-6 text-slate-500">{t('tickets:none')}</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-2">{t('tickets:subject')}</th>
              <th>{t('tickets:customer')}</th>
              <th>{t('tickets:status_label')}</th>
              <th>{t('tickets:updated')}</th>
            </tr>
          </thead>
          <tbody>
            {(tickets ?? []).map((ticket) => (
              <tr key={ticket.id} className="border-t">
                <td className="py-2">
                  <button className="text-brand-700 underline" onClick={() => router.push(`/employee/tickets?id=${ticket.id}`)}>
                    {ticket.subject}
                  </button>
                </td>
                <td>{ticket.customer_name || ticket.customer_email}{profile.role === 'admin' && ticket.location?.name ? ` · ${ticket.location.name}` : ''}</td>
                <td><StatusBadge status={ticket.status} t={t} /></td>
                <td>{new Date(ticket.updated_at).toLocaleString(locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EmployeeTicketsPage() {
  const { t } = useTranslation(['tickets', 'employee']);
  const params = useSearchParams();
  const id = params.get('id');

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['me_emp_tickets'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      const { data } = await supabase().from('profiles').select('*').eq('id', user.id).single();
      return (data as Profile) ?? null;
    },
  });

  if (!profile) return <div className="container-ma py-10">{t('common:loading')}</div>;
  if (!profile.is_active || !['employee', 'manager', 'admin'].includes(profile.role)) {
    return <div className="container-ma py-10">Access denied.</div>;
  }
  if (profile.role !== 'admin' && !profile.location_id) {
    return <div className="container-ma py-10">{t('employee:no_location')}</div>;
  }

  return (
    <div className="container-ma py-10 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('tickets:title')}</h1>
        <Link href={profile.role === 'admin' ? '/admin' : '/employee'} className="btn-outline">{t('employee:back_to_portal')}</Link>
      </div>
      <p className="mt-1 text-sm text-slate-600">{t('tickets:staff_subtitle')}</p>
      <div className="mt-6">
        {id
          ? <TicketDetail key={id} id={id} profile={profile} />
          : <LocationTicketList profile={profile} />}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="container-ma py-10">Loading…</div>}>
      <EmployeeTicketsPage />
    </Suspense>
  );
}
