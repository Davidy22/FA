// Service clients for Edge Functions.
//
// An Edge Function that is missing `SUPABASE_URL` (or the anon key) should fail
// with a clear message at the call site instead of `undefined` reaching the
// Supabase client, and a request without an Authorization header must not be
// turned into `Authorization: undefined` — that silently downgrades to an
// anonymous call rather than a 401.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured for this Edge Function`);
  return value;
}

export function supabaseServiceClient() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

/**
 * A client that acts as the caller. A missing or malformed Authorization header
 * yields a client that resolves to no user, so `auth.getUser()` returns null
 * instead of throwing on a network round trip.
 */
export function supabaseUserClient(req: Request) {
  const url = required('SUPABASE_URL');
  const key = required('SUPABASE_ANON_KEY');
  const auth = req.headers.get('Authorization');
  if (!auth || !/^Bearer\s+\S+$/i.test(auth)) {
    return createClient(url, key, { auth: { persistSession: false } });
  }
  return createClient(url, key, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}
