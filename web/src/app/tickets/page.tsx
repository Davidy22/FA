'use client';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import { useCart } from '@/store/cart';
import { formatMoney } from '@/lib/format';
import { TicketThread } from '@/components/TicketThread';
import type {
  Location, Ticket, TicketAttachment, TicketMessage, TicketQuote,
} from '@/lib/types';

type TicketDetail = Ticket & {
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

function TicketDetail({ id }: { id: string }) {
  const { t } = useTranslation(['tickets', 'common']);
  const locale = useLocale((s) => s.locale);
  const router = useRouter();
  const queryClient = useQueryClient();
  const addItem = useCart((s) => s.addItem);
  const setCartLocation = useCart((s) => s.setLocation);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: ticket, refetch } = useQuery<TicketDetail | null>({
    queryKey: ['ticket', id],
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

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    const body = reply.trim();
    if (!body) return;
    setBusy(true); setError(null);
    try {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) throw new Error(t('errors:login_required'));
      const { data: p } = await supabase()
        .from('profiles').select('display_name').eq('id', user.id).single();
      const { error: mErr } = await supabase().from('ticket_messages').insert({
        ticket_id: id,
        author_id: user.id,
        author_name: (p as { display_name: string | null } | null)?.display_name ?? null,
        author_role: 'customer',
        body,
      });
      if (mErr) throw mErr;
      await supabase().from('tickets').update({ status: 'open' }).eq('id', id);
      setReply('');
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ['my_tickets'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function acceptQuote(quote: TicketQuote) {
    setBusy(true); setError(null);
    try {
      const { data: accepted, error } = await supabase()
        .rpc('accept_ticket_quote', { p_quote_id: quote.id });
      if (error) throw error;
      // Staff quoted the whole lot; cart the quoted quantity.
      addItem({
        kind: 'ticket',
        ticket_quote_id: accepted.id,
        quantity: accepted.quantity,
        options: { description: accepted.description, ticket_id: id },
      });
      if (ticket?.location_id) setCartLocation(ticket.location_id);
      router.push('/cart');
    } catch (err) {
      setError((err as Error).message);
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
          {t('tickets:opened')} {new Date(ticket.created_at).toLocaleString(locale)}
          {ticket.location ? ` · ${ticket.location.name}` : ''}
        </p>
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
                  <div>
                    <p className="text-sm">{q.description}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t('tickets:quoted_by', { name: q.staff_name || t('tickets:staff') })}
                      {' · '}{new Date(q.created_at).toLocaleString(locale)}
                      {' · '}{t('tickets:valid_until')} {new Date(q.expires_at).toLocaleDateString(locale)}
                    </p>
                  </div>
                  <StatusBadge status={q.status} t={t} />
                </div>
                <p className="mt-2 text-sm">
                  {formatMoney(q.unit_price, locale)} × {q.quantity} ={' '}
                  <strong>{formatMoney(q.unit_price * q.quantity, locale)}</strong>
                </p>
                {q.status === 'pending' && (
                  <button
                    className="btn mt-3 w-full"
                    disabled={busy}
                    onClick={() => void acceptQuote(q)}
                  >
                    {t('tickets:add_to_cart')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <form onSubmit={sendReply} className="space-y-2">
        <label className="label" htmlFor="ticket-reply">{t('tickets:your_reply')}</label>
        <textarea
          id="ticket-reply"
          className="input min-h-24 w-full"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={5000}
        />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="btn" disabled={busy || !reply.trim()}>
          {busy ? t('common:loading') : t('tickets:send_reply')}
        </button>
      </form>
    </div>
  );
}

function TicketList() {
  const { t } = useTranslation(['tickets', 'common']);
  const locale = useLocale((s) => s.locale);
  const router = useRouter();
  const [filter, setFilter] = useState<string>('open');

  const { data: tickets } = useQuery<Ticket[]>({
    queryKey: ['my_tickets', filter],
    queryFn: async () => {
      let q = supabase().from('tickets').select('*').order('updated_at', { ascending: false }).limit(100);
      if (filter && filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      return (data || []) as Ticket[];
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
      {tickets?.length === 0 ? (
        <p className="mt-6 text-slate-500">{t('tickets:none')}</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-2">{t('tickets:subject')}</th>
              <th>{t('tickets:status_label')}</th>
              <th>{t('tickets:updated')}</th>
            </tr>
          </thead>
          <tbody>
            {(tickets ?? []).map((ticket) => (
              <tr key={ticket.id} className="border-t">
                <td className="py-2">
                  <button className="text-brand-700 underline" onClick={() => router.push(`/tickets?id=${ticket.id}`)}>
                    {ticket.subject}
                  </button>
                </td>
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

function TicketsPage() {
  const { t } = useTranslation(['tickets', 'common']);
  const params = useSearchParams();
  const id = params.get('id');
  return (
    <div className="container-ma py-10 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('tickets:title')}</h1>
        <Link href="/quote" className="btn-outline">{t('tickets:new_ticket')}</Link>
      </div>
      <p className="mt-1 text-sm text-slate-600">{t('tickets:subtitle')}</p>
      <div className="mt-6">
        {id
          ? <TicketDetail key={id} id={id} />
          : <TicketList />}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="container-ma py-10">Loading…</div>}>
      <TicketsPage />
    </Suspense>
  );
}
