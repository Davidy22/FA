// Invite staff (or promote an existing customer) after checking the caller's
// active role and target location. No unknown random passwords are created.
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
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Sign in required' }, 401);
    const { data: actor, error: actorError } = await svc.from('profiles')
      .select('role,location_id,is_active').eq('id', user.id).single();
    if (actorError || !actor?.is_active) return json({ error: 'Access denied' }, 403);

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const displayName = String(body.display_name || '').trim();
    const role = body.role;
    const locationId = body.location_id;
    const password = body.password ? String(body.password) : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['employee', 'manager'].includes(role)) {
      return json({ error: 'Enter a valid email and staff role' }, 400);
    }
    if (password && (password.length < 8 || password.length > 72)) {
      return json({ error: 'Temporary passwords must be 8–72 characters' }, 400);
    }
    if (actor.role !== 'admin' && !(actor.role === 'manager' && actor.location_id === locationId)) {
      return json({ error: 'Not permitted to create staff at this location' }, 403);
    }
    const { data: location } = await svc.from('locations').select('id').eq('id', locationId).eq('is_active', true).maybeSingle();
    if (!location) return json({ error: 'Choose an active location' }, 400);

    const { data: existing, error: existingError } = await svc.from('profiles')
      .select('id,role,location_id,is_active').eq('email', email).maybeSingle();
    if (existingError) throw existingError;
    if (existing && (existing.role === 'admin' || !existing.is_active ||
        (actor.role === 'manager' && existing.role !== 'customer' && existing.location_id !== locationId))) {
      return json({ error: 'This account cannot be changed here; use the admin user editor' }, 403);
    }

    let createdId: string | null = null;
    let invited = false;
    if (!existing) {
      const result = password
        ? await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } })
        : await svc.auth.admin.inviteUserByEmail(email, { data: { display_name: displayName } });
      if (result.error || !result.data.user) throw result.error || new Error('Could not create the invitation');
      createdId = result.data.user.id;
      invited = !password;
    }

    // This RPC also enforces the manager/location/target rules on the calling JWT.
    const { data: profile, error } = await caller.rpc('create_staff', {
      p_email: email, p_display_name: displayName, p_role: role, p_location_id: locationId,
    });
    if (error) {
      // Only delete a newly-created auth account; never delete a pre-existing user.
      if (createdId) await svc.auth.admin.deleteUser(createdId);
      throw error;
    }
    return json({ ok: true, invited, profile });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
