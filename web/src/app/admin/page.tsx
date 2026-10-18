'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { AdminSubmissions } from '@/components/admin/Submissions';
import { AdminLocations } from '@/components/admin/Locations';
import { AdminMaterials } from '@/components/admin/Materials';
import { AdminProducts } from '@/components/admin/Products';
import { AdminOrders } from '@/components/admin/Orders';
import { AdminTickets } from '@/components/admin/Tickets';
import { AdminUsers } from '@/components/admin/Users';
import { AdminPayouts } from '@/components/admin/Payouts';
import { AdminOffers } from '@/components/admin/Offers';
import { AdminSettings } from '@/components/admin/Settings';
import { AdminFeedback, useAdminAction } from '@/components/admin/Shared';

const TABS = [
  'submissions', 'locations', 'materials_filaments', 'products', 'orders',
  'tickets', 'users', 'payouts', 'offers', 'settings',
] as const;
type AdminTab = typeof TABS[number];

export default function AdminPage() {
  const { t } = useTranslation(['common', 'admin']);
  const queryClient = useQueryClient();
  const activation = useAdminAction();
  const [tab, setTab] = useState<AdminTab>('submissions');
  const { data: profile, isPending, error } = useQuery<Profile | null>({
    queryKey: ['me'],
    queryFn: async () => {
      const { data: { user }, error: authError } = await supabase().auth.getUser();
      if (authError) throw authError;
      if (!user) return null;
      const { data, error: profileError } = await supabase().from('profiles').select('*').eq('id', user.id).single();
      if (profileError) throw profileError;
      return data as Profile;
    },
  });

  if (isPending) return <div className="container-ma py-10">{t('common:loading')}</div>;
  if (error) return <div className="container-ma py-10 text-red-700" role="alert">{error.message}</div>;
  if (profile?.role !== 'admin' || !profile.is_active) {
    return <div className="container-ma py-10">
      <p>{t('admin:admin_only')}</p>
      {profile?.is_active && <>
        <p className="mt-4 max-w-xl text-sm text-slate-600">{t('admin:bootstrap_hint')}</p>
        <button type="button" className="btn mt-3" disabled={activation.busy} onClick={() => void activation.run(async () => {
          const { data, error } = await supabase().functions.invoke('bootstrap-admin');
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          await queryClient.invalidateQueries({ queryKey: ['me'] });
        })}>{activation.busy ? t('common:loading') : t('admin:bootstrap_action')}</button>
        <AdminFeedback error={activation.error} notice={activation.notice} />
      </>}
    </div>;
  }

  return (
    <div className="container-ma py-10">
      <h1 className="text-2xl font-semibold">{t('admin:title')}</h1>
      <nav className="mt-5 flex flex-wrap gap-2" aria-label={t('admin:title')}>
        {TABS.map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
            className={'rounded-full px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ' +
              (tab === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200')}>
            {t(`admin:${key}`)}
          </button>
        ))}
      </nav>
      <section className="mt-7 min-w-0" aria-label={t(`admin:${tab}`)}>
        {tab === 'submissions' && <AdminSubmissions />}
        {tab === 'locations' && <AdminLocations />}
        {tab === 'materials_filaments' && <AdminMaterials />}
        {tab === 'products' && <AdminProducts />}
        {tab === 'orders' && <AdminOrders />}
        {tab === 'tickets' && <AdminTickets />}
        {tab === 'users' && <AdminUsers currentUserId={profile.id} />}
        {tab === 'payouts' && <AdminPayouts />}
        {tab === 'offers' && <AdminOffers />}
        {tab === 'settings' && <AdminSettings />}
      </section>
    </div>
  );
}
