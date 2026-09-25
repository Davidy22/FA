// i18n initialization for react-i18next. Uses ICU via i18next-icu.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ICU from 'i18next-icu';

import enCommon from '@/i18n/locales/en/common.json';
import enCatalog from '@/i18n/locales/en/catalog.json';
import enQuote from '@/i18n/locales/en/quote.json';
import enCart from '@/i18n/locales/en/cart.json';
import enCheckout from '@/i18n/locales/en/checkout.json';
import enOrders from '@/i18n/locales/en/orders.json';
import enCreator from '@/i18n/locales/en/creator.json';
import enEmployee from '@/i18n/locales/en/employee.json';
import enAdmin from '@/i18n/locales/en/admin.json';
import enErrors from '@/i18n/locales/en/errors.json';

import zhHantCommon from '@/i18n/locales/zh-Hant/common.json';
import zhHantCatalog from '@/i18n/locales/zh-Hant/catalog.json';
import zhHantQuote from '@/i18n/locales/zh-Hant/quote.json';
import zhHantCart from '@/i18n/locales/zh-Hant/cart.json';
import zhHantCheckout from '@/i18n/locales/zh-Hant/checkout.json';
import zhHantOrders from '@/i18n/locales/zh-Hant/orders.json';
import zhHantCreator from '@/i18n/locales/zh-Hant/creator.json';
import zhHantEmployee from '@/i18n/locales/zh-Hant/employee.json';
import zhHantAdmin from '@/i18n/locales/zh-Hant/admin.json';
import zhHantErrors from '@/i18n/locales/zh-Hant/errors.json';

import zhHansCommon from '@/i18n/locales/zh-Hans/common.json';
import zhHansCatalog from '@/i18n/locales/zh-Hans/catalog.json';
import zhHansQuote from '@/i18n/locales/zh-Hans/quote.json';
import zhHansCart from '@/i18n/locales/zh-Hans/cart.json';
import zhHansCheckout from '@/i18n/locales/zh-Hans/checkout.json';
import zhHansOrders from '@/i18n/locales/zh-Hans/orders.json';
import zhHansCreator from '@/i18n/locales/zh-Hans/creator.json';
import zhHansEmployee from '@/i18n/locales/zh-Hans/employee.json';
import zhHansAdmin from '@/i18n/locales/zh-Hans/admin.json';
import zhHansErrors from '@/i18n/locales/zh-Hans/errors.json';

const resources = {
  en: {
    common: enCommon, catalog: enCatalog, quote: enQuote, cart: enCart,
    checkout: enCheckout, orders: enOrders, creator: enCreator,
    employee: enEmployee, admin: enAdmin, errors: enErrors,
  },
  'zh-Hant': {
    common: zhHantCommon, catalog: zhHantCatalog, quote: zhHantQuote, cart: zhHantCart,
    checkout: zhHantCheckout, orders: zhHantOrders, creator: zhHantCreator,
    employee: zhHantEmployee, admin: zhHantAdmin, errors: zhHantErrors,
  },
  'zh-Hans': {
    common: zhHansCommon, catalog: zhHansCatalog, quote: zhHansQuote, cart: zhHansCart,
    checkout: zhHansCheckout, orders: zhHansOrders, creator: zhHansCreator,
    employee: zhHansEmployee, admin: zhHansAdmin, errors: zhHansErrors,
  },
};

export const SUPPORTED_LOCALES = ['en', 'zh-Hant', 'zh-Hans'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function normalizeLocale(tag?: string | null): Locale {
  if (!tag) return 'en';
  if (SUPPORTED_LOCALES.includes(tag as Locale)) return tag as Locale;
  if (tag.startsWith('zh')) {
    if (/TW|HK|MO|Hant/i.test(tag)) return 'zh-Hant';
    return 'zh-Hans';
  }
  return 'en';
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
      ns: ['common','catalog','quote','cart','checkout','orders','creator','employee','admin','errors'],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
}

export default i18n;
