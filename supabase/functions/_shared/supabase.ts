import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export function supabaseServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function supabaseUserClient(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('Authorization')!;
  return createClient(url, key, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}
