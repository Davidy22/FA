// Run supabase/tests/*.sql against the embedded Postgres.
//
// CI runs the real thing (`supabase test db` with pgTAP inside Docker). This is
// the same suite with a minimal TAP shim, so `pnpm verify` catches suites that
// drifted from the schema without needing Docker — which is exactly how the
// `admin_save_product` fixtures silently rotted after new products started
// taking their id as slug.
//
// The shim covers the assertions the suite uses (ok, is, isnt_empty, throws_ok,
// lives_ok, has_index, has_column, has_function). It is not pgTAP: it does not
// implement the wider API, so a test file that needs something new has to teach
// the shim about it.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { applySchema, applySeed, createEmbeddedDb, ROOT } from './lib/embedded-db.mjs';

const TAP = `
  create schema pgtap;
  grant usage on schema pgtap to anon, authenticated;
  create sequence pgtap.tap_seq minvalue 0;
  create table pgtap.plan(n int);
  create function pgtap._next() returns int language sql as $$ select nextval('pgtap.tap_seq')::int $$;
  create function pgtap.plan(n int) returns text language sql as $$
    select (select setval('pgtap.tap_seq', 0))::text $$;
  create function pgtap.ok(cond boolean, descr text) returns text language plpgsql as $$
  declare n int := pgtap._next();
  begin return n||(case when coalesce(cond,false) then ' ok - ' else ' not ok - ' end)||descr; end $$;
  create function pgtap."is"(got anyelement, want anyelement, descr text) returns text language plpgsql as $$
  declare n int := pgtap._next();
  begin return n||(case when got is not distinct from want then ' ok - ' else ' not ok - ' end)||descr
    ||case when got is distinct from want
        then ' (got '||coalesce(got::text,'null')||', want '||coalesce(want::text,'null')||')' else '' end; end $$;
  create function pgtap.isnt_empty(q text, descr text) returns text language plpgsql as $$
  declare n int := pgtap._next(); c bigint;
  begin execute 'select count(*) from ('||q||') s' into c;
    return n||(case when c>0 then ' ok - ' else ' not ok - ' end)||descr; end $$;
  create function pgtap.throws_ok(q text, code text, msg text, descr text) returns text language plpgsql as $$
  declare n int := pgtap._next(); got_code text; got_msg text;
  begin
    begin execute q; got_code := null;
    exception when others then got_code := sqlstate; got_msg := sqlerrm;
    end;
    if got_code is null then return n||' not ok - '||descr||' (no exception)'; end if;
    if got_code is distinct from code then
      return n||' not ok - '||descr||' (sqlstate '||got_code||', want '||code||': '||got_msg||')';
    end if;
    if msg is not null and got_msg is distinct from msg then
      return n||' not ok - '||descr||' (message "'||got_msg||'", want "'||msg||'")';
    end if;
    return n||' ok - '||descr;
  end $$;
  create function pgtap.throws_ok(q text, code integer, msg text, descr text) returns text language sql as $$
    select pgtap.throws_ok(q, code::text, msg, descr) $$;
  create function pgtap.lives_ok(q text, descr text) returns text language plpgsql as $$
  declare n int := pgtap._next();
  begin begin execute q; exception when others then
      return n||' not ok - '||descr||' ('||sqlerrm||')'; end;
    return n||' ok - '||descr; end $$;
  create function pgtap.has_index(sch text, tbl text, idx text, descr text) returns text language plpgsql as $$
  declare n int := pgtap._next(); c bigint;
  begin select count(*) into c from pg_indexes where schemaname=sch and tablename=tbl and indexname=idx;
    return n||(case when c>0 then ' ok - ' else ' not ok - ' end)||descr; end $$;
  create function pgtap.has_column(sch text, tbl text, col text, descr text) returns text language plpgsql as $$
  declare n int := pgtap._next(); c bigint;
  begin select count(*) into c from information_schema.columns
      where table_schema=sch and table_name=tbl and column_name=col;
    return n||(case when c>0 then ' ok - ' else ' not ok - ' end)||descr; end $$;
  create function pgtap.has_function(sch text, fn text, args text[], descr text) returns text language plpgsql as $$
  declare n int := pgtap._next(); c bigint;
  begin select count(*) into c from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname=sch and p.proname=fn;
    return n||(case when c>0 then ' ok - ' else ' not ok - ' end)||descr; end $$;
  create function pgtap.finish() returns setof text language sql as $$
    select 'ran '||last_value||' of '||(select n from pgtap.plan)||' planned' from pgtap.tap_seq $$;
`;

/** Rewrite a suite so its unqualified pgTAP calls resolve to the shim. */
function toShimSql(sql) {
  return sql
    .replace(/create extension if not exists pgtap;/g, '')
    .replace(/select plan\((\d+)\);/g,
      (_, n) => `insert into pgtap.plan(n) values(${n}); select pgtap.plan(${n});`)
    .replace(/\bselect (ok|is|isnt_empty|throws_ok|lives_ok|has_index|has_column|has_function)\(/g,
      (_, fn) => (fn === 'is' ? 'select pgtap."is"(' : `select pgtap.${fn}(`))
    .replace(/\breturn (ok)\(/g, 'return pgtap.$1(')
    .replace(/select \* from finish\(\)/g, 'select * from pgtap.finish()');
}

const db = createEmbeddedDb();
let failures = 0;

try {
  await applySchema(db);
  await applySeed(db);
  await db.exec(TAP);

  const files = (await readdir(join(ROOT, 'supabase/tests')))
    .filter((name) => name.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error('No SQL suites found in supabase/tests');

  for (const file of files) {
    await db.exec('delete from pgtap.plan');
    const sql = toShimSql(await readFile(join(ROOT, 'supabase/tests', file), 'utf8'));
    let results;
    try {
      results = await db.exec(sql);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${file}: ${error.message}`);
      if (error.position) {
        const at = Number(error.position);
        console.error(`  near: ${JSON.stringify(sql.slice(Math.max(0, at - 120), at + 80))}`);
      }
      continue;
    }
    const lines = (Array.isArray(results) ? results : [results])
      .flatMap((result) => (result.rows ?? []).map((row) => String(Object.values(row)[0] ?? '')))
      .filter((line) => /^\d+ (ok|not ok)/.test(line) || line.startsWith('ran '));
    const failed = lines.filter((line) => line.includes('not ok'));
    const summary = lines.find((line) => line.startsWith('ran '));
    if (failed.length || !summary) {
      failures += 1;
      console.error(`✗ ${file}: ${summary ?? 'no finish() output'}`);
      for (const line of failed) console.error(`   ${line}`);
    } else {
      console.log(`✓ ${file}: ${summary}`);
    }
  }
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  await db.close();
}

if (failures) {
  console.error(`\n${failures} SQL suite(s) failed.`);
  process.exit(1);
}
console.log('\nAll embedded Postgres SQL suites passed.');
