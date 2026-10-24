// How a filament looks, not just its colour.
//
// A filament may carry a finish (standard, matte, silk, wood fill, marble,
// gradient, glow, translucent, metallic, carbon fibre, or anything an admin
// adds later) and an optional second colour for two-tone spools. The storefront
// turns those fields into one CSS swatch, so "wood" reads as a grain and
// "gradient" as a blend instead of a flat square.

import type { CSSProperties } from 'react';
import type { Localized } from './types';
import { t_db } from './format';
import type { Locale } from './i18n';

type FilamentSwatchInput = {
  color_hex?: string | null;
  color_hex_2?: string | null;
  finish?: string | null;
};

const FALLBACK = '#cbd5e1';

function toRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Mix a colour towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const rgb = toRgb(hex);
  if (!rgb) return hex;
  const target = amount >= 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  return toHex(rgb.map((channel) => channel + (target - channel) * ratio) as [number, number, number]);
}

export function alpha(hex: string, value: number): string {
  const rgb = toRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${value})`;
}

/** The normalised colour pair; an unknown/missing hex falls back to grey. */
export function filamentColors(filament: FilamentSwatchInput): [string, string | null] {
  const first = filament.color_hex && toRgb(filament.color_hex) ? filament.color_hex : FALLBACK;
  const second = filament.color_hex_2 && toRgb(filament.color_hex_2) ? filament.color_hex_2 : null;
  return [first, second];
}

/**
 * A CSS background that represents the filament's finish. Always returns a
 * concrete colour so an empty swatch is never invisible.
 */
export function filamentSwatchStyle(filament: FilamentSwatchInput): CSSProperties {
  const [base, second] = filamentColors(filament);
  const finish = (filament.finish || 'standard').toLowerCase();

  switch (finish) {
    case 'gradient':
      return { background: `linear-gradient(135deg, ${base} 0%, ${second ?? shade(base, 0.45)} 55%, ${shade(second ?? base, -0.15)} 100%)` };
    case 'marble':
      return {
        background:
          `linear-gradient(120deg, ${base} 0 38%, ${second ?? shade(base, 0.55)} 38% 58%, ${base} 58% 100%)`,
      };
    case 'wood':
      return {
        background:
          `repeating-linear-gradient(95deg, ${shade(base, -0.18)} 0 2px, ${base} 2px 5px, ${shade(base, 0.2)} 5px 6px)`,
      };
    case 'silk':
    case 'metallic':
      return {
        background: `linear-gradient(130deg, ${shade(base, 0.55)} 0%, ${base} 42%, ${shade(base, 0.75)} 62%, ${shade(base, 0.1)} 100%)`,
      };
    case 'glow':
      return {
        backgroundColor: base,
        backgroundImage: `radial-gradient(circle at 30% 28%, ${alpha(shade(base, 0.85), 0.95)} 0%, ${alpha(base, 0.25)} 45%, transparent 72%)`,
      };
    case 'translucent':
      return { backgroundColor: alpha(base, 0.45) };
    case 'carbon':
      return {
        background:
          `repeating-conic-gradient(${shade(base, -0.35)} 0% 25%, ${base} 0% 50%) 50% / 6px 6px`,
      };
    default:
      return { backgroundColor: base };
  }
}

/** The finish name from the database, falling back to a readable slug. */
export function finishLabel(
  finishName: Localized | null | undefined,
  finish: string | null | undefined,
  locale: Locale,
): string {
  const name = t_db(finishName, locale);
  if (name) return name;
  if (!finish) return '';
  return finish.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** "Silk / shiny" — finish only when it adds information beyond the colour. */
export function describeFilament(
  filament: FilamentSwatchInput & { finish_name?: Localized | null },
  locale: Locale,
): string {
  const label = finishLabel(filament.finish_name, filament.finish, locale);
  if (!label || (filament.finish || 'standard') === 'standard') return '';
  return label;
}
