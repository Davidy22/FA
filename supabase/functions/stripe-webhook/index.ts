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

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] as string));

/** Format in the order's own currency; the shop prices in HKD, not USD. */
function formatTotal(total: number, currency: string, locale: string): string {
  const tag = locale === 'zh-Hant' ? 'zh-Hant-HK' : locale === 'zh-Hans' ? 'zh-Hans-HK' : 'en-HK';
  try {
    return new Intl.NumberFormat(tag, { style: 'currency', currency }).format(total);
  } catch {
    return `${currency} ${total.toFixed(2)}`;
  }
}

const LOCALIZED_SUBJECT: Record<string, string> = {
  en: 'Your Make Anyth.ing order is confirmed',
  'zh-Hant': '您的 Make Anyth.ing 訂單已成立',
  'zh-Hans': '您的 Make Anyth.ing 订单已成立',
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
    // Record the event only after fulfillment succeeds. A failed database write
    // must be retried by Stripe rather than treated as a completed duplicate.
    let confirmation: { email: string; locale: string; orderNumber: string; total: string } | null = null;
    // `completed` fires for delayed payment methods too, before the money has
    // arrived; only fulfil once Stripe says the session is paid, and accept the
    // follow-up async success event for those methods.
    const fulfilTypes = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
    if (fulfilTypes.has(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.id;
      if (session.payment_status !== 'paid') {
        console.warn(`Skipping fulfilment for unpaid session ${sessionId} (${session.payment_status})`);
        return new Response(JSON.stringify({ received: true, unpaid: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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

      if (contactEmail) {
        const placed = order as { order_number: string; total_amount: number; currency?: string };
        confirmation = {
          email: contactEmail,
          locale,
          orderNumber: placed.order_number,
          total: formatTotal(Number(placed.total_amount), placed.currency || 'HKD', locale),
        };
      }
    }

    const { error: eventError } = await sb.from('stripe_events').insert({
      id: event.id, payload: event as unknown as Record<string, unknown>,
    });
    if (eventError && eventError.code !== '23505') throw eventError;
    if (!eventError && RESEND_KEY && confirmation) {
      // Email is best-effort, after the durable event record, so a retry does
      // not send a second confirmation for an already-fulfilled payment.
      const { email, locale, orderNumber, total } = confirmation;
      try {
        const result = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Make Anyth.ing <no-reply@makeanyth.ing>',
            to: [email],
            subject: LOCALIZED_SUBJECT[locale] ?? LOCALIZED_SUBJECT.en,
            html: `<p>${escapeHtml(orderNumber)}</p><p>Total: ${escapeHtml(total)}</p>`,
          }),
        });
        if (!result.ok) console.warn('Resend send failed', result.status);
      } catch (error) { console.warn('Resend send failed', error); }
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }
});
