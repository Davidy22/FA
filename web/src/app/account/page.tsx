'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';
import type { Order, Profile } from '@/lib/types';

export default function AccountPage() {
  const { t } = useTranslation(['common','orders']);
  const locale = useLocale((s) => s.locale);
  const { data: profile } = useQuery<Profile|null>({
    queryKey: ['me_account'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });
  const { data: orders } = useQuery<Order[]>({
    queryKey: ['my_orders'],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase().from('orders').select('*').order('created_at', { ascending: false }).limit(50);
      return data || [];
    },
  });
  if (!profile) return <div className="container-fa py-10">Please sign in.</div>;
  return (
    <div className="container-fa py-10">
      <h1 className="text-2xl font-semibold">{t('nav.account')}</h1>
      <p className="mt-2 text-slate-600">{profile.email}</p>
      {profile.is_creator && <Link href="/creator" className="btn-outline mt-4 inline-block">{t('nav.creator_dashboard')}</Link>}
      <h2 className="mt-8 text-xl font-medium">{t('orders:title')}</h2>
      {!orders?.length ? <p className="text-slate-500 mt-3">{t('orders:none')}</p> : (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="py-2">#</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="py-2 font-mono">{o.order_number}</td>
                <td>{new Date(o.created_at).toLocaleDateString(locale)}</td>
                <td>{t(`common:status.${o.status}`)}</td>
                <td className="text-right">{formatMoney(o.total_amount, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
