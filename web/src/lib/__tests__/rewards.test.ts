import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POINTS_PER_DOLLAR,
  DEFAULT_REDEEM_OPTIONS,
  parseRedeemOptions,
  pointsEarnedFor,
  couponDiscountLabel,
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
    expect(couponDiscountLabel({ discount_type: 'fixed', discount_value: 5 }, t)).toBe('US$5.00 off');
  });
});
