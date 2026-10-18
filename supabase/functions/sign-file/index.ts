// Sign a private file only when the caller owns it or it is attached to an
// order/ticket they are authorized to serve. Admins can access every bucket.
import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseUserClient, supabaseServiceClient } from '../_shared/supabase.ts';

const buckets = new Set([
  'models', 'option-uploads', 'submission-assets', 'document-prints',
  'ticket-uploads', 'product-files',
]);
const respond = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

serve(async (req) => {
  const c = handleCors(req); if (c) return c;
  try {
    const { bucket, path, order_id, ticket_id } = await req.json();
    if (!buckets.has(bucket) || typeof path !== 'string' || !path || path.length > 1024 ||
        path.startsWith('/') || path.split('/').some((part) => part === '..')) {
      return respond({ error: 'Invalid file request' }, 400);
    }
    const user = supabaseUserClient(req);
    const svc = supabaseServiceClient();
    const { data: { user: u } } = await user.auth.getUser();
    if (!u) return respond({ error: 'auth' }, 401);

    const { data: profile, error: profileError } = await svc.from('profiles')
      .select('role,location_id,is_active').eq('id', u.id).single();
    if (profileError || !profile?.is_active) return respond({ error: 'forbidden' }, 403);

    let allowed = profile.role === 'admin';
    if (!allowed) {
      // Customers may access only their own uploads. Storage paths are always
      // prefixed with the authenticated user ID for these four buckets.
      if (['models', 'option-uploads', 'submission-assets', 'document-prints'].includes(bucket)
          && path.split('/')[0] === u.id) allowed = true;

      if (!allowed && bucket === 'ticket-uploads' && ticket_id) {
        const { data: ticket } = await svc.from('tickets')
          .select('user_id,location_id').eq('id', ticket_id).maybeSingle();
        if (ticket && (ticket.user_id === u.id ||
            (['manager', 'employee'].includes(profile.role) && ticket.location_id === profile.location_id))) {
          const { data: attachment } = await svc.from('ticket_attachments')
            .select('id').eq('ticket_id', ticket_id).eq('file_path', path).maybeSingle();
          allowed = !!attachment;
        }
      }

      if (!allowed && order_id && ['manager', 'employee'].includes(profile.role) &&
          ['models', 'product-files', 'option-uploads', 'document-prints'].includes(bucket)) {
        const { data: order } = await svc.from('orders')
          .select('location_id').eq('id', order_id).maybeSingle();
        if (order?.location_id === profile.location_id) {
          const { data: lines } = await svc.from('order_items')
            .select('id,premade_product_id,quote_request_id,item_snapshot').eq('order_id', order_id);
          if (bucket === 'document-prints') {
            allowed = !!lines?.some((line) => line.item_snapshot?.file_path === path);
          } else if (bucket === 'models') {
            allowed = !!lines?.some((line) => line.quote_request_id && line.item_snapshot?.model_path === path);
            // Older order snapshots did not retain the model path.
            if (!allowed && lines?.some((line) => line.quote_request_id)) {
              const ids = lines.flatMap((line) => line.quote_request_id ? [line.quote_request_id] : []);
              const { data: quotes } = await svc.from('quote_requests')
                .select('uploaded_model_id').in('id', ids);
              const modelIds = quotes?.flatMap((quote) => quote.uploaded_model_id ? [quote.uploaded_model_id] : []) || [];
              if (modelIds.length) {
                const { data: models } = await svc.from('uploaded_models')
                  .select('id').in('id', modelIds).eq('file_path', path).limit(1);
                allowed = !!models?.length;
              }
            }
          } else if (bucket === 'product-files') {
            allowed = !!lines?.some((line) => line.premade_product_id && line.item_snapshot?.model_path === path);
            // Orders placed before model paths were included in the snapshot.
            if (!allowed && lines?.some((line) => line.premade_product_id)) {
              const ids = lines.flatMap((line) => line.premade_product_id ? [line.premade_product_id] : []);
              const { data: products } = await svc.from('premade_products')
                .select('source_model_path').in('id', ids);
              allowed = !!products?.some((product) => product.source_model_path === path);
            }
          } else if (bucket === 'option-uploads' && lines?.length) {
            const { data: attachment } = await svc.from('order_item_option_values')
              .select('id').eq('file_path', path).in('order_item_id', lines.map((line) => line.id))
              .limit(1);
            allowed = !!attachment?.length;
          }
        }
      }
    }
    if (!allowed) return respond({ error: 'forbidden' }, 403);

    const { data, error } = await svc.storage.from(bucket).createSignedUrl(path, 300);
    if (error) throw error;
    return respond({ signedUrl: data.signedUrl });
  } catch (err) {
    return respond({ error: (err as Error).message }, 400);
  }
});
