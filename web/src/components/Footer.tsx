'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useFeature } from '@/lib/features';

/**
 * Site footer: the standard pages (About, Contact, Careers) plus the storefront
 * destinations. Careers only appears once an admin switches the page on, so a
 * half-staffed launch does not advertise an empty job board.
 */
export function Footer() {
  const { t } = useTranslation('common');
  const careers = useFeature('careers_page');

  return (
    <footer className="border-t border-slate-200 py-8 text-sm text-slate-500">
      <div className="container-ma flex flex-col gap-5">
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label={t('footer.nav_label')}>
          <Link href="/catalog" className="hover:text-brand-700">{t('nav.catalog')}</Link>
          <Link href="/quote" className="hover:text-brand-700">{t('nav.quote')}</Link>
          <Link href="/document-printing" className="hover:text-brand-700">{t('nav.document_printing')}</Link>
          <Link href="/rewards" className="hover:text-brand-700">{t('nav.rewards')}</Link>
          <Link href="/locations" className="hover:text-brand-700">{t('nav.locations')}</Link>
          <Link href="/about" className="hover:text-brand-700">{t('nav.about')}</Link>
          <Link href="/contact" className="hover:text-brand-700">{t('nav.contact')}</Link>
          {careers.enabled && <Link href="/careers" className="hover:text-brand-700">{t('nav.careers')}</Link>}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs">
          <p>© {new Date().getFullYear()} Make Anyth.ing</p>
          <p>{t('footer.made_in_hong_kong')}</p>
        </div>
      </div>
    </footer>
  );
}
