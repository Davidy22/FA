-- OAuth sign-ups cannot pass `options.data.referral_code` to auth.signUp the way email
-- sign-ups can, so the web app stores the code locally and claims it right after the
-- OAuth callback. The same 10-point signup bonus is awarded as the email flow.
create or replace function public.claim_referral_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_referrer uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null then
    raise exception 'Sign in to claim a referral code';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_profile.referred_by is not null then
    raise exception 'A referral code has already been applied';
  end if;
  -- Only brand-new accounts may claim. This keeps the code from being added to an
  -- established account long after sign-up.
  if v_profile.created_at < now() - interval '24 hours' then
    raise exception 'Referral codes can only be claimed within 24 hours of sign-up';
  end if;
  if v_code = '' then
    raise exception 'Invalid referral code';
  end if;

  select id into v_referrer from public.profiles where referral_code = v_code;
  if v_referrer is null then
    raise exception 'Invalid referral code';
  end if;
  if v_referrer = v_uid then
    raise exception 'You cannot refer yourself';
  end if;

  update public.profiles set referred_by = v_referrer where id = v_uid;
  update public.profiles set points_balance = points_balance + 10 where id = v_referrer;
  insert into public.reward_transactions(user_id, points, type, memo)
    values (v_referrer, 10, 'referral_signup', 'Referral signup ' || v_uid::text)
    on conflict do nothing;
end;
$$;

revoke all on function public.claim_referral_code(text) from public;
grant execute on function public.claim_referral_code(text) to authenticated;
