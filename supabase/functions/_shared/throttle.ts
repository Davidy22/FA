// Shared request throttling for public Edge Functions.
//
// Keys are hashed client addresses: the throttle table must never store raw IPs.
// A throttle outage must not take the endpoint down with it, so a failed counter
// call fails open and logs.

import { supabaseServiceClient } from './supabase.ts';

/** Hash the caller's address so the throttle table never stores raw IPs. */
export async function clientKey(req: Request): Promise<string | null> {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || req.headers.get('cf-connecting-ip') || '';
  if (!ip) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function withinRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const key = await clientKey(req);
  if (!key) return true; // no client address: never block the whole site
  const { data, error } = await supabaseServiceClient().rpc('consume_throttle', {
    p_bucket: bucket,
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.warn('Throttle check failed', bucket, error.message);
    return true;
  }
  return data !== false;
}
