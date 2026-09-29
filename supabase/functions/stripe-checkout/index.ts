// Stripe Checkout Edge Function.
// Receives { cart, success_url, cancel_url, contact_email, contact_name, locale }
// Verifies the caller's identity: cart.user_id (which gates coupon ownership and
// reward-point attribution downstream) must match the authenticated caller, and is
// replaced with the verified id (null for guests) before pricing and fulfillment.
// Recomputes price via price_cart RPC, creates a Stripe Checkout Session, returns URL.

import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2023-10-16',
});

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { cart, success_url, cancel_url, contact_email, contact_name, locale } = await req.json();

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

    // Authoritative pricing via the price_cart RPC (service role)
    const { data: pricing, error: pErr } = await sb.rpc('price_cart', { p_cart: cart });
    if (pErr) throw new Error(`price_cart: ${pErr.message}`);

    // Build line items for Stripe
    const line_items = [
      {
        price_data: {
          currency: (pricing.currency as string).toLowerCase(),
          product_data: { name: 'Fab Anything Order' },
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
      customer_email: contact_email ?? null,
      metadata: {
        fab_location_id: cart.location_id,
        fab_locale: locale ?? 'en',
        fab_user_id: cart.user_id ?? '',
        fab_contact_name: contact_name ?? '',
        fab_contact_email: contact_email ?? '',
      },
      payment_intent_data: { metadata: { fab_location_id: cart.location_id } },
    });

    // Snapshot checkout session keyed by Stripe session id, for webhook fulfillment.
    await sb.from('checkout_sessions').insert({
      session_id: session.id,
      cart,
      user_id: cart.user_id || null,
      location_id: cart.location_id,
      contact_email: contact_email ?? cart.contact_email ?? null,
      contact_name: contact_name ?? cart.contact_name ?? null,
      locale: locale ?? 'en',
    });

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
