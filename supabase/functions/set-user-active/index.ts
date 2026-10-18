// Admin-only account activation. The RPC enforces last-admin/self guards using
// the caller's JWT; the Auth admin API then bans/unbans future sign-ins.
import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

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
    const { user_id, active } = await req.json();
    if (typeof user_id !== 'string' || typeof active !== 'boolean') {
      return json({ error: 'Invalid user or active flag' }, 400);
    }
    const { data: previous, error: lookupError } = await svc.from('profiles')
      .select('is_active').eq('id', user_id).maybeSingle();
    if (lookupError || !previous) return json({ error: 'User not found' }, 404);
    const { error } = await caller.rpc('set_user_active', { p_user_id: user_id, p_active: active });
    if (error) return json({ error: error.message }, 403);

    const { error: banError } = await svc.auth.admin.updateUserById(user_id, {
      ban_duration: active ? 'none' : '876000h',
    });
    if (banError) {
      // Keep the profile and Auth status aligned if the Auth API fails.
      const { error: rollbackError } = await caller.rpc('set_user_active', {
        p_user_id: user_id, p_active: previous.is_active,
      });
      throw new Error(rollbackError
        ? `Auth update failed (${banError.message}); profile rollback also failed (${rollbackError.message})`
        : `Auth update failed: ${banError.message}`);
    }
    return json({ ok: true });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
