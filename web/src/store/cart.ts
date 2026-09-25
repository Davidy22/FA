'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLineInput } from '@/lib/types';

interface CartState {
  location_id: string | null;
  items: CartLineInput[];
  setLocation(id: string | null): void;
  addItem(line: CartLineInput): void;
  removeItem(index: number): void;
  updateQuantity(index: number, qty: number): void;
  clear(): void;
  setItems(items: CartLineInput[]): void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      location_id: null,
      items: [],
      setLocation: (id) => set({ location_id: id }),
      addItem: (line) => set((s) => ({ items: [...s.items, line] })),
      removeItem: (i) => set((s) => ({ items: s.items.filter((_, idx) => idx !== i) })),
      updateQuantity: (i, qty) => set((s) => ({
        items: s.items.map((it, idx) => (idx === i ? { ...it, quantity: Math.max(1, Math.min(99, qty)) } : it)),
      })),
      clear: () => set({ items: [] }),
      setItems: (items) => set({ items }),
    }),
    { name: 'fab.cart' }
  )
);
