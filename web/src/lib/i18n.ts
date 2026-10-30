// i18n initialization for react-i18next. Locale strings use i18next's
// {{variable}} interpolation; do not replace it with an ICU-only parser.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English is the fallback and the default, so it ships in the main bundle. The
// two Chinese bundles are ~15 kB gzipped each and most visitors never switch to
// them, so they load on demand (see ensureLocale at the bottom of this file).
import enCommon from '@/i18n/locales/en/common.json';
import enCatalog from '@/i18n/locales/en/catalog.json';
import enQuote from '@/i18n/locales/en/quote.json';
import enTickets from '@/i18n/locales/en/tickets.json';
import enCart from '@/i18n/locales/en/cart.json';
import enCheckout from '@/i18n/locales/en/checkout.json';
import enOrders from '@/i18n/locales/en/orders.json';
import enCreator from '@/i18n/locales/en/creator.json';
import enEmployee from '@/i18n/locales/en/employee.json';
import enErrors from '@/i18n/locales/en/errors.json';
import enRewards from '@/i18n/locales/en/rewards.json';
import enPages from '@/i18n/locales/en/pages.json';

export const NAMESPACES = [
  'common', 'catalog', 'quote', 'cart', 'checkout', 'orders',
  'creator', 'employee', 'admin', 'errors', 'rewards', 'tickets', 'pages',
] as const;

/** Namespaces that ship with a locale bundle; `admin` is fetched separately. */
const BUNDLED_NAMESPACES = NAMESPACES.filter((namespace) => namespace !== 'admin');

const en = {
  common: enCommon, catalog: enCatalog, quote: enQuote, cart: enCart,
  tickets: enTickets, checkout: enCheckout, orders: enOrders, creator: enCreator,
  employee: enEmployee, errors: enErrors, rewards: enRewards, pages: enPages,
};

export const SUPPORTED_LOCALES = ['en', 'zh-Hant', 'zh-Hans'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// Hong Kong is the home market, so its region (and Macau/Taiwan) reads
// Traditional Chinese while mainland China and Singapore read Simplified.
const TRADITIONAL_CHINESE_REGIONS = ['HK', 'MO', 'TW'];
const SIMPLIFIED_CHINESE_REGIONS = ['CN', 'SG'];
// A browser that reports no region subtag still has a clock; these are the
// zones whose visitors read Chinese.
const ZONE_REGIONS: Record<string, string> = {
  'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW',
  'Asia/Shanghai': 'CN', 'Asia/Singapore': 'SG',
};

/** The region subtag of a BCP-47 tag, uppercased ('zh-Hant-HK' -> 'HK'). */
export function regionFromTag(tag?: string | null): string {
  const parts = (tag || '').replace(/_/g, '-').split('-');
  // Skip the language subtag: 'zh' is two letters but is not a region.
  return (parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part)) || '').toUpperCase();
}

/** The locale a language tag asks for, or null when we do not speak it. */
export function localeFromTag(tag?: string | null): Locale | null {
  const normalized = (tag || '').replace(/_/g, '-').trim();
  if (!normalized) return null;
  if ((SUPPORTED_LOCALES as readonly string[]).includes(normalized)) return normalized as Locale;

  const [language, ...rest] = normalized.split('-');
  const region = (rest.find((part) => /^[A-Za-z]{2}$/.test(part)) || '').toUpperCase();
  const script = (rest.find((part) => /^[A-Za-z]{4}$/.test(part)) || '').toLowerCase();

  if (language.toLowerCase() === 'zh') {
    if (script === 'hans' || SIMPLIFIED_CHINESE_REGIONS.includes(region)) return 'zh-Hans';
    // Traditional is the default reading of a bare "zh" in Hong Kong.
    return 'zh-Hant';
  }
  // A browser that asks for English by any regional spelling (en-HK, en-GB) gets
  // English; only a language we do not publish falls through to the region.
  if (language.toLowerCase() === 'en') return 'en';
  return null;
}

/** The locale a region implies, for browsers whose language we do not speak. */
export function localeFromRegion(region?: string | null, timeZone?: string | null): Locale | null {
  const zone = (timeZone || '').trim();
  const code = (region || '').trim().toUpperCase() || (ZONE_REGIONS[zone] ? ZONE_REGIONS[zone] : '');
  if (TRADITIONAL_CHINESE_REGIONS.includes(code)) return 'zh-Hant';
  if (SIMPLIFIED_CHINESE_REGIONS.includes(code)) return 'zh-Hans';
  return null;
}

/** Browser language preference, then its region, then English. */
export function detectLocaleFrom(tags: readonly string[], timeZone?: string | null): Locale {
  for (const tag of tags) {
    const byLanguage = localeFromTag(tag);
    if (byLanguage) return byLanguage;
  }
  for (const tag of tags) {
    const byRegion = localeFromRegion(regionFromTag(tag));
    if (byRegion) return byRegion;
  }
  return localeFromRegion(null, timeZone) || 'en';
}

if (typeof window !== 'undefined' && !i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: { en },
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: [...NAMESPACES],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
}

const LOCALE_LOADERS: Record<Exclude<Locale, 'en'>, Record<string, () => Promise<{ default: unknown }>>> = {
  'zh-Hant': {
    common: () => import('@/i18n/locales/zh-Hant/common.json'),
    catalog: () => import('@/i18n/locales/zh-Hant/catalog.json'),
    quote: () => import('@/i18n/locales/zh-Hant/quote.json'),
    tickets: () => import('@/i18n/locales/zh-Hant/tickets.json'),
    cart: () => import('@/i18n/locales/zh-Hant/cart.json'),
    checkout: () => import('@/i18n/locales/zh-Hant/checkout.json'),
    orders: () => import('@/i18n/locales/zh-Hant/orders.json'),
    creator: () => import('@/i18n/locales/zh-Hant/creator.json'),
    employee: () => import('@/i18n/locales/zh-Hant/employee.json'),
    errors: () => import('@/i18n/locales/zh-Hant/errors.json'),
    rewards: () => import('@/i18n/locales/zh-Hant/rewards.json'),
    pages: () => import('@/i18n/locales/zh-Hant/pages.json'),
  },
  'zh-Hans': {
    common: () => import('@/i18n/locales/zh-Hans/common.json'),
    catalog: () => import('@/i18n/locales/zh-Hans/catalog.json'),
    quote: () => import('@/i18n/locales/zh-Hans/quote.json'),
    tickets: () => import('@/i18n/locales/zh-Hans/tickets.json'),
    cart: () => import('@/i18n/locales/zh-Hans/cart.json'),
    checkout: () => import('@/i18n/locales/zh-Hans/checkout.json'),
    orders: () => import('@/i18n/locales/zh-Hans/orders.json'),
    creator: () => import('@/i18n/locales/zh-Hans/creator.json'),
    employee: () => import('@/i18n/locales/zh-Hans/employee.json'),
    errors: () => import('@/i18n/locales/zh-Hans/errors.json'),
    rewards: () => import('@/i18n/locales/zh-Hans/rewards.json'),
    pages: () => import('@/i18n/locales/zh-Hans/pages.json'),
  },
};

const loadedLocales = new Set<Locale>(['en']);

/**
 * Add a language's bundles to i18next, fetching them the first time it is used.
 * English is already present, so it resolves without a request.
 */
export async function ensureLocale(locale: Locale): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const loaders = LOCALE_LOADERS[locale as Exclude<Locale, 'en'>];
  const modules = await Promise.all(BUNDLED_NAMESPACES.map((namespace) => loaders[namespace]()));
  BUNDLED_NAMESPACES.forEach((namespace, index) => {
    i18n.addResourceBundle(locale, namespace, modules[index].default, true, true);
  });
  loadedLocales.add(locale);
}

/** Whether a locale's bundles are already in memory (English always is). */
export function localeIsLoaded(locale: Locale): boolean {
  return loadedLocales.has(locale);
}

export default i18n;
