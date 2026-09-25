'use client';
import './globals.css';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLocale } from '@/store/locale';
import { Header } from '@/components/Header';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';
import { LocationPrompt } from '@/components/LocationPrompt';
import { ClientOnly } from '@/components/ClientOnly';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const initLocale = useLocale((s) => s.init);
  useEffect(() => { initLocale(); }, [initLocale]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <title>Fab Anything — 3D prints on demand</title>
      </head>
      <body className="min-h-screen flex flex-col">
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <ClientOnly>
              <Header />
              <LocationPrompt />
              <main className="flex-1">{children}</main>
              <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500">
                © {new Date().getFullYear()} Fab Anything
              </footer>
            </ClientOnly>
          </QueryClientProvider>
        </I18nextProvider>
      </body>
    </html>
  );
}
