import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function supabase() {
  if (typeof window === 'undefined') {
    // Server-side build time (generateStaticParams) - return a client for fetching slugs.
    return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  if (!_client) _client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}
