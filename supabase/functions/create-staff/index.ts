// create-staff: admin or manager (own location) invites/updates a staff user.
// Uses service role to create auth user when needed, then sets role/location on the profile.
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
    const { data: actor } = await svc.from('profiles').select('role,location_id').eq('id',u.id).single();
    if (!actor) return new Response(JSON.stringify({error:'profile missing'}),{status:400});

    const { email, display_name, role, location_id, password } = await req.json();
    if (role !== 'employee' && role !== 'manager') {
      return new Response(JSON.stringify({error:'invalid role'}),{status:400});
    }
    if (actor.role !== 'admin' && !(actor.role==='manager' && actor.location_id===location_id)) {
      return new Response(JSON.stringify({error:'forbidden'}),{status:403});
    }

    let uid: string | null = null;
    const { data: existing } = await svc.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existing?.id) uid = existing.id;
    else {
      const { data: created, error } = await svc.auth.admin.createUser({
        email, password: password || (Math.random().toString(36).slice(2) + 'A1!'),
        email_confirm: true, user_metadata: { display_name },
      });
      if (error) throw new Error(`createUser: ${error.message}`);
      uid = created.user!.id;
    }

    const { data: profile, error: uErr } = await svc.from('profiles').update({
      role, location_id, display_name, is_active: true,
    }).eq('id', uid).select().single();
    if (uErr) throw new Error(uErr.message);

    return new Response(JSON.stringify({ ok: true, profile }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
