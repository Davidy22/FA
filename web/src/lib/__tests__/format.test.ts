import { describe, expect, it } from 'vitest';
import { formatMaterial, t_db } from '@/lib/format';

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
    expect(formatMaterial(PETG, 'en', { priceModifier: 2 })).toMatch(/\+US\$2\.00$/);
  });
  it('technical-first (staff) reverses to NAME - ADJ', () => {
    expect(formatMaterial(PLA, 'en', { technicalFirst: true })).toBe('PLA - Easy and eco-friendly');
  });
  it('no adjective returns name only', () => {
    expect(formatMaterial({ name: { en: 'Mystery' } }, 'en')).toBe('Mystery');
  });
});
