'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, { normalizeLocale, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';

interface LocaleState {
  locale: Locale;
  setLocale(l: Locale): void;
  init(): void;
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem('fab.locale');
  if (saved && SUPPORTED_LOCALES.includes(saved as Locale)) return saved as Locale;
  for (const t of navigator.languages || []) {
    const l = normalizeLocale(t);
    if (l) return l;
  }
  return 'en';
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
    { name: 'fab.locale', partialize: (s) => ({ locale: s.locale }) }
  )
);
