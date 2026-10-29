'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/store/locale';
import { formatMoney, t_db } from '@/lib/format';
import { filamentSwatchStyle, finishLabel } from '@/lib/filaments';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Filament, Material, Order, Profile } from '@/lib/types';

type StockFilament = Filament & {
  location_in_stock?: boolean;
  material?: Material;
};

export default function EmployeePortal() {
  const { t } = useTranslation(['common','employee']);
  const locale = useLocale((s) => s.locale);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [orderPageNumber, setOrderPageNumber] = useState(0);
  const [stockQuery, setStockQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'out'>('all');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: profile, isPending: profileLoading } = useQuery<Profile|null>({
    queryKey: ['me'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });
  const { data: orderPage } = useQuery<{ orders: Order[]; hasNext: boolean }>({
    queryKey: ['emp_orders', statusFilter, profile?.location_id, orderPageNumber],
    enabled: !!profile?.location_id,
    queryFn: async () => {
      let q = supabase().from('orders').select('*').eq('location_id', profile!.location_id);
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: true })
        .range(orderPageNumber * 50, orderPageNumber * 50 + 50);
      if (error) throw error;
      const rows = data || [];
      return { orders: rows.slice(0, 50) as Order[], hasNext: rows.length > 50 };
    },
  });
  const orders = orderPage?.orders || [];

  const { data: filaments } = useQuery<StockFilament[]>({
    queryKey: ['emp_filaments', profile?.location_id],
    enabled: !!profile?.location_id,
    queryFn: async () => {
      const { data: fs } = await supabase().from('filaments')
        .select('*, material:materials(*), finish_info:filament_finishes(name)');
      const { data: lf } = await supabase().from('location_filaments')
        .select('filament_id,in_stock').eq('location_id', profile!.location_id);
      const inStock = new Set((lf||[]).filter((row) => row.in_stock).map((row) => row.filament_id));
      return (fs || []).map((row) => ({
        ...row,
        finish_name: row.finish_info?.name ?? null,
        location_in_stock: inStock.has(row.id),
      })) as StockFilament[];
    },
  });

  const stockGroups = useMemo(() => {
    const needle = stockQuery.trim().toLocaleLowerCase(locale);
    const matching = (filaments || []).filter((filament) => {
      if (stockFilter === 'in' && !filament.location_in_stock) return false;
      if (stockFilter === 'out' && filament.location_in_stock) return false;
      if (!needle) return true;
      const finish = finishLabel(filament.finish_name, filament.finish, locale);
      const haystack = [
        filament.id,
        ...Object.values(filament.color || {}),
        ...Object.values(filament.material?.name || {}),
        filament.material?.slug,
        filament.finish,
        finish,
      ].filter(Boolean).join(' ').toLocaleLowerCase(locale);
      return haystack.includes(needle);
    });
    const groups = new Map<string, { material?: Material; rows: StockFilament[] }>();
    for (const filament of matching) {
      const key = filament.material_id;
      if (!groups.has(key)) groups.set(key, { material: filament.material, rows: [] });
      groups.get(key)!.rows.push(filament);
    }
    return [...groups.entries()].sort(([, a], [, b]) =>
      t_db(a.material?.name, locale).localeCompare(t_db(b.material?.name, locale), locale));
  }, [filaments, locale, stockFilter, stockQuery]);

  async function toggleStock(filament_id: string, next: boolean) {
    const loc = profile!.location_id;
    const { error } = await supabase().from('location_filaments').upsert(
      { location_id: loc, filament_id, in_stock: next }, { onConflict: 'location_id,filament_id' }
    );
    if (error) setError(error.message);
    else {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['emp_filaments'] }),
        queryClient.invalidateQueries({ queryKey: ['available_filaments'] }),
      ]);
    }
  }

  async function updateStatus(id: string, status: string, tracking?: string) {
    const { error } = await supabase().from('orders').update({ status, tracking_number: tracking || null }).eq('id', id).select().single();
    if (error) setError(error.message);
    else {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['emp_orders'] });
    }
  }

  if (profileLoading) return <div className="container-ma py-10">{t('common:loading')}</div>;
  if (!profile || !profile.is_active || !['employee','manager','admin'].includes(profile.role)) {
    return <div className="container-ma py-10">Access denied.</div>;
  }
  if (profile.role === 'admin' && !profile.location_id) {
    return <div className="container-ma py-10"><h1 className="text-2xl font-semibold">{t('employee:title')}</h1>
      <p className="mt-3 text-slate-600">{t('employee:admin_all_locations')}</p>
      <div className="mt-4 flex gap-2"><Link className="btn" href="/admin">{t('common:nav.admin')}</Link>
        <Link className="btn-outline" href="/employee/tickets">{t('employee:tickets')}</Link></div>
    </div>;
  }

  return (
    <div className="container-ma py-10">
      <h1 className="text-2xl font-semibold">{t('employee:title')}</h1>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2 items-center flex-wrap">
        {['pending','printing','completed','shipped','cancelled'].map((status) => (
          <button key={status} onClick={() => { setStatusFilter(status); setOrderPageNumber(0); }}
            className={'px-3 py-1 rounded-full text-sm ' + (statusFilter === status ? 'bg-brand-600 text-white' : 'bg-slate-100')}>
            {t(`common:status.${status}`)}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Link href="/employee/tickets" className="btn-outline text-sm">{t('employee:tickets')}</Link>
          <Link href="#filament" className="btn-outline text-sm">{t('employee:filament_stock')}</Link>
        </div>
      </div>
      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-slate-500"><tr>
          <th className="py-2">{t('employee:order_number')}</th><th>{t('employee:customer')}</th><th>{t('employee:date')}</th>
          <th>{t('employee:status')}</th><th className="text-right">{t('common:total')}</th><th></th>
        </tr></thead>
        <tbody>
          {(orders||[]).map((order) => (
            <tr key={order.id} className="border-t">
              <td className="py-2 font-mono">{order.order_number}</td>
              <td>{order.contact_name || order.contact_email}</td>
              <td>{new Date(order.created_at).toLocaleDateString(locale)}</td>
              <td>
                <select value={order.status} onChange={(event) => void updateStatus(order.id, event.target.value)} className="rounded border border-slate-300 text-sm">
                  {['pending','printing','completed','shipped','cancelled'].map((status) => <option key={status} value={status}>{t(`common:status.${status}`)}</option>)}
                </select>
              </td>
              <td className="text-right">{formatMoney(order.total_amount, locale, order.currency)}</td>
              <td className="text-right">
                <Link href={`/employee/order?id=${order.id}`} className="text-brand-700 underline">{t('employee:detail')}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!!orderPage && (orderPageNumber > 0 || orderPage.hasNext) && <nav
        aria-label={t('employee:orders_pagination')} className="mt-5 flex items-center justify-between gap-3 text-sm">
        <button type="button" className="btn-outline" disabled={orderPageNumber === 0}
          onClick={() => setOrderPageNumber((current) => Math.max(0, current - 1))}>{t('employee:previous_page')}</button>
        <span aria-live="polite">{t('employee:page_number', { number: orderPageNumber + 1 })}</span>
        <button type="button" className="btn-outline" disabled={!orderPage.hasNext}
          onClick={() => setOrderPageNumber((current) => current + 1)}>{t('employee:next_page')}</button>
      </nav>}

      <h2 id="filament" className="mt-10 text-xl font-medium">{t('employee:filament_stock')}</h2>
      <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_220px]">
        <label className="text-sm font-medium text-slate-700">{t('employee:stock_search')}
          <input type="search" className="input mt-1 bg-white" value={stockQuery}
            placeholder={t('employee:stock_search_placeholder')} onChange={(event) => setStockQuery(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">{t('employee:stock_availability')}
          <select className="input mt-1 bg-white" value={stockFilter}
            onChange={(event) => setStockFilter(event.target.value as 'all' | 'in' | 'out')}>
            <option value="all">{t('employee:stock_all')}</option>
            <option value="in">{t('employee:in_stock')}</option>
            <option value="out">{t('employee:out_of_stock')}</option>
          </select>
        </label>
      </div>
      {!stockGroups.length ? (
        <p className="mt-4 text-sm text-slate-500">{t('employee:no_stock_matches')}</p>
      ) : <div className="mt-4 space-y-3">
        {stockGroups.map(([materialId, group]) => {
          const materialName = t_db(group.material?.name, locale) || t('employee:unknown_material');
          const inStock = group.rows.filter((row) => row.location_in_stock).length;
          return <details key={materialId} className="rounded-lg border border-slate-200 bg-white" open={!!stockQuery.trim()}>
            <summary className="cursor-pointer select-none px-4 py-3 font-medium text-slate-800">
              {materialName}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {t('employee:stock_group_summary', { count: group.rows.length, inStock })}
              </span>
            </summary>
            <table className="w-full border-t border-slate-200 text-sm">
              <thead className="text-left text-slate-500"><tr>
                <th className="py-2 pl-4">{t('employee:id')}</th><th>{t('employee:color')}</th>
                <th>{t('employee:cost_per_gram')}</th><th className="pr-4">{t('employee:in_stock')}</th>
              </tr></thead>
              <tbody>
                {group.rows.map((filament) => (
                  <tr key={filament.id} className="border-t">
                    <td className="py-2 pl-4 font-mono text-xs">{filament.id.slice(0,8)}</td>
                    <td>
                      <span className="swatch" style={filamentSwatchStyle(filament)} /> {t_db(filament.color, locale)}
                      {finishLabel(filament.finish_name, filament.finish, locale) && filament.finish !== 'standard' &&
                        <span className="text-slate-500"> · {finishLabel(filament.finish_name, filament.finish, locale)}</span>}
                    </td>
                    <td>{formatMoney(Number(group.material?.cost_per_gram || 0), locale)}</td>
                    <td className="pr-4">
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={!!filament.location_in_stock}
                          onChange={(event) => void toggleStock(filament.id, event.target.checked)} />
                        {filament.location_in_stock ? t('employee:in_stock') : t('employee:out_of_stock')}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>;
        })}
      </div>}
    </div>
  );
}
