// site-rebuild: optionally triggers a GitHub Actions repository_dispatch to rebuild the catalog.
// Requires GITHUB_TOKEN and GITHUB_REPO env vars (owner/repo form). No-op if not configured.
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

    const token = Deno.env.get('GITHUB_TOKEN');
    const repo = Deno.env.get('GITHUB_REPO');
    if (!token || !repo) {
      return new Response(JSON.stringify({ ok: true, noop: true, reason: 'not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'site-rebuild' }),
    });
    return new Response(JSON.stringify({ ok: r.ok, status: r.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }
});
