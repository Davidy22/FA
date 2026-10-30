#!/usr/bin/env node
// Repo-level structural checks that TypeScript, ESLint and Vitest cannot see.
// Run with `pnpm check:repo` (CI runs it on every pull request).
//
//  1. Migrations are append-only. Supabase records a checksum per migration, so
//     editing one that has shipped breaks every existing environment; fixes must
//     be a new file.
//  2. Migration filenames are ordered, unique and zero-padded, because Supabase
//     applies them in lexicographic order.
//  3. supabase/config.toml and supabase/functions/ agree. A stanza for a
//     function that no longer exists (verify-model, submissions-decide) is dead
//     configuration that looks live.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const FUNCTIONS = path.join(ROOT, 'supabase/functions');
const CONFIG = path.join(ROOT, 'supabase/config.toml');

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options }).trim();
}

function resolveBase() {
  const explicit = process.argv.find((arg) => arg.startsWith('--base='))?.slice('--base='.length)
    || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null);
  const candidates = [explicit, 'origin/main', 'main', 'HEAD~1'].filter(Boolean);
  for (const ref of candidates) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return ref;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Applied migrations are frozen because Supabase records their checksum. The one
 * exception is a migration that can no longer be applied at all: editing it is
 * then the only way to unbreak `supabase db start`, and a note keeps it visible.
 */
const APPLIED_MIGRATION_FIXES = {
  'supabase/migrations/20250101003500_retire_server_model_storage.sql':
    'allowed edit: opts into storage.allow_delete_query, without which storage-api refuses the bucket purge',
};

function checkMigrationsAppendOnly(base) {
  if (!base) {
    notes.push('no comparable git ref found — skipped the append-only migration check');
    return;
  }
  let output = '';
  try {
    output = git(['diff', '--name-status', base, '--', 'supabase/migrations']);
  } catch {
    notes.push(`could not diff against ${base} — skipped the append-only migration check`);
    return;
  }
  for (const line of output.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    if (status.startsWith('A')) continue;
    const file = paths[paths.length - 1];
    if (status.startsWith('M') && APPLIED_MIGRATION_FIXES[file]) {
      notes.push(`${file}: ${APPLIED_MIGRATION_FIXES[file]}`);
      continue;
    }
    fail(`supabase/migrations: ${paths.join(' -> ')} was ${status.startsWith('D') ? 'deleted' : 'modified'} `
      + `against ${base}. Add a new migration instead — applied files carry a checksum.`);
  }
}

function checkMigrationNames() {
  const files = fs.readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
  const seen = new Set();
  for (const file of files) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(file)) {
      fail(`supabase/migrations/${file}: expected <14-digit timestamp>_<snake_case_name>.sql`);
    }
    const stamp = file.split('_')[0];
    if (seen.has(stamp)) fail(`supabase/migrations/${file}: duplicate timestamp ${stamp}`);
    seen.add(stamp);
  }
  notes.push(`${files.length} migrations in order`);
}

/**
 * Every function a new migration creates or replaces must state its ACL in the
 * same file. `drop function` + `create` (or a changed argument list) resets the
 * ACL to `PUBLIC`, which is how `admin_generate_coupons` silently became
 * callable by anonymous visitors between migrations …2000 and …3300.
 */
function checkNewFunctionAcls(base) {
  if (!base) {
    notes.push('no comparable git ref found — skipped the new-function ACL check');
    return;
  }
  let output = '';
  try {
    output = git(['diff', '--name-status', base, '--', 'supabase/migrations']);
  } catch {
    notes.push(`could not diff against ${base} — skipped the new-function ACL check`);
    return;
  }
  let untracked = '';
  try {
    untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations']);
  } catch {
    untracked = '';
  }
  const fromDiff = output.split('\n').filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, file]) => file && file.endsWith('.sql') && file.startsWith('supabase/migrations/'))
    .filter(([, file]) => !APPLIED_MIGRATION_FIXES[file])
    .map((parts) => parts[1]);
  const added = [...new Set([...fromDiff, ...untracked.split('\n').filter(Boolean)])];
  let checked = 0;
  for (const file of added) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute)) continue; // deleted in the same change
    const sql = fs.readFileSync(absolute, 'utf8');
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) {
      const name = match[1];
      const acl = new RegExp(`(grant|revoke)[^;]*on\\s+function\\s+(?:public\\.)?${name}\\b`, 'i');
      checked += 1;
      if (!acl.test(sql)) {
        fail(`${file}: creates function public.${name}() without stating its ACL. `
          + 'Add `revoke all on function ... from public, anon;` (plus any grant) so anonymous visitors cannot call it.');
      }
    }
  }
  if (checked === 0) notes.push('no new SQL functions in this change');
}

function checkFunctionConfig() {
  const dirs = fs.readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(FUNCTIONS, name, 'index.ts')))
    .sort();
  const configured = [...fs.readFileSync(CONFIG, 'utf8').matchAll(/^\[functions\.([a-z0-9-]+)\]$/gm)]
    .map((match) => match[1])
    .sort();

  for (const name of new Set([...dirs, ...configured])) {
    if (!dirs.includes(name)) {
      fail(`supabase/config.toml: [functions.${name}] configures a function with no supabase/functions/${name}/index.ts`);
    } else if (!configured.includes(name)) {
      fail(`supabase/functions/${name}: missing a [functions.${name}] block in supabase/config.toml`);
    }
  }
  notes.push(`${dirs.length} edge functions match config.toml`);
}

const base = resolveBase();
checkMigrationsAppendOnly(base);
checkMigrationNames();
checkNewFunctionAcls(base);
checkFunctionConfig();

for (const note of notes) console.log(`  ${note}`);
if (problems.length > 0) {
  console.error('\n✗ Repo checks failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('✓ Repo checks passed (migrations append-only, edge function config in step).');
