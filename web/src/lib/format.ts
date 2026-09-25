// Internationalization helpers.

import type { Locale } from '@/lib/i18n';

// DB JSONB localized values have shape { en: string, 'zh-Hant'?: string, 'zh-Hans'?: string }
export type Localized = { en: string; [k: string]: string | undefined };

export function t_db(value: Localized | string | null | undefined, locale: Locale): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[locale] ?? value.en ?? '';
}

// formatMaterial: adjective-first by default (customer-facing),
// technicalFirst=true for staff (PETG - Tough and weather-resistant).
// zh locales use full-width parentheses.
export function formatMaterial(
  mat: { name: Localized; adjective?: Localized | null },
  locale: Locale,
  opts: { technicalFirst?: boolean; priceModifier?: number } = {}
): string {
  const name = t_db(mat.name, locale);
  const adj = mat.adjective ? t_db(mat.adjective, locale) : '';
  const open = locale.startsWith('zh') ? '（' : ' (';
  const close = locale.startsWith('zh') ? '）' : ')';

  let s: string;
  if (opts.technicalFirst) {
    s = adj ? `${name} - ${adj}` : name;
  } else {
    s = adj ? `${adj}${open}${name}${close}` : name;
  }
  if (opts.priceModifier && opts.priceModifier !== 0) {
    const sign = opts.priceModifier > 0 ? '+' : '−';
    s += ` ${sign}${formatMoney(Math.abs(opts.priceModifier), locale)}`;
  }
  return s;
}

// USD currency formatting: "US$5.00" for all locales per spec.
export function formatMoney(n: number, _locale: Locale): string {
  return `US$${n.toFixed(2)}`;
}

export function formatMinutes(min: number, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale.replace('zh-','zh-'), { maximumFractionDigits: 0 });
  if (locale === 'en') return `${formatter.format(min)} min`;
  if (locale === 'zh-Hant') return `${formatter.format(min)} 分鐘`;
  return `${formatter.format(min)} 分钟`;
}

// Locale -> Intl.NumberFormat for grams.
export function formatGrams(g: number, locale: Locale): string {
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return `${nf.format(g)} g`;
}

// Category/Status lookup keys are resolved via i18n t() in components.

// Simple slug generation for CJK titles: lowercase and replace non-allowed chars with dash.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
