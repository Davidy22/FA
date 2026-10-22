import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POINTS_PER_DOLLAR,
  DEFAULT_REDEEM_OPTIONS,
  DEFAULT_TIERS,
  parseRedeemOptions,
  parseTiers,
  pointsEarnedFor,
  couponConditions,
  couponDiscountLabel,
  tierFor,
  tierProgress,
} from '../rewards';

describe('parseRedeemOptions', () => {
  it('returns defaults for invalid input', () => {
    expect(parseRedeemOptions(undefined)).toEqual(DEFAULT_REDEEM_OPTIONS);
    expect(parseRedeemOptions(null)).toEqual(DEFAULT_REDEEM_OPTIONS);
    expect(parseRedeemOptions('nope')).toEqual(DEFAULT_REDEEM_OPTIONS);
    expect(parseRedeemOptions([])).toEqual(DEFAULT_REDEEM_OPTIONS);
    expect(parseRedeemOptions([{ bogus: true }])).toEqual(DEFAULT_REDEEM_OPTIONS);
  });

  it('keeps valid options sorted by points', () => {
    const raw = [
      { points: 500, discount_type: 'fixed', discount_value: 30 },
      { points: 100, discount_type: 'fixed', discount_value: 5 },
      { points: 200, discount_type: 'percent', discount_value: 10 },
    ];
    expect(parseRedeemOptions(raw)).toEqual([
      { points: 100, discount_type: 'fixed', discount_value: 5 },
      { points: 200, discount_type: 'percent', discount_value: 10 },
      { points: 500, discount_type: 'fixed', discount_value: 30 },
    ]);
  });

  it('keeps a product scope so points can be redeemed for a specific item', () => {
    const raw = [
      { points: 300, discount_type: 'percent', discount_value: 100, product_id: 'prod-1' },
      { points: 100, discount_type: 'fixed', discount_value: 5, product_id: null },
      { points: 50, discount_type: 'fixed', discount_value: 2, product_id: '   ' },
    ];
    expect(parseRedeemOptions(raw)).toEqual([
      { points: 50, discount_type: 'fixed', discount_value: 2 },
      { points: 100, discount_type: 'fixed', discount_value: 5 },
      { points: 300, discount_type: 'percent', discount_value: 100, product_id: 'prod-1' },
    ]);
  });

  it('drops malformed entries but keeps the good ones', () => {
    const raw = [
      { points: 100, discount_type: 'fixed', discount_value: 5 },
      { points: -5, discount_type: 'fixed', discount_value: 5 },
      { points: 50, discount_type: 'weird', discount_value: 5 },
      { points: 50, discount_type: 'percent', discount_value: 150 },
      { points: 'abc', discount_type: 'fixed', discount_value: 1 },
    ];
    expect(parseRedeemOptions(raw)).toEqual([
      { points: 100, discount_type: 'fixed', discount_value: 5 },
    ]);
  });
});

describe('pointsEarnedFor', () => {
  it('earns one point per dollar by default', () => {
    expect(pointsEarnedFor(13.65, DEFAULT_POINTS_PER_DOLLAR)).toBe(13);
    expect(pointsEarnedFor(0.99, DEFAULT_POINTS_PER_DOLLAR)).toBe(0);
    expect(pointsEarnedFor(100, DEFAULT_POINTS_PER_DOLLAR)).toBe(100);
  });

  it('honours a custom rate', () => {
    expect(pointsEarnedFor(10, 2)).toBe(20);
    expect(pointsEarnedFor(10, 0.5)).toBe(5);
  });

  it('never returns negatives for bad input', () => {
    expect(pointsEarnedFor(-5, 1)).toBe(0);
    expect(pointsEarnedFor(NaN, 1)).toBe(0);
    expect(pointsEarnedFor(10, NaN)).toBe(10);
    expect(pointsEarnedFor(10, -1)).toBe(10);
  });
});

describe('couponDiscountLabel', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    key === 'rewards:discount_percent'
      ? `${String(opts?.value)} off`
      : `${String(opts?.value)} off`;

  it('formats percent coupons', () => {
    expect(couponDiscountLabel({ discount_type: 'percent', discount_value: 10 }, t)).toBe('10% off');
  });

  it('formats fixed coupons as money', () => {
    expect(couponDiscountLabel({ discount_type: 'fixed', discount_value: 5 }, t)).toBe('HK$5.00 off');
  });
});

describe('couponConditions', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    key === 'rewards:coupon_min_spend' ? `min ${String(opts?.amount)}` : `only ${String(opts?.product)}`;

  it('describes a minimum spend and a product restriction', () => {
    expect(couponConditions({ min_subtotal: 50, product_id: 'p1' }, 'Keychain', t))
      .toEqual(['min HK$50.00', 'only Keychain']);
  });

  it('says nothing for an unrestricted coupon', () => {
    expect(couponConditions({ min_subtotal: null, product_id: null }, null, t)).toEqual([]);
    expect(couponConditions({}, undefined, t)).toEqual([]);
  });

  it('skips the product note until the name has loaded', () => {
    expect(couponConditions({ product_id: 'p1' }, null, t)).toEqual([]);
  });
});

describe('membership tiers', () => {
  it('parses, sorts and repairs the tier ladder', () => {
    const parsed = parseTiers([
      { name: 'Gold', min_lifetime_points: 5000, multiplier: 3 },
      { name: 'Silver', min_lifetime_points: 1000, multiplier: 2 },
      { name: 'Broken', min_lifetime_points: 10, multiplier: 0 },
      { name: '', min_lifetime_points: 0, multiplier: 1 },
    ]);
    expect(parsed.map((tier) => tier.name)).toEqual(['', 'Silver', 'Gold']);
    expect(parseTiers(undefined)).toEqual(DEFAULT_TIERS);
    expect(parseTiers([])).toEqual(DEFAULT_TIERS);
    // A ladder without a starting tier gets one, so everyone is in a tier.
    expect(parseTiers([{ min_lifetime_points: 100, multiplier: 2 }])[0])
      .toEqual({ name: '', min_lifetime_points: 0, multiplier: 1 });
  });

  it('picks the tier that matches the lifetime total', () => {
    expect(tierFor(0).name).toBe('Member');
    expect(tierFor(999).multiplier).toBe(1);
    expect(tierFor(1000).multiplier).toBe(2);
    expect(tierFor(9999).multiplier).toBe(3);
    expect(tierFor(-5).multiplier).toBe(1);
  });

  it('reports progress towards the next tier', () => {
    expect(tierProgress(0, DEFAULT_TIERS)).toMatchObject({ remaining: 1000, ratio: 0 });
    expect(tierProgress(500, DEFAULT_TIERS)).toMatchObject({ remaining: 500, ratio: 0.5 });
    const top = tierProgress(9000, DEFAULT_TIERS);
    expect(top.next).toBeNull();
    expect(top.ratio).toBe(1);
  });

  it('multiplies points earned by the tier', () => {
    expect(pointsEarnedFor(13.65, 1, 1)).toBe(13);
    expect(pointsEarnedFor(13.65, 1, 2)).toBe(27);
    expect(pointsEarnedFor(10, 1, 3)).toBe(30);
    expect(pointsEarnedFor(10, 1, 0)).toBe(10);
  });
});
