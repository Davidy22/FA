import type { Localized } from './types';

export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;

export function localizedInput(value: Localized | null | undefined): Localized {
  return { en: value?.en || '', 'zh-Hant': value?.['zh-Hant'] || '', 'zh-Hans': value?.['zh-Hans'] || '' };
}

/** Empty translations are omitted so the normal English fallback works. */
export function cleanLocalized(value: Localized, label: string, optional = false): Localized | null {
  const en = value.en.trim();
  if (!en) {
    if (optional && !value['zh-Hant']?.trim() && !value['zh-Hans']?.trim()) return null;
    throw new Error(`${label}: English is required.`);
  }
  return {
    en,
    ...(value['zh-Hant']?.trim() ? { 'zh-Hant': value['zh-Hant'].trim() } : {}),
    ...(value['zh-Hans']?.trim() ? { 'zh-Hans': value['zh-Hans'].trim() } : {}),
  };
}

export function decimal(value: string, label: string, min: number, max: number, integer = false): number {
  if (value.trim() === '') throw new Error(`${label} is required.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
  }
  return n;
}

/** A timestamptz column as a value a datetime-local input accepts. */
export function localDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** A datetime-local input value back to UTC for the database; empty means unset. */
export function isoDateTime(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function lines(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

/** Edge Functions return a generic HTTP error; prefer the actual JSON error if available. */
export async function adminError(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (typeof body?.error === 'string') return body.error;
    } catch { /* The response need not be JSON. */ }
  }
  return error instanceof Error ? error.message : String(error);
}
