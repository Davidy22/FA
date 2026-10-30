'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale } from '@/store/locale';

/**
 * The storefront reads persisted state (locale, appearance, cart, location) on
 * the very first render, which would not match the prerendered HTML. Everything
 * therefore mounts after hydration — but rendering `null` until then made the
 * exported pages completely blank (≈35 visible characters), so the browser had
 * nothing to paint and a slow connection showed a white screen.
 *
 * This shell is what the static export contains: a painted skeleton that keeps
 * layout (and therefore CLS) stable, plus a `noscript` fallback for crawlers and
 * anyone browsing without JavaScript.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  // A visitor reading Chinese would otherwise see a frame of English while the
  // on-demand locale bundle loads.
  const localeReady = useLocale((state) => state.ready);
  useEffect(() => { setMounted(true); }, []);

  return (
    <>
      {mounted && localeReady ? children : (
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="container-ma flex h-14 items-center gap-3">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-600" aria-hidden />
              <span className="text-sm font-semibold tracking-wide text-slate-700">Make Anyth.ing</span>
            </div>
          </header>
          <main className="flex-1" aria-busy="true">
            <div className="container-ma py-10" role="status" aria-live="polite">
              <span className="sr-only">Loading</span>
              <div className="h-6 w-40 animate-pulse rounded bg-slate-100" />
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 10 }, (_, index) => (
                  <div key={index} className="aspect-square animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            </div>
          </main>
        </div>
      )}
      <noscript>
        <div className="container-ma py-10">
          <p className="font-medium">This shop needs JavaScript.</p>
          <p className="mt-1 text-sm text-slate-600">
            這間商店需要 JavaScript 才能運作。 · 这家商店需要 JavaScript 才能运行。
          </p>
        </div>
      </noscript>
    </>
  );
}
