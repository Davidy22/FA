'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { hasPermission, type Permission } from '@/lib/permissions';
import { AdminLocations } from '@/components/admin/Locations';
import { AdminMaterials } from '@/components/admin/Materials';
import { AdminProducts } from '@/components/admin/Products';
import { AdminCategories } from '@/components/admin/Categories';
import { AdminOrders } from '@/components/admin/Orders';
import { AdminTickets } from '@/components/admin/Tickets';
import { AdminUsers } from '@/components/admin/Users';
import { AdminPayouts } from '@/components/admin/Payouts';
import { AdminOffers } from '@/components/admin/Offers';
import { AdminJobs } from '@/components/admin/Jobs';
import { AdminSettings } from '@/components/admin/Settings';
import { AdminFeedback, useAdminAction } from '@/components/admin/Shared';
import { AdminNamespaceGate } from '@/components/admin/AdminNamespaceGate';

// One tab per staff module. A tab only appears when the signed-in account holds
// the module's permission (admins hold all of them).
const TABS: { key: string; permission: Permission }[] = [
  { key: 'locations', permission: 'locations.manage' },
  { key: 'materials_filaments', permission: 'products.manage' },
  { key: 'categories', permission: 'products.manage' },
  { key: 'products', permission: 'products.manage' },
  { key: 'jobs', permission: 'jobs.manage' },
  { key: 'orders', permission: 'orders.manage' },
  { key: 'tickets', permission: 'quotes.manage' },
  { key: 'users', permission: 'users.manage' },
  { key: 'payouts', permission: 'payouts.manage' },
  { key: 'offers', permission: 'coupons.manage' },
  { key: 'settings', permission: 'settings.manage' },
];

function AdminContent() {
  const { t } = useTranslation(['common', 'admin']);
  const queryClient = useQueryClient();
  const activation = useAdminAction();
  const [tab, setTab] = useState<string>('locations');
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

  const allowed = TABS.filter((entry) => hasPermission(profile, entry.permission));
  const active = allowed.some((entry) => entry.key === tab) ? tab : allowed[0]?.key;

  if (!allowed.length) {
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

  const admin = profile?.role === 'admin' || hasPermission(profile, 'admin.full');

  return (
    <div className="container-ma py-10">
      <h1 className="text-2xl font-semibold">{admin ? t('admin:title') : t('admin:staff_title')}</h1>
      {!admin && <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('admin:staff_scope_hint')}</p>}
      <nav className="mt-5 flex flex-wrap gap-2" aria-label={t('admin:title')}>
        {allowed.map((entry) => (
          <button key={entry.key} type="button" onClick={() => setTab(entry.key)} aria-current={active === entry.key ? 'page' : undefined}
            className={'rounded-full px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ' +
              (active === entry.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200')}>
            {t(`admin:${entry.key}`)}
          </button>
        ))}
      </nav>
      <section className="mt-7 min-w-0" aria-label={active ? t(`admin:${active}`) : undefined}>
        {active === 'locations' && <AdminLocations />}
        {active === 'materials_filaments' && <AdminMaterials />}
        {active === 'categories' && <AdminCategories />}
        {active === 'products' && <AdminProducts />}
        {active === 'jobs' && <AdminJobs />}
        {active === 'orders' && <AdminOrders />}
        {active === 'tickets' && <AdminTickets />}
        {active === 'users' && profile && <AdminUsers currentUserId={profile.id} />}
        {active === 'payouts' && <AdminPayouts />}
        {active === 'offers' && <AdminOffers />}
        {active === 'settings' && <AdminSettings />}
      </section>
    </div>
  );
}

export default function AdminPage() {
  return <AdminNamespaceGate><AdminContent /></AdminNamespaceGate>;
}
