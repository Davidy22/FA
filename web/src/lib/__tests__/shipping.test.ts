import { describe, expect, it } from 'vitest';
import {
  DELIVERY_FEE,
  FREE_DELIVERY_THRESHOLD,
  addressIsComplete,
  amountUntilFreeDelivery,
  deliveryFee,
  formatDeliveryAddress,
  missingAddressFields,
  parseDeliveryAddress,
} from '@/lib/shipping';

describe('deliveryFee', () => {
  it('charges nothing for pickup', () => {
    expect(deliveryFee(0, 'pickup')).toBe(0);
    expect(deliveryFee(100, 'pickup')).toBe(0);
  });

  it('charges the flat fee below the free-shipping threshold', () => {
    expect(deliveryFee(0, 'delivery')).toBe(DELIVERY_FEE);
    expect(deliveryFee(FREE_DELIVERY_THRESHOLD - 0.01, 'delivery')).toBe(DELIVERY_FEE);
  });

  it('is free from the threshold up', () => {
    expect(deliveryFee(FREE_DELIVERY_THRESHOLD, 'delivery')).toBe(0);
    expect(deliveryFee(5000, 'delivery')).toBe(0);
  });
});

describe('amountUntilFreeDelivery', () => {
  it('reports the remaining spend and never goes negative', () => {
    expect(amountUntilFreeDelivery(200)).toBe(300);
    expect(amountUntilFreeDelivery(600)).toBe(0);
  });
});

describe('delivery addresses', () => {
  const address = {
    recipient: 'Ada',
    phone: '1234 5678',
    line1: '1 Example Road',
    line2: 'Flat 2A',
    district: 'Central',
    region: 'HK',
    postal_code: '',
  };

  it('requires recipient, phone, street and district', () => {
    expect(addressIsComplete(address)).toBe(true);
    expect(addressIsComplete({ ...address, phone: '  ' })).toBe(false);
    expect(missingAddressFields({ ...address, recipient: '', district: '' }))
      .toEqual(['recipient', 'district']);
  });

  it('parses junk into an empty address', () => {
    expect(parseDeliveryAddress(null).line1).toBe('');
    expect(parseDeliveryAddress({ line1: '  5 Road ', district: 42 }).line1).toBe('5 Road');
  });

  it('formats the non-empty parts', () => {
    expect(formatDeliveryAddress(address)).toBe('1 Example Road, Flat 2A, Central, HK');
    expect(formatDeliveryAddress(null)).toBe('');
  });
});
