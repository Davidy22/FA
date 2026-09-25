import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const c = handleCors(req); if (c) return c;
  try {
    const user = supabaseUserClient(req);
    const svc = supabaseServiceClient();
    const { data: { user: u } } = await user.auth.getUser();
    if (!u) return new Response(JSON.stringify({error:'auth'}),{status:401});
    const { data: actor } = await svc.from('profiles').select('role').eq('id',u.id).single();
    if (actor?.role !== 'admin') return new Response(JSON.stringify({error:'forbidden'}),{status:403});
    const { user_id, active } = await req.json();
    const { error } = await svc.rpc('set_user_active', { p_user_id: user_id, p_active: active });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
