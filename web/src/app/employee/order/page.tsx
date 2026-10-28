'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useLocale } from '@/store/locale';
import { formatMoney, formatMaterial, t_db } from '@/lib/format';
import type { Localized, PricedSlot } from '@/lib/types';

type OrderLine = {
  id: string;
  premade_product_id: string | null;
  quote_request_id: string | null;
  quantity: number;
  unit_price: number;
  item_snapshot: { kind?: string; name?: Localized; description?: string; model_path?: string; file_path?: string; ticket_id?: string };
  /** Multi-material prints: one entry per slot, as the customer chose it. */
  material_slots: PricedSlot[] | null;
  order_item_option_values: { id: string; file_path: string | null; text_value: string | null }[];
  product: { source_model_path: string } | null;
};
type OrderDetailRecord = {
  id: string;
  order_number: string;
  contact_name: string | null;
  contact_email: string;
  status: string;
  currency: string;
  order_items: OrderLine[];
  order_notes: { id: string; body: string; kind: 'internal' | 'customer' }[];
};

function OrderDetail({ id }: { id: string }) {
  const { t } = useTranslation(['common','employee']);
  const locale = useLocale((s) => s.locale);
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: order, isPending, error: queryError } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase().from('orders')
        .select('*,order_items(*,order_item_option_values(*),product:premade_products(source_model_path)),order_notes(*)')
        .eq('id', id).single();
      if (error) throw error;
      return data as unknown as OrderDetailRecord;
    },
  });

  async function addNote() {
    if (!note.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const { data: { user } } = await supabase().auth.getUser();
      const { error } = await supabase().from('order_notes').insert({ order_id: id, author_id: user?.id, body: note.trim() });
      if (error) throw error;
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function download(bucket: string, path: string) {
    setError('');
    try {
      const { data, error } = await supabase().functions.invoke('sign-file', {
        body: { bucket, path, order_id: id },
      });
      if (error || !data?.signedUrl) throw error || new Error(t('employee:download_failed'));
      window.open(data.signedUrl as string, '_blank', 'noopener,noreferrer');
    } catch (err) { setError((err as Error).message); }
  }

  if (isPending) return <div className="container-ma py-10">{t('common:loading')}</div>;
  if (queryError || !order) return <div className="container-ma py-10" role="alert">
    {queryError?.message || t('employee:order_not_found')}
  </div>;

  return (
    <div className="container-ma py-10 max-w-4xl">
      <Link href="/employee" className="text-sm text-brand-700 underline">{t('employee:back_to_portal')}</Link>
      <h1 className="mt-3 text-2xl font-semibold">{order.order_number}</h1>
      <p className="text-slate-600">{order.contact_name} — {order.contact_email}</p>
      <p>{t('employee:status')}: {t(`common:status.${order.status}`)}</p>
      <h2 className="mt-6 text-lg font-medium">{t('employee:items')}</h2>
      <ul className="divide-y">
        {(order.order_items || []).map((item) => {
          const modelPath = item.item_snapshot?.model_path || item.product?.source_model_path;
          const bucket = item.premade_product_id ? 'product-files' : 'models';
          return <li key={item.id} className="py-3 text-sm">
            <p>{item.premade_product_id
              ? (t_db(item.item_snapshot?.name, locale) || t('employee:premade'))
              : item.item_snapshot?.description || t(`employee:${item.item_snapshot?.kind === 'document' ? 'document' : 'custom'}`)}
              {' × '}{item.quantity} — {formatMoney(item.unit_price, locale, order.currency)}
            </p>
            {item.material_slots?.length ? (
              <ul className="mt-1 space-y-0.5">
                {item.material_slots.map((slot) => (
                  <li key={slot.slot_id} className="flex items-center gap-2">
                    <span className="font-medium">{t_db(slot.name, locale)}</span>
                    <span className="text-slate-600">{formatMaterial(slot.material, locale)}</span>
                    {slot.color && <>
                      <span className="swatch" style={{ background: slot.color.color_hex || '#ccc' }} />
                      <span className="text-slate-600">{t_db(slot.color.color, locale)}</span>
                    </>}
                  </li>
                ))}
              </ul>
            ) : null}
            {modelPath && <button className="mt-1 underline text-brand-700" onClick={() => void download(bucket, modelPath)}>
              {t('employee:download_model')}
            </button>}
            {item.item_snapshot?.kind === 'document' && item.item_snapshot?.file_path &&
              <button className="mt-1 underline text-brand-700" onClick={() => void download('document-prints', item.item_snapshot.file_path!)}>
                {t('employee:download_document')}
              </button>}
            {item.item_snapshot?.ticket_id && <Link className="ml-3 underline text-brand-700"
              href={`/employee/tickets?id=${item.item_snapshot.ticket_id}`}>{t('employee:view_ticket')}</Link>}
            {(item.order_item_option_values || []).filter((option) => option.file_path).map((option) =>
              <button key={option.id} className="ml-3 underline text-brand-700"
                onClick={() => void download('option-uploads', option.file_path!)}>
                {t('employee:download_option')}
              </button>)}
          </li>;
        })}
      </ul>
      <h2 className="mt-6 text-lg font-medium">{t('employee:order_notes')}</h2>
      <div className="space-y-2 mt-2">
        {(order.order_notes || []).map((note) =>
          <div key={note.id} className="rounded border p-2 text-sm"><span className="badge mr-2">{t(note.kind === 'customer' ? 'employee:customer_order_note' : 'employee:internal_notes')}</span>{note.body}</div>)}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input flex-1" aria-label={t('employee:add_note')}
          value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('employee:add_note')} />
        <button className="btn" disabled={busy || !note.trim()} onClick={() => void addNote()}>{t('common:save')}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}

export default function OrderDetailPage() {
  const params = useSearchParams();
  const id = params.get('id');
  if (!id) return <div className="container-ma py-10">Missing order id.</div>;
  return <Suspense fallback={<div className="container-ma py-10">Loading…</div>}><OrderDetail id={id} /></Suspense>;
}
