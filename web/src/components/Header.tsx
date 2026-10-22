'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useCart } from '@/store/cart';
import { useLocation } from '@/store/location';
import { useLocale } from '@/store/locale';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { canUseAdminConsole } from '@/lib/permissions';
import { LocationSelector } from './LocationSelector';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useEffect, useState } from 'react';
import type { Profile } from '@/lib/types';

export function Header() {
  const { t } = useTranslation('common');
  const { items } = useCart();
  const { selectedLocationId } = useLocation();
  const setCartLocation = useCart((s) => s.setLocation);
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setCartLocation(selectedLocationId);
  }, [selectedLocationId, setCartLocation]);

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['me'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      const { data } = await supabase().from('profiles').select('*').eq('id', user.id).single();
      return (data as Profile) ?? null;
    },
  });

  // Keep the header in sync with email/password and OAuth sign-in/sign-out.
  useEffect(() => {
    const { data: { subscription } } = supabase().auth.onAuthStateChange(() => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['me_account'] });
      void queryClient.invalidateQueries({ queryKey: ['auth_user'] });
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  const itemCount = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-20">
      <div className="container-ma flex min-h-16 flex-wrap items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold text-brand-700" aria-label="Make Anyth.ing">
            Make<span className="text-slate-800">Anyth.ing</span>
          </Link>
          <nav className="hidden lg:flex gap-4 text-sm">
            <Link href="/catalog" className="text-slate-700 hover:text-brand-700">{t('nav.catalog')}</Link>
            <Link href="/quote" className="text-slate-700 hover:text-brand-700">{t('nav.quote')}</Link>
            <Link href="/document-printing" className="text-slate-700 hover:text-brand-700">{t('nav.document_printing')}</Link>
            <Link href="/rewards" className="text-slate-700 hover:text-brand-700">{t('nav.rewards')}</Link>
            <Link href="/about" className="text-slate-700 hover:text-brand-700">{t('nav.about')}</Link>
            <Link href="/contact" className="text-slate-700 hover:text-brand-700">{t('nav.contact')}</Link>
            {profile && <Link href="/tickets" className="text-slate-700 hover:text-brand-700">{t('nav.tickets')}</Link>}
          </nav>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div className="hidden sm:block"><LocationSelector />
          </div>
          <div className="hidden sm:block"><LocaleSwitcher /></div>
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
              <Link href="/account" className="hidden lg:block max-w-32 truncate text-slate-700 hover:text-brand-700">
                {profile.display_name || profile.email}
              </Link>
              {profile.is_active && profile.role !== 'customer' && (
                <Link href="/employee" className="hidden lg:block text-slate-700 hover:text-brand-700">{t('nav.employee_portal')}</Link>
              )}
              {canUseAdminConsole(profile) && (
                <Link href="/admin" className="hidden lg:block text-slate-700 hover:text-brand-700">{t('nav.admin')}</Link>
              )}
              {profile.is_active && profile.is_creator && (
                <Link href="/creator" className="hidden lg:block text-slate-700 hover:text-brand-700">{t('nav.creator_dashboard')}</Link>
              )}
              <button
                className="hidden lg:block text-slate-500 hover:text-red-600"
                onClick={() => void supabase().auth.signOut()}
              >{t('nav.logout')}</button>
            </div>
          ) : (
            <Link href="/login" className="btn-outline text-sm">{t('nav.login')}</Link>
          )}
          <button type="button" className="btn-outline lg:hidden" aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>Menu</button>
        </div>
        {menuOpen && <nav id="mobile-navigation" className="w-full flex flex-col gap-3 border-t pt-3 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="flex flex-wrap gap-3"><LocationSelector /><LocaleSwitcher /></div>
          <Link href="/catalog">{t('nav.catalog')}</Link><Link href="/quote">{t('nav.quote')}</Link>
          <Link href="/document-printing">{t('nav.document_printing')}</Link>
          <Link href="/rewards">{t('nav.rewards')}</Link><Link href="/account">{t('nav.account')}</Link>
          <Link href="/about">{t('nav.about')}</Link><Link href="/contact">{t('nav.contact')}</Link>
          {profile && <Link href="/tickets">{t('nav.tickets')}</Link>}
          {profile?.is_active && profile.role !== 'customer' && <Link href="/employee">{t('nav.employee_portal')}</Link>}
          {canUseAdminConsole(profile) && <Link href="/admin">{t('nav.admin')}</Link>}
          {profile?.is_active && profile.is_creator && <Link href="/creator">{t('nav.creator_dashboard')}</Link>}
          {profile && <button className="text-left" onClick={() => void supabase().auth.signOut()}>{t('nav.logout')}</button>}
        </nav>}
      </div>
    </header>
  );
}
