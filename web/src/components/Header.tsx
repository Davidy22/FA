'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useCart } from '@/store/cart';
import { useLocation } from '@/store/location';
import { useLocale } from '@/store/locale';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LocationSelector } from './LocationSelector';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useEffect, useState } from 'react';
import type { Profile } from '@/lib/types';

export function Header() {
  const { t } = useTranslation('common');
  const { items } = useCart();
  const { selectedLocationId } = useLocation();
  const setCartLocation = useCart((s) => s.setLocation);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    setCartLocation(selectedLocationId);
  }, [selectedLocationId, setCartLocation]);

  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      const { data } = await supabase().from('profiles').select('*').eq('id', user.id).single();
      setProfile(data);
      return data;
    },
  });

  const itemCount = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-20">
      <div className="container-fa flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold text-brand-700" aria-label="Fab Anything">
            F<span className="text-slate-800">ab</span>
          </Link>
          <nav className="hidden md:flex gap-4 text-sm">
            <Link href="/catalog" className="text-slate-700 hover:text-brand-700">{t('nav.catalog')}</Link>
            <Link href="/quote" className="text-slate-700 hover:text-brand-700">{t('nav.quote')}</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <LocationSelector />
          <LocaleSwitcher />
          <Link href="/cart" className="relative inline-flex items-center px-3 py-2 text-sm rounded-md hover:bg-slate-100" aria-label={t('nav.cart')}>
            <span aria-hidden>🛒</span>
            {itemCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 text-xs bg-brand-600 text-white rounded-full px-1.5">
                {itemCount}
              </span>
            )}
          </Link>
          {profile ? (
            <div className="flex items-center gap-2 text-sm">
              <Link href="/account" className="text-slate-700 hover:text-brand-700">
                {profile.display_name || profile.email}
              </Link>
              {profile.role !== 'customer' && (
                <Link href="/employee" className="text-slate-700 hover:text-brand-700">{t('nav.employee_portal')}</Link>
              )}
              {profile.role === 'admin' && (
                <Link href="/admin" className="text-slate-700 hover:text-brand-700">{t('nav.admin')}</Link>
              )}
              {profile.is_creator && (
                <Link href="/creator" className="text-slate-700 hover:text-brand-700">{t('nav.creator_dashboard')}</Link>
              )}
              <button
                className="text-slate-500 hover:text-red-600"
                onClick={() => supabase().auth.signOut()}
              >{t('nav.logout')}</button>
            </div>
          ) : (
            <Link href="/login" className="btn-outline text-sm">{t('nav.login')}</Link>
          )}
        </div>
      </div>
    </header>
  );
}
