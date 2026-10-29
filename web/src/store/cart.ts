'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLineInput } from '@/lib/types';
import { EMPTY_DELIVERY_ADDRESS, type DeliveryAddress, type Fulfilment } from '@/lib/shipping';

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
    { name: 'ma.cart' }
  )
);
