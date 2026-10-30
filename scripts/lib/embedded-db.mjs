// Shared bootstrap for the embedded-Postgres scripts.
//
// PGlite gives us a real Postgres in Node, which lets `pnpm verify` exercise the
// migrations and the SQL suites without Docker. Only the Supabase-owned pieces
// the migrations touch are stubbed: the auth schema, the storage schema, and the
// grants the API roles receive in a real project.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Supabase-owned schema, grants and helpers the migrations depend on. */
const STUB_SQL = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users(
    id uuid primary key, instance_id uuid, aud varchar(255), role varchar(255),
    email text unique, encrypted_password varchar(255), email_confirmed_at timestamptz,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb not null default '{}'::jsonb,
    confirmation_token varchar(255), recovery_token varchar(255),
    email_change varchar(255), email_change_token_new varchar(255),
    created_at timestamptz, updated_at timestamptz
  );
  create table auth.identities(
    id uuid primary key default gen_random_uuid(),
    provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null, provider text not null,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
    unique(provider_id,provider)
  );
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
  create table storage.buckets(id text primary key, name text, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, metadata jsonb);
  alter table storage.objects enable row level security;
  -- Supabase grants table privileges to the API roles up front and relies on row
  -- level security, plus the explicit revokes in the migrations, to keep
  -- customers out. Mirror that so policy expressions that read other tables are
  -- exercised the same way they are in production.
  grant usage on schema storage to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public
    grant select, insert, update, delete on tables to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  create function storage.foldername(path text) returns text[] language sql immutable as $$
    select string_to_array(path,'/') $$;
`;

export function createEmbeddedDb() {
  return new PGlite({ extensions: { pgcrypto, pg_trgm, uuid_ossp } });
}

/** Stub the Supabase-owned schema, then apply every migration in order. */
export async function applySchema(db) {
  await db.exec(STUB_SQL);
  let migrationCount = 0;
  for (const file of (await readdir(join(ROOT, 'supabase/migrations')))
    .filter((name) => name.endsWith('.sql')).sort()) {
    try {
      await db.exec(await readFile(join(ROOT, 'supabase/migrations', file), 'utf8'));
      await db.exec('reset all'); // Supabase applies each migration in a fresh session.
      migrationCount += 1;
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }
  return migrationCount;
}

/** `supabase db reset` also loads supabase/seed.sql. */
export async function applySeed(db) {
  await db.exec(await readFile(join(ROOT, 'supabase/seed.sql'), 'utf8'));
  await db.exec('reset all');
}
