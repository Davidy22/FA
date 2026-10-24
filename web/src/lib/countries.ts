// Sales tax depends on the country of the pickup location. Hong Kong has no
// general sales tax, so a Hong Kong location always prices tax-free while other
// countries keep the rate their admin configured.
//
// Mirrors public.no_sales_tax_countries() in
// supabase/migrations/20250101002100_location_country_tax.sql — the database is
// authoritative at checkout; this list only drives the admin form.

/** Jurisdictions with no general sales tax/VAT on retail goods (ISO 3166-1 alpha-2). */
export const NO_SALES_TAX_COUNTRIES = [
  'HK', // Hong Kong
  'MO', // Macau
  'BN', // Brunei
  'KW', // Kuwait
  'QA', // Qatar
  'KY', // Cayman Islands
  'VG', // British Virgin Islands
  'BM', // Bermuda
  'PW', // Palau
  'VU', // Vanuatu
  'NR', // Nauru
  'TV', // Tuvalu
] as const;

/** Countries offered in the admin location form, most relevant first. */
export const LOCATION_COUNTRIES = [
  'HK', 'MO', 'TW', 'CN', 'JP', 'KR', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID',
  'IN', 'AU', 'NZ', 'GB', 'IE', 'US', 'CA', 'DE', 'FR', 'NL', 'ES', 'IT',
  'AE', 'SA', 'KW', 'QA', 'BN',
] as const;

type CountryCode = string;

// CLDR names are long or politically loaded for these (zh-Hant renders Hong Kong
// as "中國香港特別行政區"), so the picker uses these shorter local names instead.
const COUNTRY_NAME_OVERRIDES: Record<string, Record<string, string>> = {
  HK: { en: 'Hong Kong', 'zh-Hant': '香港', 'zh-Hans': '香港' },
  MO: { en: 'Macao', 'zh-Hant': '澳門', 'zh-Hans': '澳门' },
  TW: { en: 'Taiwan', 'zh-Hant': '台灣', 'zh-Hans': '台湾' },
  CN: { en: 'China', 'zh-Hant': '中國', 'zh-Hans': '中国' },
};

/** True when a location in this country charges the sales tax it configured. */
export function hasSalesTax(country: CountryCode | null | undefined): boolean {
  const code = (country || '').trim().toUpperCase();
  // An unknown or unset country keeps the configured rate rather than silently
  // dropping tax; the database applies the same rule.
  if (!code) return true;
  return !(NO_SALES_TAX_COUNTRIES as readonly string[]).includes(code);
}

/** Localized country name, falling back to the code itself. */
export function countryName(country: CountryCode | null | undefined, locale: string): string {
  const code = (country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const bundle = locale.startsWith('zh-Hant') ? 'zh-Hant' : locale.startsWith('zh-Hans') ? 'zh-Hans' : 'en';
  const override = COUNTRY_NAME_OVERRIDES[code]?.[bundle];
  if (override) return override;
  try {
    return new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code) || code;
  } catch {
    return code;
  }
}
