'use client';
import { useEffect } from 'react';
import { applyTheme, onAppearanceChange } from '@/lib/theme';

/**
 * Applies the saved light/dark preference on every page. Mounted once in the
 * root layout; the account page's AppearanceSelect only changes the value.
 */
export function ThemeSync() {
  useEffect(() => {
    applyTheme();
    return onAppearanceChange(() => applyTheme());
  }, []);
  return null;
}
