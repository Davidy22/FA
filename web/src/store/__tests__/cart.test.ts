import { describe, expect, it } from 'vitest';
import { sanitizePersistedCart } from '@/store/cart';

// `ma.cart` survives deployments, so a payload written by an older build (or
// edited by hand) must not reach price_cart as a half-formed line.
describe('sanitizePersistedCart', () => {
  it('keeps a well-formed cart', () => {
    const clean = sanitizePersistedCart({
      location_id: 'loc-1',
      items: [{ kind: 'premade', product_id: 'p1', quantity: 2 }],
      coupon_code: 'WELCOME10',
      note: 'gift wrap',
      fulfilment: 'delivery',
      delivery_address: { line1: '1 Test Road', district: 'Central', region: 'HK' },
    });
    expect(clean.items).toHaveLength(1);
    expect(clean.items?.[0]).toMatchObject({ kind: 'premade', quantity: 2 });
    expect(clean.coupon_code).toBe('WELCOME10');
    expect(clean.fulfilment).toBe('delivery');
    expect(clean.delivery_address).toMatchObject({ line1: '1 Test Road', region: 'HK' });
  });

  it('drops lines from an older shape instead of trusting them', () => {
    const clean = sanitizePersistedCart({
      items: [
        { product_id: 'no-kind', quantity: 1 },       // pre-`kind` payload
        { kind: 'premade', quantity: 0 },              // impossible quantity
        { kind: 'nonsense', quantity: 1 },
        null,
        'garbage',
        { kind: 'document', quantity: 1.7, pages: 3 },
      ],
    });
    expect(clean.items).toHaveLength(1);
    expect(clean.items?.[0]).toMatchObject({ kind: 'document', pages: 3, quantity: 1 });
  });

  it('clamps quantity and replaces junk fields with defaults', () => {
    const clean = sanitizePersistedCart({
      location_id: 42,
      items: [{ kind: 'premade', quantity: 5000 }],
      note: { not: 'a string' },
      fulfilment: 'teleport',
      delivery_address: 'nope',
    });
    expect(clean.location_id).toBeNull();
    expect(clean.items?.[0].quantity).toBe(99);
    expect(clean.note).toBe('');
    expect(clean.fulfilment).toBe('pickup');
    expect(clean.delivery_address).toEqual(expect.objectContaining({ line1: '' }));
  });

  it('survives a missing or non-object payload', () => {
    for (const value of [undefined, null, 'text', 7, []]) {
      const clean = sanitizePersistedCart(value);
      expect(clean.items).toEqual([]);
      expect(clean.fulfilment).toBe('pickup');
    }
  });
});
