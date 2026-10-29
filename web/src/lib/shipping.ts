// Delivery fulfilment rules.
//
// The store prices delivery at a flat fee, waived once the merchandise total
// (after any coupon discount) reaches the free-shipping threshold. The SQL
// price_cart function applies the same rule and is authoritative; these
// helpers mirror it for display and form validation.

export type Fulfilment = 'pickup' | 'delivery';

export type DeliveryAddress = {
  recipient: string;
  phone: string;
  line1: string;
  line2: string;
  district: string;
  region: string;
  postal_code: string;
};

/** Flat delivery fee in the location's currency. */
export const DELIVERY_FEE = 50;
/** Merchandise total at or above which delivery is free. */
export const FREE_DELIVERY_THRESHOLD = 500;

export const EMPTY_DELIVERY_ADDRESS: DeliveryAddress = {
  recipient: '',
  phone: '',
  line1: '',
  line2: '',
  district: '',
  region: '',
  postal_code: '',
};

/** Fields a delivery needs before an order can be placed. */
const REQUIRED_ADDRESS_FIELDS: (keyof DeliveryAddress)[] = ['recipient', 'phone', 'line1', 'district'];

/** The delivery fee for a merchandise total, or 0 for pickup. */
export function deliveryFee(merchandiseTotal: number, fulfilment: Fulfilment): number {
  if (fulfilment !== 'delivery') return 0;
  const total = Number.isFinite(merchandiseTotal) ? merchandiseTotal : 0;
  return total >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
}

/** How much more the customer must spend for free delivery (0 when already free). */
export function amountUntilFreeDelivery(merchandiseTotal: number): number {
  const total = Number.isFinite(merchandiseTotal) ? merchandiseTotal : 0;
  return Math.max(0, Math.round((FREE_DELIVERY_THRESHOLD - total) * 100) / 100);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads a stored/cart address defensively into a complete shape. */
export function parseDeliveryAddress(raw: unknown): DeliveryAddress {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DELIVERY_ADDRESS };
  const value = raw as Record<string, unknown>;
  return {
    recipient: text(value.recipient),
    phone: text(value.phone),
    line1: text(value.line1),
    line2: text(value.line2),
    district: text(value.district),
    region: text(value.region),
    postal_code: text(value.postal_code),
  };
}

/** True when the address has everything a courier needs. */
export function addressIsComplete(address: DeliveryAddress | null | undefined): boolean {
  if (!address) return false;
  return REQUIRED_ADDRESS_FIELDS.every((field) => address[field].trim().length > 0);
}

/** Which required fields are still missing, for inline form hints. */
export function missingAddressFields(address: DeliveryAddress | null | undefined): (keyof DeliveryAddress)[] {
  const value = address ?? EMPTY_DELIVERY_ADDRESS;
  return REQUIRED_ADDRESS_FIELDS.filter((field) => !value[field].trim());
}

/** One-line address summary for confirmations and staff screens. */
export function formatDeliveryAddress(address: DeliveryAddress | null | undefined): string {
  if (!address) return '';
  return [address.line1, address.line2, address.district, address.region, address.postal_code]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}
