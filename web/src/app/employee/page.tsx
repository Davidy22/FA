'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/store/locale';
import { formatMoney } from '@/lib/format';
import Link from 'next/link';
import { useState } from 'react';
import type { Filament, Location, Order, Profile } from '@/lib/types';

export default function EmployeePortal() {
  const { t } = useTranslation(['common','employee']);
  const locale = useLocale((s) => s.locale);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const { data: profile } = useQuery<Profile|null>({
    queryKey: ['me_emp'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });
  const { data: orders, refetch } = useQuery<Order[]>({
    queryKey: ['emp_orders', statusFilter, profile?.location_id],
    enabled: !!profile?.location_id,
    queryFn: async () => {
      let q = supabase().from('orders').select('*').eq('location_id', profile!.location_id);
      if (statusFilter) q = q.eq('status', statusFilter);
      q = q.order('created_at',{ascending:false}).limit(100);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: filaments } = useQuery<(Filament & { location_in_stock?: boolean })[]>({
    queryKey: ['emp_filaments', profile?.location_id],
    enabled: !!profile?.location_id,
    queryFn: async () => {
      const { data: fs } = await supabase().from('filaments').select('*, material:materials(*)');
      const { data: lf } = await supabase().from('location_filaments')
        .select('filament_id,in_stock').eq('location_id', profile!.location_id);
      const inStock = new Set((lf||[]).filter(x=>x.in_stock).map(x=>x.filament_id));
      return (fs||[]).map((f:any) => ({ ...f, location_in_stock: inStock.has(f.id) }));
    },
  });

  async function toggleStock(filament_id: string, next: boolean) {
    const loc = profile!.location_id;
    // Upsert
    const { error } = await supabase().from('location_filaments').upsert(
      { location_id: loc, filament_id, in_stock: next }, { onConflict: 'location_id,filament_id' }
    );
    if (!error) refetch();
  }

  async function updateStatus(id: string, status: string, tracking?: string) {
    // @ts-ignore
    const { error } = await supabase().from('orders').update({ status, tracking_number: tracking }).eq('id', id);
    if (!error) refetch();
  }

  if (!profile || !['employee','manager','admin'].includes(profile.role)) {
    return <div className="container-fa py-10">Access denied.</div>;
  }

  return (
    <div className="container-fa py-10">
      <h1 className="text-2xl font-semibold">{t('employee:title')}</h1>
      <div className="mt-4 flex gap-2 items-center flex-wrap">
        {['pending','printing','completed','shipped','cancelled'].map(s => (
          <button key={s} onClick={()=>setStatusFilter(s)}
            className={'px-3 py-1 rounded-full text-sm ' + (statusFilter===s?'bg-brand-600 text-white':'bg-slate-100')}>
            {t(`common:status.${s}`)}
          </button>
        ))}
        <Link href="#filament" className="ml-auto btn-outline text-sm">{t('employee:filament_stock')}</Link>
      </div>
      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-slate-500"><tr>
          <th className="py-2">Order #</th><th>{t('employee:customer')}</th><th>Date</th><th>Status</th><th className="text-right">Total</th><th></th>
        </tr></thead>
        <tbody>
          {(orders||[]).map((o) => (
            <tr key={o.id} className="border-t">
              <td className="py-2 font-mono">{o.order_number}</td>
              <td>{o.contact_name || o.contact_email}</td>
              <td>{new Date(o.created_at).toLocaleDateString(locale)}</td>
              <td>
                <select value={o.status} onChange={(e)=>updateStatus(o.id, e.target.value)} className="rounded border border-slate-300 text-sm">
                  {['pending','printing','completed','shipped','cancelled'].map(s => <option key={s} value={s}>{t(`common:status.${s}`)}</option>)}
                </select>
              </td>
              <td className="text-right">{formatMoney(o.total_amount, locale)}</td>
              <td className="text-right">
                <Link href={`/employee/order?id=${o.id}`} className="text-brand-700 underline">Detail</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="filament" className="mt-10 text-xl font-medium">{t('employee:filament_stock')}</h2>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="py-2">ID</th><th>Material</th><th>Color</th><th>Cost/g</th><th>{t('employee:in_stock')}</th></tr></thead>
        <tbody>
          {(filaments||[]).map((f:any) => (
            <tr key={f.id} className="border-t">
              <td className="py-2 font-mono text-xs">{f.id.slice(0,8)}</td>
              <td>{f.material?.name?.en}</td>
              <td><span className="swatch" style={{background:f.color_hex||'#ccc'}}/> {f.color?.en}</td>
              <td>${f.cost_per_gram.toFixed(3)}</td>
              <td>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={!!f.location_in_stock}
                    onChange={(e)=>toggleStock(f.id, e.target.checked)} />
                  {f.location_in_stock ? t('employee:in_stock') : t('employee:out_of_stock')}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
