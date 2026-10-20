'use client';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';

/**
 * A price. While a sale is running the regular price is struck through and the
 * sale price sits beside it; otherwise a single price is shown.
 */
export function Price({ regular, now, currency, className = '', badge = false }: {
  regular: number;
  /** What the customer actually pays; pass the same value as regular when not on sale. */
  now: number;
  currency?: string | null;
  className?: string;
  badge?: boolean;
}) {
  const { t } = useTranslation('common');
  const locale = useLocale((s) => s.locale);
  if (!(now < regular)) {
    return <span className={className}>{formatMoney(regular, locale, currency)}</span>;
  }
  return (
    <span className={className}>
      <s className="mr-1 font-normal text-slate-400">{formatMoney(regular, locale, currency)}</s>
      <span className="font-semibold text-rose-700">{formatMoney(now, locale, currency)}</span>
      {badge && <span className="badge ml-2 bg-rose-50 text-rose-700">{t('sale_badge')}</span>}
    </span>
  );
}
