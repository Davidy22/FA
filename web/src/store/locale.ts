'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, { detectLocaleFrom, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';

interface LocaleState {
  locale: Locale;
  setLocale(l: Locale): void;
  init(): void;
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
      setLocale: (l) => {
        i18n.changeLanguage(l);
        if (typeof document !== 'undefined') document.documentElement.lang = l;
        set({ locale: l });
      },
      init: () => {
        const l = detectLocale();
        i18n.changeLanguage(l);
        if (typeof document !== 'undefined') document.documentElement.lang = l;
        set({ locale: l });
      },
    }),
    { name: 'ma.locale', partialize: (s) => ({ locale: s.locale }) }
  )
);
