// Sale prices live next to the regular price with an optional start/end window.
// The database decides what is actually charged (public.effective_price inside
// price_cart); these helpers mirror that rule so the storefront can strike the
// regular price out before a cart has been priced, and so the admin preview
// matches what a customer will pay.

import type { SaleFields } from '@/lib/types';

export type SaleRow = Partial<SaleFields> | null | undefined;

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  // An unparseable bound is treated as "not set" rather than closing the sale.
  return Number.isNaN(parsed) ? null : parsed;
}

/** Is the sale window open? A missing bound means open ended. */
export function saleWindowOpen(starts?: string | null, ends?: string | null, now: Date = new Date()): boolean {
  const start = timestamp(starts);
  const end = timestamp(ends);
  if (start !== null && start > now.getTime()) return false;
  if (end !== null && end <= now.getTime()) return false;
  return true;
}

/** Does this row have a sale price to show right now? */
export function isOnSale(row: SaleRow, now: Date = new Date()): boolean {
  return row?.sale_price != null && saleWindowOpen(row.sale_starts_at, row.sale_ends_at, now);
}

/** The price a customer pays: the sale price while its window is open. */
export function effectivePrice(regular: number, row: SaleRow, now: Date = new Date()): number {
  if (!isOnSale(row, now)) return regular;
  const sale = Number(row?.sale_price);
  return Number.isFinite(sale) ? sale : regular;
}

/** What was saved per unit, for "save HK$X" copy. Never negative. */
export function saleSaving(regular: number, row: SaleRow, now: Date = new Date()): number {
  if (!isOnSale(row, now)) return 0;
  return Math.max(0, Math.round((regular - effectivePrice(regular, row, now)) * 100) / 100);
}

/**
 * A sale discounts the row's own price only. When a price already bundles other
 * things (a "from" price, or base + material + option modifiers), shift it by
 * the same discount instead of replacing it.
 */
export function shiftedBySale(
  regular: number,
  row: (SaleRow & { base_price?: number; price_modifier?: number }) | null | undefined,
  now: Date = new Date(),
): number {
  if (!isOnSale(row, now)) return regular;
  const listPrice = Number(row?.base_price ?? row?.price_modifier ?? 0);
  const discount = listPrice - Number(row?.sale_price);
  if (!Number.isFinite(discount) || discount <= 0) return regular;
  return Math.max(0, Math.round((regular - discount) * 100) / 100);
}
