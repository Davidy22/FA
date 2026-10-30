'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';

// Starter rates are indicative only: every order is priced by `price_cart`, and
// custom work is quoted by staff through the ticket flow. Keep them out of the
// money formatter's reach — never print a currency symbol by hand.
const rows = [
  { material: 'PLA', quality: 'quality_standard', rate: 1.3 },
  { material: 'PETG', quality: 'quality_durable', rate: 1.4 },
  { material: 'TPU', quality: 'quality_flexible', rate: 1.5 },
  { material: 'ASA', quality: 'quality_strong', rate: 1.6 },
];

export default function PricingPage() {
  const { t } = useTranslation('pages');
  const locale = useLocale((state) => state.locale);
  const perGram = (rate: number) => `${formatMoney(rate, locale)}/g`;

  return <div className="container-ma max-w-3xl py-10">
    <h1 className="text-3xl font-semibold">{t('pricing.title')}</h1>
    <p className="mt-2 text-slate-600">{t('pricing.intro')}</p>
    <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>
        <th className="p-3">{t('pricing.material')}</th><th className="p-3">{t('pricing.type')}</th><th className="p-3">{t('pricing.rate')}</th>
      </tr></thead><tbody>{rows.map((row) => <tr key={row.material} className="border-t border-slate-200">
        <td className="p-3 font-medium">{row.material}</td><td className="p-3">{t(`pricing.${row.quality}` as const)}</td><td className="p-3">{perGram(row.rate)}</td>
      </tr>)}</tbody></table>
    </div>
    <section className="mt-5 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
      <h2 className="font-semibold">{t('pricing.multi_title')}</h2>
      <p className="mt-1 text-sm">{t('pricing.multi_desc', { price: formatMoney(0.1, locale) })}</p>
    </section>
    <Link href="/quote" className="btn mt-6">{t('pricing.quote_cta')}</Link>
  </div>;
}
