'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n, { type Locale } from '@/lib/i18n';
import { useLocale } from '@/store/locale';

// Admin copy is sizeable and most storefront visitors never need it. Keep it
// out of the shared locale chunk and load only the active language on demand.
const LOADERS: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('@/i18n/locales/en/admin.json'),
  'zh-Hant': () => import('@/i18n/locales/zh-Hant/admin.json'),
  'zh-Hans': () => import('@/i18n/locales/zh-Hans/admin.json'),
};

export function AdminNamespaceGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const locale = useLocale((state) => state.locale);
  const query = useQuery({
    queryKey: ['i18n_namespace', 'admin', locale],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      if (!i18n.hasResourceBundle(locale, 'admin')) {
        const resource = await LOADERS[locale]();
        i18n.addResourceBundle(locale, 'admin', resource.default, true, true);
      }
      return true;
    },
  });

  if (query.isPending) return <div className="container-ma py-10">{t('loading')}</div>;
  if (query.error) {
    return <div className="container-ma py-10 text-red-700" role="alert">{query.error.message}</div>;
  }
  return children;
}
