// Checks key parity across the three locale bundles. Fails if any locale is missing a key
// or has extras, per spec 10.3 CI key parity check.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('web/src/i18n/locales');
const LOCALES = ['en','zh-Hant','zh-Hans'];
const NAMESPACES = ['common','catalog','quote','cart','checkout','orders','creator','employee','admin','errors'];

function flatten(obj, prefix = '') {
  const out = [];
  for (const [k,v] of Object.entries(obj || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, p));
    else out.push(p);
  }
  return out.sort();
}

let fail = 0;
for (const ns of NAMESPACES) {
  const bundles = {};
  for (const l of LOCALES) {
    const f = path.join(ROOT, l, `${ns}.json`);
    const txt = fs.readFileSync(f, 'utf8');
    bundles[l] = flatten(JSON.parse(txt));
  }
  const en = new Set(bundles.en);
  for (const l of LOCALES) {
    if (l === 'en') continue;
    const keys = new Set(bundles[l]);
    const missing = [...en].filter(k => !keys.has(k));
    const extra = [...keys].filter(k => !en.has(k));
    if (missing.length) {
      console.error(`✗ [${ns}] ${l} missing keys:`, missing);
      fail++;
    }
    if (extra.length) {
      console.error(`✗ [${ns}] ${l} has extra keys:`, extra);
      fail++;
    }
  }
}
if (fail) {
  console.error(`${fail} i18n parity issues found.`);
  process.exit(1);
}
console.log('✓ i18n key parity OK across', NAMESPACES.length, 'namespaces,', LOCALES.length, 'locales.');
