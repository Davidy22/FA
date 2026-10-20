import { describe, expect, it } from 'vitest';
import { effectivePrice, isOnSale, saleSaving, saleWindowOpen, shiftedBySale } from '@/lib/sale';

const now = new Date('2026-03-01T12:00:00Z');
const iso = (offsetHours: number) => new Date(now.getTime() + offsetHours * 3_600_000).toISOString();

describe('sale windows', () => {
  it('treats missing bounds as open ended', () => {
    expect(saleWindowOpen(null, null, now)).toBe(true);
    expect(saleWindowOpen(undefined, undefined, now)).toBe(true);
  });

  it('opens at the start and closes at the end', () => {
    expect(saleWindowOpen(iso(1), null, now)).toBe(false);
    expect(saleWindowOpen(iso(-1), null, now)).toBe(true);
    expect(saleWindowOpen(null, iso(-1), now)).toBe(false);
    expect(saleWindowOpen(null, iso(1), now)).toBe(true);
    // The end bound is exclusive, matching public.sale_window_open.
    expect(saleWindowOpen(null, now.toISOString(), now)).toBe(false);
  });

  it('ignores an unparseable bound instead of closing the sale', () => {
    expect(saleWindowOpen('not a date', 'also not a date', now)).toBe(true);
  });
});

describe('isOnSale / effectivePrice', () => {
  it('is off without a sale price', () => {
    expect(isOnSale({ sale_price: null, sale_starts_at: null, sale_ends_at: null }, now)).toBe(false);
    expect(isOnSale(null, now)).toBe(false);
    expect(isOnSale({}, now)).toBe(false);
    expect(effectivePrice(8, { sale_price: null }, now)).toBe(8);
  });

  it('charges the sale price inside the window only', () => {
    const row = { sale_price: 6, sale_starts_at: iso(-24), sale_ends_at: iso(24) };
    expect(isOnSale(row, now)).toBe(true);
    expect(effectivePrice(8, row, now)).toBe(6);
    expect(effectivePrice(8, { ...row, sale_starts_at: iso(24) }, now)).toBe(8);
    expect(effectivePrice(8, { ...row, sale_ends_at: iso(-24) }, now)).toBe(8);
  });

  it('applies to option choice modifiers too', () => {
    const large = { price_modifier: 5, sale_price: 2.5, sale_starts_at: null, sale_ends_at: null };
    expect(effectivePrice(large.price_modifier, large, now)).toBe(2.5);
    expect(saleSaving(large.price_modifier, large, now)).toBe(2.5);
  });
});

describe('saleSaving', () => {
  it('is zero when no sale is running and never negative', () => {
    expect(saleSaving(8, { sale_price: null }, now)).toBe(0);
    expect(saleSaving(8, { sale_price: 9 }, now)).toBe(0);
    expect(saleSaving(8, { sale_price: 6 }, now)).toBe(2);
    expect(saleSaving(8.5, { sale_price: 6.25 }, now)).toBe(2.25);
  });
});

describe('shiftedBySale', () => {
  it('moves a bundled price by the sale discount', () => {
    // A "from" price of 10 on a product whose base is 8 and sale is 6 → 8.
    expect(shiftedBySale(10, { base_price: 8, sale_price: 6 }, now)).toBe(8);
    // Base + material + option modifiers: only the base part is discounted.
    expect(shiftedBySale(19.5, { base_price: 8, sale_price: 6 }, now)).toBe(17.5);
  });

  it('leaves the price alone when the sale is not running or not cheaper', () => {
    expect(shiftedBySale(10, { base_price: 8, sale_price: 6, sale_starts_at: iso(24) }, now)).toBe(10);
    expect(shiftedBySale(10, { base_price: 8, sale_price: null }, now)).toBe(10);
    expect(shiftedBySale(10, { base_price: 8, sale_price: 8 }, now)).toBe(10);
  });

  it('discounts an option choice modifier by its own sale', () => {
    expect(shiftedBySale(14, { price_modifier: 5, sale_price: 2.5 }, now)).toBe(11.5);
  });

  it('never returns a negative price', () => {
    expect(shiftedBySale(1, { base_price: 8, sale_price: 0 }, now)).toBe(0);
  });
});
