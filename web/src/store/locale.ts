'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, { detectLocaleFrom, ensureLocale, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';

interface LocaleState {
  locale: Locale;
  /** False until the active language's bundles are in memory. */
  ready: boolean;
  setLocale(l: Locale): Promise<void>;
  init(): Promise<void>;
}

/** The browser's language preferences, plus the OS locale as a region hint. */
function browserHints(): { tags: string[]; timeZone: string | null } {
  const tags: string[] = [];
  if (typeof navigator !== 'undefined') {
    for (const tag of navigator.languages || []) if (tag) tags.push(tag);
    if (navigator.language) tags.push(navigator.language);
  }
  let timeZone: string | null = null;
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    if (resolved.locale && !tags.includes(resolved.locale)) tags.push(resolved.locale);
    timeZone = resolved.timeZone || null;
  } catch {
    // An exotic environment without Intl still gets the language tags above.
  }
  return { tags, timeZone };
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem('ma.locale');
  if (saved && SUPPORTED_LOCALES.includes(saved as Locale)) return saved as Locale;
  const { tags, timeZone } = browserHints();
  return detectLocaleFrom(tags, timeZone);
}

export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'en',
      ready: false,
      setLocale: async (l) => {
        // The Chinese bundles are fetched on demand; switch language only once
        // the strings are in memory so no screen renders untranslated keys.
        await ensureLocale(l);
        await i18n.changeLanguage(l);
        if (typeof document !== 'undefined') document.documentElement.lang = l;
        set({ locale: l, ready: true });
      },
      init: async () => {
        const l = detectLocale();
        try {
          await ensureLocale(l);
        } catch (error) {
          // A failed chunk fetch must not lock the visitor out of the site.
          console.error('Could not load locale bundle', error);
          set({ locale: 'en', ready: true });
          return;
        }
        await i18n.changeLanguage(l);
        if (typeof document !== 'undefined') document.documentElement.lang = l;
        set({ locale: l, ready: true });
      },
    }),
    { name: 'ma.locale', partialize: (s) => ({ locale: s.locale }) }
  )
);
