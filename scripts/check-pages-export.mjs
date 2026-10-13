// Verify the actual artifact, not just Next's configuration. GitHub Pages serves
// web/out at basePath; it does not rewrite root-relative links for a project site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('web/out');
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

for (const file of ['index.html', '404.html', '.nojekyll', 'favicon.svg']) {
  assert(fs.existsSync(path.join(output, file)), `Missing Pages artifact file: ${file}`);
}

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(file);
    return entry.name.endsWith('.html') ? [file] : [];
  });
}

const files = htmlFiles(output);
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  const assets = references.filter(url => url.includes('/_next/'));
  const label = path.relative(output, file);

  assert(assets.some(url => url.endsWith('.js')), `${label}: no JavaScript assets`);
  assert(assets.some(url => url.endsWith('.css')), `${label}: no stylesheet assets`);
  assert(references.includes(`${basePath}/favicon.svg`), `${label}: incorrect favicon base path`);

  for (const url of assets) {
    assert(url.startsWith(`${basePath}/_next/`), `${label}: incorrect asset base path: ${url}`);
    const artifactPath = url.slice(basePath.length + 1).split(/[?#]/)[0];
    assert(fs.existsSync(path.join(output, artifactPath)), `${label}: missing asset: ${url}`);
  }
}

console.log(`✓ Pages export: ${files.length} HTML files, assets and favicon use ${basePath || '/'} correctly.`);
