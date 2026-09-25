// Stripe Checkout Edge Function.
// Receives { cart, success_url, cancel_url, contact_email, contact_name, locale }
// Recomputes price via price_cart RPC, creates a Stripe Checkout Session, returns URL.

import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient } from '../_shared/supabase.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2023-10-16',
});

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { cart, success_url, cancel_url, contact_email, contact_name, locale } = await req.json();

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
