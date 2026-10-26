'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

export default function AboutPage() {
  const { t } = useTranslation(['pages', 'common']);

  const values = [
    { title: t('pages:about.value_local_title'), body: t('pages:about.value_local') },
    { title: t('pages:about.value_craft_title'), body: t('pages:about.value_craft') },
    { title: t('pages:about.value_custom_title'), body: t('pages:about.value_custom') },
  ];

  return (
    <div className="container-ma py-10 max-w-3xl">
      <h1 className="text-3xl font-semibold">{t('pages:about.title')}</h1>
      <p className="mt-3 text-lg text-slate-700">{t('pages:about.lede')}</p>

      <section className="mt-8">
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          {values.map((value) => (
            <div key={value.title} className="rounded-lg border border-slate-200 p-4">
              <dt className="font-medium">{value.title}</dt>
              <dd className="mt-1 text-sm text-slate-600">{value.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link href="/catalog" className="btn">{t('pages:about.cta_catalog')}</Link>
        <Link href="/quote" className="btn-outline">{t('pages:about.cta_quote')}</Link>
        <Link href="/contact" className="btn-outline">{t('pages:about.cta_contact')}</Link>
      </div>
    </div>
  );
}
