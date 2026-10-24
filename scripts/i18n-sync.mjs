// Synchronize non-English bundles with the English source without discarding
// existing translations. New keys are explicitly reported because they are
// filled with English and still need a translator's review.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('web/src/i18n/locales');
const TARGETS = ['zh-Hant', 'zh-Hans'];
const CHECK = process.argv.includes('--check');
const sinceIndex = process.argv.indexOf('--since');
const SINCE = sinceIndex >= 0 ? process.argv[sinceIndex + 1] : null;
if (sinceIndex >= 0 && !SINCE) {
  console.error('Usage: node scripts/i18n-sync.mjs [--check] [--since <git-ref>]');
  process.exit(2);
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function flatten(value, prefix = '', out = {}) {
  for (const [key, child] of Object.entries(value || {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isObject(child)) flatten(child, name, out);
    else out[name] = child;
  }
  return out;
}

function placeholders(value) {
  return typeof value === 'string'
    ? [...value.matchAll(/{{\s*([A-Za-z0-9_]+)\s*}}/g)].map((match) => match[1]).sort()
    : [];
}

/** Rebuild in English key order, copying missing values and dropping extras. */
function synchronize(source, target, prefix, report) {
  if (isObject(source)) {
    const existing = isObject(target) ? target : {};
    if (target !== undefined && !isObject(target)) report.changed.push(prefix);
    const output = {};
    for (const key of Object.keys(source)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (!(key in existing)) report.missing.push(name);
      output[key] = synchronize(source[key], existing[key], name, report);
    }
    for (const key of Object.keys(existing)) {
      if (!(key in source)) report.extra.push(prefix ? `${prefix}.${key}` : key);
    }
    return output;
  }
  if (target !== undefined && typeof target !== typeof source) report.changed.push(prefix);
  return target === undefined || typeof target !== typeof source ? copy(source) : target;
}

const namespaces = fs.readdirSync(path.join(ROOT, 'en'))
  .filter((file) => file.endsWith('.json')).sort();
let failures = 0;
let additions = 0;
let removals = 0;

for (const namespaceFile of namespaces) {
  const namespace = namespaceFile.replace(/\.json$/, '');
  const englishPath = path.join(ROOT, 'en', namespaceFile);
  const english = read(englishPath);
  const flatEnglish = flatten(english);

  if (SINCE) {
    try {
      const previousText = execFileSync('git', ['show', `${SINCE}:web/src/i18n/locales/en/${namespaceFile}`], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const previous = flatten(JSON.parse(previousText));
      const changed = Object.keys(flatEnglish).filter((key) =>
        key in previous && previous[key] !== flatEnglish[key]);
      if (changed.length) {
        console.log(`ℹ [${namespace}] English text changed since ${SINCE}; review these translations:`);
        console.log(`  ${changed.join(', ')}`);
      }
    } catch {
      // A ref may predate a namespace; all of its keys are then new anyway.
    }
  }

  for (const locale of TARGETS) {
    const localePath = path.join(ROOT, locale, namespaceFile);
    const translated = fs.existsSync(localePath) ? read(localePath) : {};
    const report = { missing: [], extra: [], changed: [] };
    const synced = synchronize(english, translated, '', report);
    const flatSynced = flatten(synced);
    const placeholderIssues = Object.keys(flatEnglish).filter((key) =>
      JSON.stringify(placeholders(flatEnglish[key])) !== JSON.stringify(placeholders(flatSynced[key])));

    additions += report.missing.length;
    removals += report.extra.length + report.changed.length;
    if (report.missing.length || report.extra.length || report.changed.length) {
      const message = `[${namespace}] ${locale}: ${report.missing.length} missing, ${report.extra.length} extra, ${report.changed.length} type mismatches`;
      if (CHECK) {
        console.error(`✗ ${message}`);
        failures++;
      } else {
        fs.writeFileSync(localePath, `${JSON.stringify(synced, null, 2)}\n`);
        console.log(`✓ ${message} (structure synchronized)`);
      }
    }

    if (placeholderIssues.length) {
      console.error(`✗ [${namespace}] ${locale} has different {{variables}} at: ${placeholderIssues.join(', ')}`);
      failures++;
    }
  }
}

if (!CHECK && (additions || removals)) {
  console.log(`ℹ Added ${additions} English fallback values and removed ${removals} obsolete values. Translate the reported additions before release.`);
}
if (failures) {
  console.error(`${failures} translation issue${failures === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log(CHECK
  ? `✓ Locale structure and interpolation match English across ${namespaces.length} namespaces.`
  : '✓ Locale synchronization complete.');
