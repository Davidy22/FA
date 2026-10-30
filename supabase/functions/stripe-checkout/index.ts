// Stripe Checkout Edge Function.
// Receives { cart, success_url, cancel_url, contact_email, contact_name, locale }
// Verifies the caller's identity: cart.user_id (which gates coupon ownership and
// reward-point attribution downstream) must match the authenticated caller, and is
// replaced with the verified id (null for guests) before pricing and fulfillment.
// Recomputes price via price_cart RPC, creates a Stripe Checkout Session, returns URL.

import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1?target=deno';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2023-10-16',
});

/** An error whose message is safe to show the shopper. */
class UserError extends Error {}

const MAX_EMAIL = 254;
const MAX_NAME = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCALES = new Set(['en', 'zh-Hant', 'zh-Hans']);

/**
 * Where Stripe may send the shopper afterwards. Set PUBLIC_SITE_URLS in
 * production; otherwise the caller's own origin is the only accepted one, so a
 * crafted request cannot turn checkout into an open redirect.
 */
function siteOrigins(req: Request): string[] {
  const configured = (Deno.env.get('PUBLIC_SITE_URLS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try { return new URL(value).origin; } catch { return ''; }
    })
    .filter(Boolean);
  if (configured.length > 0) return configured;
  const origin = req.headers.get('Origin');
  return origin ? [origin] : [];
}

function sameOrigin(url: unknown, origins: string[]): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    return origins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { cart, success_url, cancel_url, contact_email, contact_name, locale } = await req.json();
    if (!cart || typeof cart !== 'object' || !Array.isArray(cart.items)) {
      throw new UserError('Your cart is empty.');
    }

    const origins = siteOrigins(req);
    if (origins.length === 0 || !sameOrigin(success_url, origins) || !sameOrigin(cancel_url, origins)) {
      return new Response(
        JSON.stringify({ error: 'Checkout must return to this site. Reload the page and try again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const email = typeof contact_email === 'string' ? contact_email.trim() : '';
    const name = typeof contact_name === 'string' ? contact_name.trim().slice(0, MAX_NAME) : '';
    if (email && (email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email))) {
      throw new UserError('Enter a valid email address so we can send your receipt.');
    }
    const safeLocale = LOCALES.has(locale) ? locale : 'en';

    // Resolve the authenticated caller from the request's Authorization header.
    // Guests send the anon key (or nothing) and resolve to null.
    let verifiedUserId: string | null = null;
    if (req.headers.get('Authorization')) {
      try {
        const { data: { user } } = await supabaseUserClient(req).auth.getUser();
        verifiedUserId = user?.id ?? null;
      } catch {
        verifiedUserId = null; // expired/invalid token treated as guest
      }
    }

    const claimedUserId = cart.user_id ?? null;
    if (claimedUserId && claimedUserId !== verifiedUserId) {
      return new Response(
        JSON.stringify({ error: 'Your session has expired. Sign in again, or clear your details to check out as a guest.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    cart.user_id = verifiedUserId; // authoritative: verified id or null

    const sb = supabaseServiceClient();

    // Never trust a page count supplied by the browser (or a modified cart).
    // Download each private owner/capability-scoped PDF and replace the count
    // before charging Stripe and persisting the cart used by the webhook.
    for (const item of cart.items ?? []) {
      if (item.kind !== 'document') continue;
      const guestPath = typeof item.file_path === 'string' &&
        /^guest\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i
          .test(item.file_path);
      const ownerPath = verifiedUserId && typeof item.file_path === 'string' &&
        item.file_path.startsWith(`${verifiedUserId}/`);
      if (!ownerPath && !guestPath) {
        throw new UserError('Upload your own PDF before checkout.');
      }
      const { data: file, error: fileError } = await sb.storage.from('document-prints').download(item.file_path);
      if (fileError || !file) throw new UserError('Could not read the uploaded document.');
      let count: number;
      try { count = (await PDFDocument.load(await file.arrayBuffer())).getPageCount(); }
      catch { throw new UserError('Could not read this PDF. Upload a valid, unencrypted PDF.'); }
      if (count < 1 || count > 500) throw new UserError('PDF must have between 1 and 500 pages.');
      item.pages = count;
    }

    // Authoritative pricing via the price_cart RPC (service role)
    const { data: pricing, error: pErr } = await sb.rpc('price_cart', { p_cart: cart });
    if (pErr) {
      // Postgres detail stays in the logs; the shopper gets something actionable.
      console.error('price_cart failed', pErr);
      throw new UserError('Your cart could not be priced. Refresh the page and try again.');
    }

    // Build line items for Stripe
    const line_items = [
      {
        price_data: {
          currency: (pricing.currency as string).toLowerCase(),
          product_data: { name: 'Make Anyth.ing Order' },
          unit_amount: Math.round((pricing.total_amount as number) * 100),
        },
        quantity: 1,
      },
    ];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url,
      cancel_url,
      customer_email: email || null,
      metadata: {
        fab_location_id: cart.location_id,
        fab_locale: safeLocale,
        fab_user_id: cart.user_id ?? '',
        fab_contact_name: name,
        fab_contact_email: email,
      },
      payment_intent_data: { metadata: { fab_location_id: cart.location_id } },
    });

    // Snapshot checkout session keyed by Stripe session id, for webhook fulfillment.
    await sb.from('checkout_sessions').insert({
      session_id: session.id,
      cart,
      user_id: cart.user_id || null,
      location_id: cart.location_id,
      contact_email: email || null,
      contact_name: name || null,
      locale: safeLocale,
    });

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    const userFacing = err instanceof UserError;
    return new Response(JSON.stringify({
      error: userFacing ? (err as Error).message : 'Checkout could not be started. Please try again.',
    }), {
      status: userFacing ? 400 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
