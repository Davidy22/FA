// One-time first-admin activation. Configure ADMIN_BOOTSTRAP_EMAIL as an Edge
// Function secret; the email's verified owner signs in and clicks /admin.
// Never expose the service-role key or the allowlisted email to the browser.
import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient, supabaseUserClient } from '../_shared/supabase.ts';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

serve(async (req) => {
  const c = handleCors(req); if (c) return c;
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const allowedEmail = Deno.env.get('ADMIN_BOOTSTRAP_EMAIL')?.trim().toLowerCase();
    if (!allowedEmail) return json({ error: 'Admin activation has not been configured' }, 503);

    const { data: { user }, error: authError } = await supabaseUserClient(req).auth.getUser();
    if (authError || !user) return json({ error: 'Sign in required' }, 401);
    if (user.email?.toLowerCase() !== allowedEmail || !user.email_confirmed_at) {
      return json({ error: 'Account is not eligible for initial admin activation' }, 403);
    }
    // The SQL function has EXECUTE granted solely to service_role. It checks
    // the profile's email and ensures no other active admin exists atomically.
    const { data: profile, error } = await supabaseServiceClient().rpc('bootstrap_admin', {
      p_user_id: user.id, p_email: allowedEmail,
    });
    if (error) return json({ error: error.message }, 409);
    return json({ ok: true, profile });
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
});
