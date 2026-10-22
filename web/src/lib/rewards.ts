// Rewards-program helpers: parsing redemption settings, points math, and labels.
// Server-side (SQL) remains authoritative; these are for display and defaults.

import { formatMoney } from './format';
import type { Locale } from './i18n';

export type RedeemOption = {
  points: number;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  /** When set, the issued coupon only discounts this product (100% = a free item). */
  product_id?: string | null;
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
    const productId = typeof o.product_id === 'string' && o.product_id.trim() ? o.product_id.trim() : null;
    out.push({
      points: Math.floor(points), discount_type: type, discount_value: value,
      ...(productId ? { product_id: productId } : {}),
    });
  }
  if (!out.length) return DEFAULT_REDEEM_OPTIONS;
  return out.sort((a, b) => a.points - b.points);
}

/** Points earned for a spend: floor(amount * rate * tier multiplier), never negative. */
export function pointsEarnedFor(
  amountSpent: number,
  pointsPerDollar: number,
  multiplier = 1,
): number {
  const rate =
    Number.isFinite(pointsPerDollar) && pointsPerDollar > 0
      ? pointsPerDollar
      : DEFAULT_POINTS_PER_DOLLAR;
  const boost = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const amount = Number.isFinite(amountSpent) ? amountSpent : 0;
  return Math.max(0, Math.floor(amount * rate * boost));
}

// ------- membership tiers -------

export type MembershipTier = {
  /** Free-form label shown to customers ("Silver"). Can be blank. */
  name: string;
  /** Lifetime points needed to reach this tier. */
  min_lifetime_points: number;
  /** Points earned per dollar are multiplied by this. */
  multiplier: number;
};

/** Mirrors the seeded `rewards.tiers` setting (migration 20250101002600). */
export const DEFAULT_TIERS: MembershipTier[] = [
  { name: 'Member', min_lifetime_points: 0, multiplier: 1 },
  { name: 'Silver', min_lifetime_points: 1000, multiplier: 2 },
  { name: 'Gold', min_lifetime_points: 5000, multiplier: 3 },
];

/**
 * Validates/sorts the jsonb tier ladder. Malformed entries are dropped, the
 * ladder always starts at 0 points, and when two tiers share a threshold the
 * better multiplier wins. Falls back to the default ladder when nothing usable
 * is stored (and the server does the same, see public.reward_multiplier()).
 */
export function parseTiers(raw: unknown): MembershipTier[] {
  if (!Array.isArray(raw)) return DEFAULT_TIERS;
  const byThreshold = new Map<number, MembershipTier>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const min = Math.floor(Number(value.min_lifetime_points ?? 0));
    const multiplier = Number(value.multiplier);
    if (!Number.isFinite(min) || min < 0) continue;
    if (!Number.isFinite(multiplier) || multiplier < 1) continue;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const tier = { name, min_lifetime_points: min, multiplier };
    const existing = byThreshold.get(min);
    if (!existing || existing.multiplier < multiplier) byThreshold.set(min, tier);
  }
  if (!byThreshold.size) return DEFAULT_TIERS;
  if (!byThreshold.has(0)) {
    byThreshold.set(0, { name: '', min_lifetime_points: 0, multiplier: 1 });
  }
  return [...byThreshold.values()].sort(
    (a, b) => a.min_lifetime_points - b.min_lifetime_points || a.multiplier - b.multiplier,
  );
}

/** The tier that applies to a lifetime total. */
export function tierFor(lifetimePoints: number, tiers: MembershipTier[] = DEFAULT_TIERS): MembershipTier {
  const ladder = tiers.length ? tiers : DEFAULT_TIERS;
  const points = Number.isFinite(lifetimePoints) ? Math.max(0, lifetimePoints) : 0;
  let current = ladder[0];
  for (const tier of ladder) {
    if (points >= tier.min_lifetime_points) current = tier;
  }
  return current;
}

/** The next tier up, or null at the top of the ladder. */
export function nextTier(
  lifetimePoints: number,
  tiers: MembershipTier[] = DEFAULT_TIERS,
): MembershipTier | null {
  const ladder = tiers.length ? tiers : DEFAULT_TIERS;
  const points = Number.isFinite(lifetimePoints) ? Math.max(0, lifetimePoints) : 0;
  return ladder.find((tier) => tier.min_lifetime_points > points) ?? null;
}

export type TierProgress = {
  current: MembershipTier;
  next: MembershipTier | null;
  /** Points still needed to reach the next tier (0 at the top). */
  remaining: number;
  /** 0..1 progress between the current threshold and the next one. */
  ratio: number;
};

export function tierProgress(
  lifetimePoints: number,
  tiers: MembershipTier[] = DEFAULT_TIERS,
): TierProgress {
  const points = Number.isFinite(lifetimePoints) ? Math.max(0, lifetimePoints) : 0;
  const current = tierFor(points, tiers);
  const next = nextTier(points, tiers);
  if (!next) return { current, next: null, remaining: 0, ratio: 1 };
  const span = next.min_lifetime_points - current.min_lifetime_points;
  const gained = points - current.min_lifetime_points;
  return {
    current,
    next,
    remaining: Math.max(0, next.min_lifetime_points - points),
    ratio: span > 0 ? Math.min(1, Math.max(0, gained / span)) : 0,
  };
}

/** Extra rules a coupon carries: a minimum spend and/or a single product. */
export function couponConditions(
  coupon: { min_subtotal?: number | null; product_id?: string | null },
  productName: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  const parts: string[] = [];
  const minimum = Number(coupon.min_subtotal);
  if (Number.isFinite(minimum) && minimum > 0) {
    parts.push(t('rewards:coupon_min_spend', { amount: formatMoney(minimum, 'en' as Locale) }));
  }
  if (coupon.product_id && productName) {
    parts.push(t('rewards:coupon_product_scope', { product: productName }));
  }
  return parts;
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
