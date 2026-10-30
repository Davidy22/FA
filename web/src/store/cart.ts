'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLineInput } from '@/lib/types';
import { EMPTY_DELIVERY_ADDRESS, type DeliveryAddress, type Fulfilment } from '@/lib/shipping';

const CART_KINDS: CartLineInput['kind'][] = ['premade', 'custom', 'document', 'ticket'];

/**
 * `ma.cart` outlives deployments, so an older payload (a line added before
 * `kind`/`slots` existed, or a hand-edited value) would otherwise reach
 * `price_cart` and the cart page as a half-formed line. Everything that comes
 * out of storage is treated as untrusted input.
 */
function sanitizeLine(value: unknown): CartLineInput | null {
  if (!value || typeof value !== 'object') return null;
  const line = value as Record<string, unknown>;
  if (!CART_KINDS.includes(line.kind as CartLineInput['kind'])) return null;
  const quantity = Math.floor(Number(line.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) return null;
  return { ...(line as unknown as CartLineInput), quantity: Math.min(99, quantity) };
}

function sanitizeAddress(value: unknown): DeliveryAddress {
  const address = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const field = (key: keyof DeliveryAddress) =>
    typeof address[key] === 'string' ? (address[key] as string) : '';
  return {
    ...EMPTY_DELIVERY_ADDRESS,
    ...Object.fromEntries(
      (Object.keys(EMPTY_DELIVERY_ADDRESS) as (keyof DeliveryAddress)[]).map((key) => [key, field(key)]),
    ),
  } as DeliveryAddress;
}

export function sanitizePersistedCart(value: unknown): Partial<CartState> {
  const state = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    location_id: typeof state.location_id === 'string' ? state.location_id : null,
    items: Array.isArray(state.items)
      ? state.items.map(sanitizeLine).filter((line): line is CartLineInput => line !== null)
      : [],
    coupon_code: typeof state.coupon_code === 'string' ? state.coupon_code : null,
    note: typeof state.note === 'string' ? state.note : '',
    fulfilment: state.fulfilment === 'delivery' ? 'delivery' : 'pickup',
    delivery_address: sanitizeAddress(state.delivery_address),
  };
}

interface CartState {
  location_id: string | null;
  items: CartLineInput[];
  coupon_code: string | null;
  note: string;
  /** Collection at the location, or delivery to `delivery_address`. */
  fulfilment: Fulfilment;
  delivery_address: DeliveryAddress;
  setLocation(id: string | null): void;
  addItem(line: CartLineInput): void;
  removeItem(index: number): void;
  updateQuantity(index: number, qty: number): void;
  /** Replace part of a line, e.g. the material/colour/option picks. */
  updateItem(index: number, patch: Partial<CartLineInput>): void;
  setCoupon(code: string | null): void;
  setNote(note: string): void;
  setFulfilment(fulfilment: Fulfilment): void;
  setDeliveryAddress(address: DeliveryAddress): void;
  clear(): void;
  setItems(items: CartLineInput[]): void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      location_id: null,
      items: [],
      coupon_code: null,
      note: '',
      fulfilment: 'pickup',
      delivery_address: { ...EMPTY_DELIVERY_ADDRESS },
      setLocation: (id) => set({ location_id: id }),
      addItem: (line) => set((s) => ({ items: [...s.items, line] })),
      removeItem: (i) => set((s) => ({ items: s.items.filter((_, idx) => idx !== i) })),
      updateQuantity: (i, qty) => set((s) => ({
        items: s.items.map((it, idx) => (idx === i ? { ...it, quantity: Math.max(1, Math.min(99, qty)) } : it)),
      })),
      updateItem: (i, patch) => set((s) => ({
        items: s.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
      })),
      setCoupon: (code) => set({ coupon_code: code ? code.toUpperCase() : null }),
      setNote: (note) => set({ note }),
      setFulfilment: (fulfilment) => set({ fulfilment }),
      setDeliveryAddress: (delivery_address) => set({ delivery_address }),
      clear: () => set({ items: [], coupon_code: null, note: '', fulfilment: 'pickup' }),
      setItems: (items) => set({ items }),
    }),
    {
      name: 'ma.cart',
      version: 1,
      // Shape changed when delivery and per-line options landed; older payloads
      // are repaired rather than thrown away.
      migrate: (persisted) => sanitizePersistedCart(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedCart(persisted) }),
    }
  )
);
