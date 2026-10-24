import { describe, expect, it } from 'vitest';
import i18n, {
  detectLocaleFrom,
  localeFromRegion,
  localeFromTag,
  regionFromTag,
} from '@/lib/i18n';

describe('localeFromTag', () => {
  it('accepts a supported locale exactly', () => {
    expect(localeFromTag('en')).toBe('en');
    expect(localeFromTag('zh-Hant')).toBe('zh-Hant');
    expect(localeFromTag('zh-Hans')).toBe('zh-Hans');
    expect(localeFromTag('zh_Hant')).toBe('zh-Hant');
  });

  it('reads Chinese from script or region', () => {
    expect(localeFromTag('zh-HK')).toBe('zh-Hant');
    expect(localeFromTag('zh-TW')).toBe('zh-Hant');
    expect(localeFromTag('zh-MO')).toBe('zh-Hant');
    expect(localeFromTag('zh-Hant-HK')).toBe('zh-Hant');
    expect(localeFromTag('zh-CN')).toBe('zh-Hans');
    expect(localeFromTag('zh-SG')).toBe('zh-Hans');
    expect(localeFromTag('zh-Hans-HK')).toBe('zh-Hans');
    // A bare "zh" in a Hong Kong shop reads Traditional.
    expect(localeFromTag('zh')).toBe('zh-Hant');
  });

  it('answers English for any regional spelling of English', () => {
    expect(localeFromTag('en-HK')).toBe('en');
    expect(localeFromTag('en-US')).toBe('en');
    expect(localeFromTag('en_GB')).toBe('en');
  });

  it('returns null for a language we do not publish', () => {
    expect(localeFromTag('ja-JP')).toBeNull();
    expect(localeFromTag('ko-KR')).toBeNull();
    expect(localeFromTag('')).toBeNull();
    expect(localeFromTag(null)).toBeNull();
  });
});

describe('localeFromRegion', () => {
  it('maps the Chinese-reading regions', () => {
    expect(localeFromRegion('HK')).toBe('zh-Hant');
    expect(localeFromRegion('mo')).toBe('zh-Hant');
    expect(localeFromRegion('TW')).toBe('zh-Hant');
    expect(localeFromRegion('CN')).toBe('zh-Hans');
    expect(localeFromRegion('SG')).toBe('zh-Hans');
  });

  it('falls back to the time zone when a tag has no region', () => {
    expect(localeFromRegion(null, 'Asia/Hong_Kong')).toBe('zh-Hant');
    expect(localeFromRegion('', 'Asia/Shanghai')).toBe('zh-Hans');
    expect(localeFromRegion('US', 'Asia/Hong_Kong')).toBeNull();
    expect(localeFromRegion(null, 'Europe/London')).toBeNull();
  });
});

describe('regionFromTag', () => {
  it('picks the two-letter region out of a tag', () => {
    expect(regionFromTag('zh-Hant-HK')).toBe('HK');
    expect(regionFromTag('en_HK')).toBe('HK');
    expect(regionFromTag('en-US')).toBe('US');
    expect(regionFromTag('en')).toBe('');
    // A four-letter script is not a region.
    expect(regionFromTag('zh-Hant')).toBe('');
  });
});

describe('detectLocaleFrom', () => {
  it('prefers the browser language', () => {
    expect(detectLocaleFrom(['zh-HK', 'en-US'])).toBe('zh-Hant');
    expect(detectLocaleFrom(['zh-CN', 'en'])).toBe('zh-Hans');
    expect(detectLocaleFrom(['en-GB', 'fr-FR'])).toBe('en');
  });

  it('honours an explicit English preference even in Hong Kong', () => {
    expect(detectLocaleFrom(['en-HK'])).toBe('en');
    expect(detectLocaleFrom(['en-HK'], 'Asia/Hong_Kong')).toBe('en');
  });

  it('falls back to the region when the language is not published', () => {
    // A Japanese browser set to Hong Kong reads Traditional Chinese.
    expect(detectLocaleFrom(['ja-HK'])).toBe('zh-Hant');
    expect(detectLocaleFrom(['ko-MO'])).toBe('zh-Hant');
    expect(detectLocaleFrom(['fr-SG'])).toBe('zh-Hans');
    expect(detectLocaleFrom(['ja-JP', 'th-TH', 'en-MO'])).toBe('en');
  });

  it('falls back to the time zone, then to English', () => {
    expect(detectLocaleFrom(['ja-JP'], 'Asia/Hong_Kong')).toBe('zh-Hant');
    expect(detectLocaleFrom(['ja-JP'], 'Asia/Shanghai')).toBe('zh-Hans');
    expect(detectLocaleFrom(['ja-JP'], 'America/New_York')).toBe('en');
    expect(detectLocaleFrom([], null)).toBe('en');
  });

  it('walks every tag instead of stopping at the first one', () => {
    expect(detectLocaleFrom(['ja-JP', 'ko-KR', 'zh-TW'])).toBe('zh-Hant');
    expect(detectLocaleFrom(['fr-FR', 'de-DE', 'zh-Hant-HK'])).toBe('zh-Hant');
    // ...but the browser's own order still wins once a published language shows up.
    expect(detectLocaleFrom(['ja-JP', 'en-AU', 'zh-Hant-HK'])).toBe('en');
  });
});

describe('translation interpolation', () => {
  it('populates reward, provider, and product-price variables', () => {
    const t = i18n.getFixedT('en');
    expect(t('rewards:points', { count: 42 })).toBe('42 points');
    expect(t('common:auth.continue_with', { provider: 'Google' })).toBe('Continue with Google');
    expect(t('common:from_price', { price: 'HK$12.00' })).toBe('from HK$12.00');
    expect(t('rewards:tier_next', { points: 100, tier: 'Silver', multiplier: 2 }))
      .toBe('100 more lifetime points to reach Silver (2× points).');
  });
});
