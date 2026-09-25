// Stripe webhook: verifies signature, ensures idempotency via stripe_events,
// and calls create_order_from_cart RPC for checkout.session.completed.

import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno';
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseServiceClient } from '../_shared/supabase.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2023-10-16',
});
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const LOCALIZED_SUBJECT: Record<string, string> = {
  en: 'Your Fab Anything order is confirmed',
  'zh-Hant': '您的 Fab Anything 訂單已成立',
  'zh-Hans': '您的 Fab Anything 订单已成立',
};

serve(async (req) => {
  try {
    const body = await req.text();
    const sig = req.headers.get('stripe-signature')!;
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
    } catch (err) {
      return new Response('invalid signature', { status: 400 });
    }

    const sb = supabaseServiceClient();

    // Idempotency
    const { data: existing } = await sb
      .from('stripe_events')
      .select('id')
      .eq('id', event.id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await sb.from('stripe_events').insert({ id: event.id, payload: event as unknown as Record<string, unknown> });

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.id;
      const { data: sess } = await sb
        .from('checkout_sessions')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (!sess) throw new Error(`No checkout_sessions row for ${sessionId}`);

      const userId = sess.user_id || (session.metadata?.fab_user_id || null);
      const locationId = sess.location_id || session.metadata?.fab_location_id;
      const contactEmail = sess.contact_email || session.customer_email || session.metadata?.fab_contact_email;
      const contactName = sess.contact_name || session.metadata?.fab_contact_name || '';
      const locale = sess.locale || session.metadata?.fab_locale || 'en';

      const { data: order, error: rErr } = await sb.rpc('create_order_from_cart', {
        p_session_id: sessionId,
        p_user_id: userId,
        p_location_id: locationId,
        p_contact_email: contactEmail,
        p_contact_name: contactName,
        p_locale: locale,
        p_stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      });
      if (rErr) throw new Error(`create_order_from_cart: ${rErr.message}`);

      // Send confirmation email (best effort)
      if (RESEND_KEY && contactEmail) {
        const orderNum = (order as unknown as { order_number: string }).order_number;
        const total = (order as unknown as { total_amount: number }).total_amount;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Fab Anything <no-reply@fab.example.com>',
            to: [contactEmail],
            subject: LOCALIZED_SUBJECT[locale] ?? LOCALIZED_SUBJECT.en,
            html: `<p>${orderNum}</p><p>Total: US$${total.toFixed(2)}</p>`,
          }),
        }).catch((e) => console.warn('Resend send failed', e));
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }
});
