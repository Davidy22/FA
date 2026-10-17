// sign-file Edge Function: returns a 5-minute signed URL for a file after role checks.
// Body: { bucket, path, kind, order_id?, submission_id?, ticket_id? }
// kind can be:
//   - product-file: staff of location that has an order containing the product, or admin
//   - model: owner or staff via order linkage or admin
//   - option-upload: owner or staff via order linkage or admin
//   - submission: owner or admin
//   - ticket-upload: owner, staff at the ticket's location, or admin

import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseUserClient, supabaseServiceClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const c = handleCors(req); if (c) return c;
  try {
    const { bucket, path, order_id, ticket_id } = await req.json();
    const user = supabaseUserClient(req);
    const svc = supabaseServiceClient();

    const { data: { user: u } } = await user.auth.getUser();
    if (!u) return new Response(JSON.stringify({ error: 'auth' }), { status: 401 });

    const { data: profile } = await svc.from('profiles').select('role,location_id').eq('id', u.id).single();
    const role = profile?.role || 'customer';
    const myLoc = profile?.location_id;

    let allowed = false;
    if (role === 'admin') allowed = true;
    else {
      // Customer access: own model (prefix matches user id)
      const pathUid = path.split('/')[0];
      if ((bucket === 'models' || bucket === 'option-uploads' || bucket === 'submission-assets' || bucket === 'document-prints')
          && pathUid === u.id) allowed = true;
      // Ticket attachments: staff at the ticket's location
      if (!allowed && ticket_id && (bucket==='ticket-uploads')) {
        const { data: ticket } = await svc.from('tickets').select('location_id').eq('id', ticket_id).maybeSingle();
        if (ticket && (role === 'manager' || role === 'employee') && ticket.location_id === myLoc) {
          allowed = true;
        }
      }
      // Staff access via order linkage
      if (!allowed && order_id && role !== 'customer' && (bucket==='models'||bucket==='product-files'||bucket==='option-uploads'||bucket==='document-prints')) {
        const { data: order } = await svc.from('orders').select('location_id').eq('id', order_id).maybeSingle();
        if (order && (role === 'manager' || role === 'employee') && order.location_id === myLoc) {
          if (bucket !== 'document-prints') allowed = true;
          else {
            const { data: lines } = await svc.from('order_items').select('item_snapshot').eq('order_id', order_id);
            allowed = !!lines?.some((line) => line.item_snapshot?.file_path === path);
          }
        }
      }
    }
    if (!allowed) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });

    const { data, error } = await svc.storage.from(bucket).createSignedUrl(path, 300);
    if (error) throw error;
    return new Response(JSON.stringify({ signedUrl: data.signedUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
