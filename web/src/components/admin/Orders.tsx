'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Location, Order } from '@/lib/types';
import { ADMIN_PAGE_SIZE, AdminFeedback, AdminPagination, AdminQueryState, FormActions, useAdminAction } from './Shared';
import { FuzzySelect } from './FuzzySelect';

const EDITABLE_STATUSES: Order['status'][] = ['pending', 'printing', 'completed', 'shipped', 'cancelled'];

function OrderForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [status, setStatus] = useState<Order['status']>(order.status);
  const [tracking, setTracking] = useState(order.tracking_number || '');
  const [reason, setReason] = useState(order.cancel_reason || '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (status === 'cancelled' && !reason.trim()) throw new Error(t('admin:cancel_reason_required'));
      const { error } = await supabase().from('orders').update({
        status, tracking_number: tracking.trim() || null, cancel_reason: status === 'cancelled' ? reason.trim() : order.cancel_reason,
      }).eq('id', order.id).select().single();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['admin_orders'] });
    }, onDone);
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3 rounded border border-brand-200 p-3 text-sm">
    <div className="grid gap-3 sm:grid-cols-2">
      <label>{t('admin:fields.status')}<select className="input mt-1" value={status} onChange={(event) => setStatus(event.target.value as Order['status'])}>
        {EDITABLE_STATUSES.map((value) => <option key={value} value={value}>{t(`common:status.${value}`)}</option>)}
      </select></label>
      <label>{t('admin:fields.tracking')}<input className="input mt-1" maxLength={100} value={tracking} onChange={(event) => setTracking(event.target.value)} /></label>
    </div>
    {status === 'cancelled' && <label className="block">{t('admin:fields.cancel_reason')} *<textarea className="input mt-1" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
    <p className="text-xs text-slate-500">{t('admin:cancel_not_refund')}</p>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

export function AdminOrders() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [status, setStatus] = useState('all');
  const [locationId, setLocationId] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const locationsQuery = useQuery<Location[]>({
    queryKey: ['admin_locations'], queryFn: async () => {
      const { data, error } = await supabase().from('locations').select('*').order('name');
      if (error) throw error;
      return (data || []) as Location[];
    },
  });
  const ordersQuery = useQuery<Order[]>({
    queryKey: ['admin_orders', status, locationId, page, filter],
    queryFn: async () => {
      let request = supabase().from('orders').select('*')
        .order('created_at', { ascending: false }).order('id', { ascending: true })
        .range(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE - 1);
      if (status !== 'all') request = request.eq('status', status);
      if (locationId !== 'all') request = request.eq('location_id', locationId);
      if (filter) request = request.or(`order_number.ilike.%${filter}%,contact_email.ilike.%${filter}%`);
      const { data, error } = await request;
      if (error) throw error;
      return (data || []) as Order[];
    },
  });

  async function refund(order: Order) {
    if (!window.confirm(t('admin:refund_confirm', { order: order.order_number }))) return;
    await action.run(async () => {
      const { data, error } = await supabase().functions.invoke('refund-order', { body: { order_id: order.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await queryClient.invalidateQueries({ queryKey: ['admin_orders'] });
    });
  }

  const orders = ordersQuery.data || [];
  return <>
    <h2 className="text-xl font-medium">{t('admin:orders')}</h2>
    <p className="mt-1 text-sm text-slate-600">{t('admin:orders_help')}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <label className="text-sm">{t('admin:fields.status')}<select className="input mt-1" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
        <option value="all">{t('admin:all')}</option>{([...EDITABLE_STATUSES, 'refunded'] as const).map((value) => <option key={value} value={value}>{t(`common:status.${value}`)}</option>)}
      </select></label>
      <label className="text-sm">{t('admin:locations')}<div className="mt-1"><FuzzySelect value={locationId} onChange={(value) => { setLocationId(value); setPage(0); }}
        emptyLabel={t('admin:all')} emptyValue="all" searchLabel={t('admin:locations')}
        options={(locationsQuery.data || []).map((location) => ({ value: location.id, label: location.name }))} /></div></label>
      <form className="flex items-end gap-2" onSubmit={(event) => {
        event.preventDefault(); setPage(0);
        // PostgREST's OR filter syntax treats punctuation as operators.
        setFilter(search.trim().replace(/[^a-zA-Z0-9@.\-]/g, '')); setEditing(null);
      }}>
        <label className="text-sm">{t('admin:search_orders')}
          <input className="input mt-1" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="submit" className="btn">{t('common:search')}</button>
      </form>
    </div>
    <AdminFeedback error={action.error} notice={action.notice} />
    <AdminQueryState loading={ordersQuery.isPending || locationsQuery.isPending} error={ordersQuery.error || locationsQuery.error} />
    {ordersQuery.data?.length === 0 && <p className="mt-4 text-slate-500">{t('admin:no_orders')}</p>}
    <div className="mt-4 space-y-3">
      {orders.map((order) => <article key={order.id} className="rounded-lg border p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div>
          <strong className="font-mono">{order.order_number}</strong> · {t(`common:status.${order.status}`)}
          <p className="mt-1 text-slate-600">{order.contact_name || order.contact_email} · {order.contact_email}</p>
          <p className="text-slate-500">{locationsQuery.data?.find((location) => location.id === order.location_id)?.name || '—'} · {new Date(order.created_at).toLocaleString(locale)}</p>
          {order.tracking_number && <p className="text-slate-600">{t('admin:fields.tracking')}: {order.tracking_number}</p>}
        </div><strong>{formatMoney(Number(order.total_amount), locale, order.currency)}</strong></div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link className="text-brand-700 underline" href={`/employee/order?id=${order.id}`}>{t('admin:order_detail')}</Link>
          {order.status !== 'refunded' && <button type="button" className="text-brand-700 underline" onClick={() => setEditing(order.id)}>{t('admin:update_order')}</button>}
          {['shipped', 'cancelled'].includes(order.status) && order.stripe_payment_intent_id &&
            <button type="button" disabled={action.busy} className="text-red-700 underline" onClick={() => void refund(order)}>{t('admin:refund_payment')}</button>}
        </div>
        {editing === order.id && <OrderForm key={order.id} order={order} onDone={() => setEditing(null)} />}
      </article>)}
    </div>
    <AdminPagination page={page} hasNext={orders.length === ADMIN_PAGE_SIZE}
      onPageChange={(next) => { setPage(next); setEditing(null); }} />
  </>;
}
