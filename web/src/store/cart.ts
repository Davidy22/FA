'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLineInput } from '@/lib/types';

interface CartState {
  location_id: string | null;
  items: CartLineInput[];
  coupon_code: string | null;
  note: string;
  setLocation(id: string | null): void;
  addItem(line: CartLineInput): void;
  removeItem(index: number): void;
  updateQuantity(index: number, qty: number): void;
  setCoupon(code: string | null): void;
  setNote(note: string): void;
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
      setLocation: (id) => set({ location_id: id }),
      addItem: (line) => set((s) => ({ items: [...s.items, line] })),
      removeItem: (i) => set((s) => ({ items: s.items.filter((_, idx) => idx !== i) })),
      updateQuantity: (i, qty) => set((s) => ({
        items: s.items.map((it, idx) => (idx === i ? { ...it, quantity: Math.max(1, Math.min(99, qty)) } : it)),
      })),
      setCoupon: (code) => set({ coupon_code: code ? code.toUpperCase() : null }),
      setNote: (note) => set({ note }),
      clear: () => set({ items: [], coupon_code: null, note: '' }),
      setItems: (items) => set({ items }),
    }),
    { name: 'ma.cart' }
  )
);
