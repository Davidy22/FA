import { describe, expect, it } from 'vitest';
import { DEFAULT_CURRENCY, formatMaterial, formatMoney, t_db } from '@/lib/format';

const PLA = {
  name: { en: 'PLA', 'zh-Hant': 'PLA', 'zh-Hans': 'PLA' },
  adjective: { en: 'Easy and eco-friendly', 'zh-Hant': '環保易印', 'zh-Hans': '环保易印' },
};

const PETG = {
  name: { en: 'PETG' },
  adjective: { en: 'Tough and weather-resistant', 'zh-Hant': '堅韌耐候', 'zh-Hans': '坚韧耐候' },
};

describe('t_db', () => {
  it('falls back to en when locale missing', () => {
    expect(t_db({ en: 'Hello' }, 'zh-Hant')).toBe('Hello');
  });
  it('returns empty for null', () => {
    expect(t_db(null, 'en')).toBe('');
  });
});

describe('formatMaterial', () => {
  it('renders adjective-first with ascii parens for en', () => {
    expect(formatMaterial(PETG, 'en')).toContain('Tough and weather-resistant (PETG)');
  });
  it('uses full-width parens for zh-Hant', () => {
    expect(formatMaterial(PETG, 'zh-Hant')).toContain('堅韌耐候（PETG）');
  });
  it('uses full-width parens for zh-Hans', () => {
    expect(formatMaterial(PETG, 'zh-Hans')).toContain('坚韧耐候（PETG）');
  });
  it('appends price modifier with + sign', () => {
    expect(formatMaterial(PETG, 'en', { priceModifier: 2 })).toMatch(/\+HK\$2\.00$/);
  });
  it('formats a price modifier in another currency', () => {
    expect(formatMaterial(PETG, 'en', { priceModifier: 2, currency: 'USD' })).toMatch(/\+US\$2\.00$/);
  });
  it('technical-first (staff) reverses to NAME - ADJ', () => {
    expect(formatMaterial(PLA, 'en', { technicalFirst: true })).toBe('PLA - Easy and eco-friendly');
  });
  it('no adjective returns name only', () => {
    expect(formatMaterial({ name: { en: 'Mystery' } }, 'en')).toBe('Mystery');
  });
});

describe('formatMoney', () => {
  it('prices in Hong Kong dollars by default', () => {
    expect(DEFAULT_CURRENCY).toBe('HKD');
    expect(formatMoney(5, 'en')).toBe('HK$5.00');
    expect(formatMoney(1234.5, 'zh-Hant')).toBe('HK$1,234.50');
    expect(formatMoney(1234.5, 'zh-Hans')).toBe('HK$1,234.50');
  });

  it('uses the location currency when one is given', () => {
    expect(formatMoney(5, 'en', 'USD')).toBe('US$5.00');
    expect(formatMoney(5, 'zh-Hant', 'USD')).toBe('US$5.00');
    expect(formatMoney(5, 'en', 'twd')).toBe('NT$5.00');
  });

  it('survives a blank or invalid currency code', () => {
    expect(formatMoney(5, 'en', null)).toBe('HK$5.00');
    expect(formatMoney(5, 'en', '  ')).toBe('HK$5.00');
    expect(formatMoney(5, 'en', 'ZZ1')).toBe('ZZ1 5.00');
  });

  it('treats a non-finite amount as zero', () => {
    expect(formatMoney(Number.NaN, 'en')).toBe('HK$0.00');
  });
});
