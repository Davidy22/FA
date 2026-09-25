'use client';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/store/locale';
import type { Locale } from '@/lib/i18n';

const LABELS: Record<Locale, string> = {
  en: 'EN',
  'zh-Hant': '繁',
  'zh-Hans': '简',
};

export function LocaleSwitcher() {
  const { t } = useTranslation('common');
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        <option value="en">{LABELS.en}</option>
        <option value="zh-Hant">{LABELS['zh-Hant']}</option>
        <option value="zh-Hans">{LABELS['zh-Hans']}</option>
      </select>
    </label>
  );
}
