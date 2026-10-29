'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

/** Keep the footer for the standalone Careers page; storefront actions live in the header. */
export function Footer() {
  const { t } = useTranslation('common');

  return (
    <footer className="border-t border-slate-200 py-8 text-sm text-slate-500">
      <div className="container-ma flex flex-col gap-5">
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label={t('footer.nav_label')}>
          <Link href="/careers" className="hover:text-brand-700">{t('nav.careers')}</Link>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs">
          <p>© {new Date().getFullYear()} Make Anyth.ing</p>
          <p>{t('footer.made_in_hong_kong')}</p>
        </div>
      </div>
    </footer>
  );
}
