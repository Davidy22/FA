import { describe, expect, it } from 'vitest';
import { LOCATION_COUNTRIES, NO_SALES_TAX_COUNTRIES, countryName, hasSalesTax } from '@/lib/countries';

describe('hasSalesTax', () => {
  it('is false in Hong Kong and the other no-sales-tax jurisdictions', () => {
    expect(hasSalesTax('HK')).toBe(false);
    expect(hasSalesTax('MO')).toBe(false);
    for (const code of NO_SALES_TAX_COUNTRIES) expect(hasSalesTax(code)).toBe(false);
  });

  it('is true elsewhere, whatever the configured rate is', () => {
    expect(hasSalesTax('TW')).toBe(true);
    expect(hasSalesTax('US')).toBe(true);
    expect(hasSalesTax('GB')).toBe(true);
  });

  it('normalises case and whitespace', () => {
    expect(hasSalesTax(' hk ')).toBe(false);
    expect(hasSalesTax('Hk')).toBe(false);
  });

  it('keeps the configured rate for an unknown or unset country', () => {
    expect(hasSalesTax(null)).toBe(true);
    expect(hasSalesTax(undefined)).toBe(true);
    expect(hasSalesTax('')).toBe(true);
    expect(hasSalesTax('ZZ')).toBe(true);
  });
});

describe('countryName', () => {
  it('localises the country name', () => {
    expect(countryName('HK', 'en')).toBe('Hong Kong');
    expect(countryName('HK', 'zh-Hant')).toBe('香港');
    expect(countryName('HK', 'zh-Hans')).toBe('香港');
    expect(countryName('US', 'en')).toMatch(/United States/i);
    expect(countryName('SG', 'zh-Hant')).toContain('新加坡');
  });

  it('falls back to the code and stays quiet when unset', () => {
    expect(countryName('XX', 'en')).toBe('XX');
    expect(countryName(null, 'en')).toBe('');
    expect(countryName('nope', 'en')).toBe('');
  });

  it('offers Hong Kong first in the picker list', () => {
    expect(LOCATION_COUNTRIES[0]).toBe('HK');
    expect(LOCATION_COUNTRIES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });
});
