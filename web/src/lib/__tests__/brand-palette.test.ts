import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../../tailwind.config';

// Tailwind silently emits nothing for a colour step missing from the theme, so
// a `border-brand-200` that is not in the palette looks fine in review and
// renders the default border colour instead. These checks keep the brand ramp
// (and its dark-mode remaps) in step with the classes the app actually uses.

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GLOBALS_CSS = path.join(SOURCE_DIR, 'app/globals.css');
const BRAND = (tailwindConfig.theme?.extend?.colors as Record<string, Record<string, string>>).brand;
const UTILITY = /([a-z-]+)-brand-(\d+)(\/\d+)?/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [entryPath] : [];
  });
}

/** Every `prefix-brand-shade` used in the source, e.g. `border-brand-200`. */
const used = new Map<string, string>(); // utility -> first file that uses it
for (const file of sourceFiles(SOURCE_DIR)) {
  const relative = path.relative(SOURCE_DIR, file);
  if (relative.startsWith('lib/__tests__/brand-palette')) continue;
  for (const [, prefix, shade, alpha] of readFileSync(file, 'utf8').matchAll(UTILITY)) {
    const utility = `${prefix}-brand-${shade}${alpha ?? ''}`;
    if (!used.has(utility)) used.set(utility, relative);
  }
}

describe('brand palette', () => {
  it('finds brand utilities in the source (guards the scanner itself)', () => {
    expect(used.size).toBeGreaterThan(10);
  });

  it('defines every brand shade the app uses', () => {
    const missing = [...used]
      .filter(([utility]) => !(utility.replace(/^.*-brand-/, '').split('/')[0] in BRAND))
      .map(([utility, file]) => `${utility} (${file})`);
    expect(missing, 'Add the missing steps to theme.extend.colors.brand in tailwind.config.ts')
      .toEqual([]);
  });

  it('covers the whole 50–900 ramp so any step is safe to reach for', () => {
    expect(Object.keys(BRAND).sort((a, b) => Number(a) - Number(b)))
      .toEqual(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']);
  });

  // A pale brand fill is a surface in light mode; without a dark-mode remap it
  // glows against the dark page. See the data-theme="dark" block in globals.css.
  it('remaps pale brand backgrounds for dark mode', () => {
    const darkSelectors = [...readFileSync(GLOBALS_CSS, 'utf8')
      .matchAll(/html\[data-theme="dark"\]([^{]+)\{/g)]
      .map((match) => match[1])
      .join(' ');
    const pale = [...used.keys()].filter((utility) =>
      utility.startsWith('bg-brand-') && Number(utility.replace(/^bg-brand-/, '').split('/')[0]) <= 200);
    const missing = pale.filter((utility) =>
      !new RegExp(`(?<![A-Za-z0-9_-])${utility}(?![A-Za-z0-9_/-])`).test(darkSelectors));
    expect(missing, 'Add the pale brand background to the dark-mode block in app/globals.css')
      .toEqual([]);
  });
});
