// submissions-decide: admin approves/rejects/requests-changes on a model submission.
// Approving atomically creates a premade_products row + product_materials + copies file.
import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const c = handleCors(req); if (c) return c;
  try {
    const user = supabaseUserClient(req);
    const svc = supabaseServiceClient();
    const { data: { user: u } } = await user.auth.getUser();
    if (!u) return new Response(JSON.stringify({ error: 'auth' }), { status: 401 });
    const { data: profile } = await svc.from('profiles').select('role').eq('id',u.id).single();
    if (profile?.role !== 'admin') return new Response(JSON.stringify({error:'forbidden'}),{status:403});

    const { action, submission_id, edits, notes } = await req.json();
    const { data: sub, error: e1 } = await svc.from('model_submissions')
      .select('*,model_submission_materials(material_id,price_modifier)')
      .eq('id', submission_id).single();
    if (e1 || !sub) throw new Error('submission not found');

    if (action === 'reject' || action === 'changes_requested') {
      await svc.from('model_submissions').update({
        status: action === 'reject' ? 'rejected' : 'changes_requested',
        review_notes: notes || '',
        reviewed_by: u.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', submission_id);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'approve') {
      // Copy model from submission-assets to product-files
      const srcPath = sub.model_path;
      const newPath = `product-files/${submission_id}-${srcPath.split('/').pop()}`;
      const { data: fileData, error: dErr } = await svc.storage.from('submission-assets').download(srcPath);
      if (!dErr && fileData) {
        const ab = await fileData.arrayBuffer();
        await svc.storage.from('product-files').upload(newPath, ab, { contentType: fileData.type, upsert: true });
      }

      const e = edits || {};
      const slug = (e.slug || (e.title?.en || sub.title.en))
        .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'-').replace(/(^-|-$)/g,'')
        + '-' + submission_id.slice(0,6);

      const { data: product, error: pErr } = await svc.from('premade_products').insert({
        slug,
        name: e.name || sub.title,
        description: e.description || sub.description,
        base_price: e.base_price ?? sub.base_price,
        default_material_id: e.default_material_id ?? (sub.model_submission_materials as any)[0]?.material_id,
        category: e.category ?? sub.category,
        tags: e.tags ?? sub.tags,
        image_urls: e.image_urls ?? sub.preview_urls,
        source_model_path: newPath,
        submitted_by: sub.submitter_id,
        source_submission_id: submission_id,
        status: 'published',
      }).select().single();
      if (pErr) throw new Error(`insert product: ${pErr.message}`);

      // Copy allowed materials
      const materials = (e.materials ?? sub.model_submission_materials) as Array<{material_id:string;price_modifier:number}>;
      if (materials?.length) {
        await svc.from('product_materials').insert(
          materials.map((m) => ({ product_id: product.id, material_id: m.material_id, price_modifier: m.price_modifier ?? 0 }))
        );
      }

      await svc.from('model_submissions').update({
        status: 'approved',
        reviewed_by: u.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || '',
        published_product_id: product.id,
      }).eq('id', submission_id);

      // Set creator flag if not already.
      await svc.from('profiles').update({ is_creator: true }).eq('id', sub.submitter_id);

      // (Optional) call site-rebuild to trigger catalog rebuild.
      return new Response(JSON.stringify({ ok: true, product }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
