// i18n initialization for react-i18next. Uses ICU via i18next-icu.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ICU from 'i18next-icu';

import enCommon from '@/i18n/locales/en/common.json';
import enCatalog from '@/i18n/locales/en/catalog.json';
import enQuote from '@/i18n/locales/en/quote.json';
import enTickets from '@/i18n/locales/en/tickets.json';
import enCart from '@/i18n/locales/en/cart.json';
import enCheckout from '@/i18n/locales/en/checkout.json';
import enOrders from '@/i18n/locales/en/orders.json';
import enCreator from '@/i18n/locales/en/creator.json';
import enEmployee from '@/i18n/locales/en/employee.json';
import enAdmin from '@/i18n/locales/en/admin.json';
import enErrors from '@/i18n/locales/en/errors.json';
import enRewards from '@/i18n/locales/en/rewards.json';

import zhHantCommon from '@/i18n/locales/zh-Hant/common.json';
import zhHantCatalog from '@/i18n/locales/zh-Hant/catalog.json';
import zhHantQuote from '@/i18n/locales/zh-Hant/quote.json';
import zhHantTickets from '@/i18n/locales/zh-Hant/tickets.json';
import zhHantCart from '@/i18n/locales/zh-Hant/cart.json';
import zhHantCheckout from '@/i18n/locales/zh-Hant/checkout.json';
import zhHantOrders from '@/i18n/locales/zh-Hant/orders.json';
import zhHantCreator from '@/i18n/locales/zh-Hant/creator.json';
import zhHantEmployee from '@/i18n/locales/zh-Hant/employee.json';
import zhHantAdmin from '@/i18n/locales/zh-Hant/admin.json';
import zhHantErrors from '@/i18n/locales/zh-Hant/errors.json';
import zhHantRewards from '@/i18n/locales/zh-Hant/rewards.json';

import zhHansCommon from '@/i18n/locales/zh-Hans/common.json';
import zhHansCatalog from '@/i18n/locales/zh-Hans/catalog.json';
import zhHansQuote from '@/i18n/locales/zh-Hans/quote.json';
import zhHansTickets from '@/i18n/locales/zh-Hans/tickets.json';
import zhHansCart from '@/i18n/locales/zh-Hans/cart.json';
import zhHansCheckout from '@/i18n/locales/zh-Hans/checkout.json';
import zhHansOrders from '@/i18n/locales/zh-Hans/orders.json';
import zhHansCreator from '@/i18n/locales/zh-Hans/creator.json';
import zhHansEmployee from '@/i18n/locales/zh-Hans/employee.json';
import zhHansAdmin from '@/i18n/locales/zh-Hans/admin.json';
import zhHansErrors from '@/i18n/locales/zh-Hans/errors.json';
import zhHansRewards from '@/i18n/locales/zh-Hans/rewards.json';

const resources = {
  en: {
    common: enCommon, catalog: enCatalog, quote: enQuote, cart: enCart,
    tickets: enTickets,
    checkout: enCheckout, orders: enOrders, creator: enCreator,
    employee: enEmployee, admin: enAdmin, errors: enErrors, rewards: enRewards,
  },
  'zh-Hant': {
    common: zhHantCommon, catalog: zhHantCatalog, quote: zhHantQuote, cart: zhHantCart,
    tickets: zhHantTickets,
    checkout: zhHantCheckout, orders: zhHantOrders, creator: zhHantCreator,
    employee: zhHantEmployee, admin: zhHantAdmin, errors: zhHantErrors, rewards: zhHantRewards,
  },
  'zh-Hans': {
    common: zhHansCommon, catalog: zhHansCatalog, quote: zhHansQuote, cart: zhHansCart,
    tickets: zhHansTickets,
    checkout: zhHansCheckout, orders: zhHansOrders, creator: zhHansCreator,
    employee: zhHansEmployee, admin: zhHansAdmin, errors: zhHansErrors, rewards: zhHansRewards,
  },
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
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources,
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: ['common','catalog','quote','cart','checkout','orders','creator','employee','admin','errors','rewards','tickets'],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
}

export default i18n;
