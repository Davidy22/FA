'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useState, Suspense } from 'react';

function OrderDetail({ id }: { id: string }) {
  const { t } = useTranslation(['common','employee']);
  const [note, setNote] = useState('');
  const { data: order } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await supabase().from('orders').select('*,order_items(*),order_notes(*)').eq('id', id).single()).data,
  });
  async function addNote() {
    if (!note) return;
    const { error } = await supabase().from('order_notes').insert({ order_id: id, body: note });
    if (!error) { setNote(''); location.reload(); }
  }
  if (!order) return <div className="container-fa py-10">Loading…</div>;
  return (
    <div className="container-fa py-10 max-w-4xl">
      <h1 className="text-2xl font-semibold">{order.order_number}</h1>
      <p className="text-slate-600">{order.contact_name} — {order.contact_email}</p>
      <p>Status: {t(`common:status.${order.status}`)}</p>
      <h2 className="mt-6 text-lg font-medium">Items</h2>
      <ul className="divide-y">
        {(order.order_items||[]).map((i:any) => (
          <li key={i.id} className="py-2 text-sm">
            {i.premade_product_id ? i.item_snapshot?.name?.en || 'Premade' : 'Custom print'}
            {' × '}{i.quantity} — ${i.unit_price.toFixed(2)}
            {i.quote_request_id && (
              <button className="ml-3 underline text-brand-700"
                onClick={async () => {
                  const { data } = await supabase().functions.invoke('sign-file', {
                    body: { bucket:'models', path: i.item_snapshot?.model_path || '', order_id: order.id }
                  });
                  if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                }}>{t('employee:download_model')}</button>
            )}
          </li>
        ))}
      </ul>
      <h2 className="mt-6 text-lg font-medium">Internal notes</h2>
      <div className="space-y-2 mt-2">
        {(order.order_notes||[]).map((n:any) => (
          <div key={n.id} className="rounded border p-2 text-sm">{n.body}</div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input flex-1" value={note} onChange={e=>setNote(e.target.value)} placeholder={t('employee:add_note')} />
        <button className="btn" onClick={addNote}>Add</button>
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  const params = useSearchParams();
  const id = params.get('id');
  if (!id) return <div className="container-fa py-10">Missing order id.</div>;
  return <Suspense fallback={<div className="container-fa py-10">Loading…</div>}><OrderDetail id={id} /></Suspense>;
}
