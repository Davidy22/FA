// Rewards-program helpers: parsing redemption settings, points math, and labels.
// Server-side (SQL) remains authoritative; these are for display and defaults.

import { formatMoney } from './format';
import type { Locale } from './i18n';

export type RedeemOption = {
  points: number;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
};

// Mirrors platform_settings key `rewards.redeem_options` (see seed migration).
export const DEFAULT_REDEEM_OPTIONS: RedeemOption[] = [
  { points: 100, discount_type: 'fixed', discount_value: 5 },
  { points: 200, discount_type: 'fixed', discount_value: 10 },
  { points: 500, discount_type: 'fixed', discount_value: 30 },
];

export const DEFAULT_POINTS_PER_DOLLAR = 1;

/** Validates/sorts the jsonb redemption options; falls back to defaults. */
export function parseRedeemOptions(raw: unknown): RedeemOption[] {
  if (!Array.isArray(raw)) return DEFAULT_REDEEM_OPTIONS;
  const out: RedeemOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const points = Number(o.points);
    const value = Number(o.discount_value);
    const type =
      o.discount_type === 'percent' ? 'percent' :
      o.discount_type === 'fixed' ? 'fixed' : null;
    if (!type) continue;
    if (!Number.isFinite(points) || points <= 0) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    if (type === 'percent' && value > 100) continue;
    out.push({ points: Math.floor(points), discount_type: type, discount_value: value });
  }
  if (!out.length) return DEFAULT_REDEEM_OPTIONS;
  return out.sort((a, b) => a.points - b.points);
}

/** Points earned for a spend: floor(amount * points_per_dollar), never negative. */
export function pointsEarnedFor(amountSpent: number, pointsPerDollar: number): number {
  const rate =
    Number.isFinite(pointsPerDollar) && pointsPerDollar > 0
      ? pointsPerDollar
      : DEFAULT_POINTS_PER_DOLLAR;
  const amount = Number.isFinite(amountSpent) ? amountSpent : 0;
  return Math.max(0, Math.floor(amount * rate));
}

/** "US$5.00 off" / "10% off" via i18n keys rewards.discount_fixed / discount_percent. */
export function couponDiscountLabel(
  coupon: { discount_type: 'percent' | 'fixed'; discount_value: number },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (coupon.discount_type === 'percent') {
    return t('rewards:discount_percent', { value: `${coupon.discount_value}%` });
  }
  return t('rewards:discount_fixed', { value: formatMoney(coupon.discount_value, 'en' as Locale) });
}
