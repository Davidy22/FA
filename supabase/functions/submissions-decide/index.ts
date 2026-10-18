// Admin review. The private file is copied first, then all database updates
// (product, materials, creator, and review status) commit in a single RPC.
import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

serve(async (req) => {
  const c = handleCors(req); if (c) return c;
  try {
    const caller = supabaseUserClient(req);
    const svc = supabaseServiceClient();
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Sign in required' }, 401);
    const { data: actor } = await svc.from('profiles').select('role,is_active').eq('id', user.id).single();
    if (actor?.role !== 'admin' || !actor.is_active) return json({ error: 'Admin only' }, 403);

    const { action, submission_id, edits, notes } = await req.json();
    if (!['approve', 'reject', 'changes_requested'].includes(action) || typeof submission_id !== 'string') {
      return json({ error: 'Invalid review request' }, 400);
    }
    const reviewNotes = String(notes || '').trim();
    if (action !== 'approve' && !reviewNotes) return json({ error: 'Review notes are required' }, 400);

    if (action !== 'approve') {
      const { data, error } = await caller.rpc('admin_decide_submission', {
        p_submission_id: submission_id, p_action: action, p_notes: reviewNotes,
      });
      if (error) throw error;
      return json({ ok: true, submission: data });
    }

    const { data: submission, error: lookupError } = await svc.from('model_submissions')
      .select('id,status,model_path').eq('id', submission_id).single();
    if (lookupError || !submission) return json({ error: 'Submission not found' }, 404);
    if (!['pending_review', 'changes_requested'].includes(submission.status)) {
      return json({ error: 'This submission has already been reviewed' }, 409);
    }
    const extension = submission.model_path.split('.').pop()?.toLowerCase();
    if (!extension || !['stl', 'obj', '3mf'].includes(extension)) {
      return json({ error: 'Unsupported submitted model format' }, 400);
    }
    const { data: file, error: downloadError } = await svc.storage.from('submission-assets')
      .download(submission.model_path);
    if (downloadError || !file) throw new Error('The submitted model file could not be downloaded');

    // Unique destination avoids deleting another reviewer's copy on a race.
    const path = `${submission_id}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await svc.storage.from('product-files').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (uploadError) throw uploadError;
    try {
      const { data, error } = await caller.rpc('admin_decide_submission', {
        p_submission_id: submission_id, p_action: 'approve', p_notes: reviewNotes,
        p_edits: edits || {}, p_model_path: path,
      });
      if (error) throw error;
      return json({ ok: true, submission: data });
    } catch (error) {
      await svc.storage.from('product-files').remove([path]);
      throw error;
    }
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
