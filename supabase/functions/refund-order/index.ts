// Refund a paid order in Stripe before marking it refunded locally. Only active
// admins may do this; retries reuse an existing successful full refund.
import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(), apiVersion: '2023-10-16',
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

serve(async (req) => {
  const preflight = handleCors(req); if (preflight) return preflight;
  try {
    const caller = supabaseUserClient(req);
    const svc = supabaseServiceClient();
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Sign in required' }, 401);
    const { data: actor } = await svc.from('profiles').select('role,is_active').eq('id', user.id).single();
    if (actor?.role !== 'admin' || !actor.is_active) return json({ error: 'Admin only' }, 403);

    const { order_id } = await req.json();
    if (typeof order_id !== 'string') return json({ error: 'Order id is required' }, 400);
    const { data: order, error: lookupError } = await svc.from('orders').select('*').eq('id', order_id).single();
    if (lookupError || !order) return json({ error: 'Order not found' }, 404);
    if (order.status === 'refunded') return json({ ok: true, already_refunded: true });
    if (!['shipped', 'cancelled'].includes(order.status) || !order.stripe_payment_intent_id) {
      return json({ error: 'Only shipped or cancelled Stripe orders can be refunded' }, 400);
    }

    const amount = Math.round(Number(order.total_amount) * 100);
    const existing = await stripe.refunds.list({ payment_intent: order.stripe_payment_intent_id, limit: 100 });
    const completed = existing.data.some((refund) => refund.status === 'succeeded' && refund.amount >= amount);
    if (!completed) {
      const pending = existing.data.some((refund) => refund.status === 'pending' && refund.amount >= amount);
      if (pending) return json({ error: 'The Stripe refund is pending. Check again after it completes.' }, 409);
      const refund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
        reason: 'requested_by_customer',
      }, { idempotencyKey: `ma-order-refund-${order.id}` });
      if (refund.status !== 'succeeded') {
        return json({ error: 'The Stripe refund was initiated but has not completed yet. Retry later.' }, 409);
      }
    }

    // Caller-scoped update lets the order-status trigger verify auth_role() = admin.
    const { error } = await caller.from('orders').update({ status: 'refunded' })
      .eq('id', order.id).in('status', ['shipped', 'cancelled']).select().single();
    if (error) throw new Error(`Stripe refund succeeded, but the order could not be updated: ${error.message}`);
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
