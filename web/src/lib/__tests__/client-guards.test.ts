import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards for mistakes that typecheck, lint and build cleanly but break the
// static export or the deployed site. Each one codifies a trap that has bitten
// this repo before; see the checklist at the end of AGENTS.md.

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_DIR = path.join(SOURCE_DIR, 'app');

function sourceFiles(dir = SOURCE_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

/** Source files with comments removed, so prose about a trap is not a hit. */
const sources = sourceFiles()
  .filter((file) => !path.relative(SOURCE_DIR, file).includes('__tests__/'))
  .map((file) => ({
    relative: path.relative(SOURCE_DIR, file),
    code: readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1'),
  }));

describe('client environment', () => {
  // Next only inlines NEXT_PUBLIC_* (and NODE_ENV) into the browser bundle;
  // anything else reads as undefined at runtime instead of failing the build.
  it('only reads inlinable environment variables', () => {
    const allowed = /^(NEXT_PUBLIC_|NODE_ENV$)/;
    const offending = sources.flatMap(({ relative, code }) =>
      [...code.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)]
        .map((match) => match[1])
        .filter((name) => !allowed.test(name))
        .map((name) => `${name} (${relative})`));
    expect([...new Set(offending)], 'Only NEXT_PUBLIC_* values reach the browser; move secrets to an Edge Function')
      .toEqual([]);
  });
});

describe('static export links', () => {
  // <Link> and <Image> add basePath for you; a raw tag with "/…" does not, so
  // it 404s on a project Pages site (the build still succeeds).
  it('does not hand-write root-relative URLs on raw tags', () => {
    const offending = sources.flatMap(({ relative, code }) => {
      const hits: string[] = [];
      for (const match of code.matchAll(/<(?:a|img|script|link)\b[^>]*?\s(?:href|src)="\/[^"]*"/g)) {
        hits.push(`${match[0].trim()} (${relative})`);
      }
      return hits;
    });
    expect(offending, 'Use next/link, next/image, or withBasePath() so the URL keeps the deployment prefix')
      .toEqual([]);
  });

  it('only links to routes that exist', () => {
    const dead = sources.flatMap(({ relative, code }) =>
      [...code.matchAll(/href="(\/[^"]*)"/g)]
        .map((match) => match[1].split('#')[0].split('?')[0])
        .filter((route) => route !== '/' && !existsSync(path.join(APP_DIR, route, 'page.tsx')))
        .map((route) => `${route} (${relative})`));
    expect([...new Set(dead)], 'Point the link at an existing app/<route>/page.tsx or remove it')
      .toEqual([]);
  });
});

describe('money formatting', () => {
  // Currency lives on the location row; a literal symbol is wrong the moment a
  // second currency exists and cannot be localised. formatMoney() handles both.
  it('formats prices through formatMoney instead of a hard-coded symbol', () => {
    const offending = sources.flatMap(({ relative, code }) =>
      [...code.matchAll(/HK\$|US\$|[€£¥]|\$\d/g)]
        .map((match) => `${match[0]} (${relative})`));
    expect([...new Set(offending)], 'Use formatMoney(amount, locale, currency) from lib/format')
      .toEqual([]);
  });
});
