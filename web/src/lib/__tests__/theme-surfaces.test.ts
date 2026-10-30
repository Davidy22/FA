import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../../tailwind.config';

// The app themes itself with utilities in the markup plus a hand-written
// `html[data-theme="dark"]` block in app/globals.css. Two things fail silently:
//
//  1. Tailwind emits nothing for a shade missing from the theme, so
//     `border-brand-200` looks fine in review and renders as the default colour.
//  2. A pale fill (or dark text) with no dark-mode remap stays light on a dark
//     page — the worst case is amber/green status text at 1.2:1 contrast.
//
// These checks compare the classes `src/` actually uses against both sources so
// a new surface colour fails `pnpm test` instead of shipping invisible.

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GLOBALS_CSS = path.join(SOURCE_DIR, 'app/globals.css');
const BRAND = (tailwindConfig.theme?.extend?.colors as Record<string, Record<string, string>>).brand;

/** Palettes with their own dark-mode story, or no colour at all. */
const THEME_MANAGED = new Set(['brand', 'slate', 'white', 'black', 'transparent', 'current', 'inherit']);
/** Utilities are scanned with an optional variant prefix: `hover:bg-red-50`. */
const UTILITY = /\b((?:[a-z-]+:)?(?:bg|text|border)-([a-z]+)-(\d{1,3})(?:\/\d+)?)\b/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

/** utility -> first file that uses it, for every colour utility in `src/`. */
const used = new Map<string, string>();
for (const file of sourceFiles(SOURCE_DIR)) {
  const relative = path.relative(SOURCE_DIR, file);
  if (relative.startsWith('lib/__tests__/')) continue;
  for (const [, utility, palette] of readFileSync(file, 'utf8').matchAll(UTILITY)) {
    // `border-b-2` and friends match the shape of a colour utility but are
    // sides/widths; every Tailwind palette name is at least three letters.
    if (palette.length < 3 || THEME_MANAGED.has(palette) || used.has(utility)) continue;
    used.set(utility, relative);
  }
}

const globalsCss = readFileSync(GLOBALS_CSS, 'utf8');
/** Every selector in the dark-mode block, including the grouped ones. */
const darkSelectors = [...globalsCss.matchAll(/html\[data-theme="dark"\]([^{]+)\{/g)]
  .map((match) => match[1])
  .join(' ');

/**
 * Is there a dark-mode rule for this exact utility? The class-boundary guard
 * matters: `bg-brand-50` must not be satisfied by a `bg-brand-50/30` rule.
 */
function hasDarkRule(utility: string): boolean {
  const escaped = utility.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_/-])`).test(darkSelectors);
}

const shade = (utility: string) => Number(utility.replace(/^.*-[a-z]+-/, '').split('/')[0]);

describe('brand palette', () => {
  it('finds colour utilities in the source (guards the scanner itself)', () => {
    expect(used.size).toBeGreaterThan(20);
  });

  it('defines every brand shade the app uses', () => {
    const brandUtilities = [...used].filter(([utility]) => /-[a-z-]*-?brand-\d+/.test(utility));
    const missing = brandUtilities
      .filter(([utility]) => !(utility.replace(/^.*-brand-/, '').split('/')[0] in BRAND))
      .map(([utility, file]) => `${utility} (${file})`);
    expect(missing, 'Add the missing steps to theme.extend.colors.brand in tailwind.config.ts')
      .toEqual([]);
  });

  it('covers the whole 50–900 ramp so any step is safe to reach for', () => {
    expect(Object.keys(BRAND).sort((a, b) => Number(a) - Number(b)))
      .toEqual(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']);
  });
});

describe('dark mode surfaces', () => {
  it('remaps pale backgrounds (50–200) for every palette', () => {
    const missing = [...used.keys()]
      .filter((utility) => /(^|:)bg-/.test(utility) && shade(utility) <= 200)
      .filter((utility) => !hasDarkRule(utility))
      .map((utility) => `${utility} (${used.get(utility)})`);
    expect(missing, 'Add a html[data-theme="dark"] rule to app/globals.css for each pale fill')
      .toEqual([]);
  });

  it('lightens dark text (600–900) so it stays readable', () => {
    const missing = [...used.keys()]
      .filter((utility) => /(^|:)text-/.test(utility) && shade(utility) >= 600)
      .filter((utility) => !hasDarkRule(utility))
      .map((utility) => `${utility} (${used.get(utility)})`);
    expect(missing, 'Add a html[data-theme="dark"] rule to app/globals.css for each dark text colour')
      .toEqual([]);
  });

  it('darkens pale borders so cards do not glow', () => {
    const missing = [...used.keys()]
      .filter((utility) => /(^|:)border-/.test(utility) && shade(utility) <= 300)
      .filter((utility) => !hasDarkRule(utility))
      .map((utility) => `${utility} (${used.get(utility)})`);
    expect(missing, 'Add a html[data-theme="dark"] rule to app/globals.css for each pale border')
      .toEqual([]);
  });
});
