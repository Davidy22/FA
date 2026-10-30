'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';
import { useLocale } from '@/store/locale';

/**
 * Client-side providers for the root layout. The layout itself stays a server
 * component so it can export page metadata; everything that needs state lives
 * here instead.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const initLocale = useLocale((state) => state.init);
  const locale = useLocale((state) => state.locale);
  // One client per browser tab, created lazily so the module import stays cheap.
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
    }),
  );

  useEffect(() => { void initLocale(); }, [initLocale]);

  // The document is prerendered with the default language; keep the tag in sync
  // so screen readers and translation tools get the language actually on screen.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}
