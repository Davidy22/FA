-- A profile's referral code is the first twelve hex characters of its UUID, so
-- two accounts whose ids share that prefix collide on the unique index. The
-- sign-up trigger then raises `duplicate key value violates unique constraint
-- "profiles_referral_code_key"` and the account is never created — a real user
-- simply cannot register. It is reproducible with any hand-written or
-- sequential id, which is exactly what the test fixtures use.
--
-- Keep the readable, deterministic code as the common case and fall back to a
-- random code when it is taken.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
  v_display_name text;
  v_code text;
  v_attempt int := 0;
begin
  select id into v_referrer from public.profiles
   where referral_code = upper(btrim(coalesce(new.raw_user_meta_data->>'referral_code', '')))
   limit 1;
  if nullif(btrim(coalesce(new.raw_user_meta_data->>'referral_code','')), '') is not null and v_referrer is null then
    raise exception 'Invalid referral code';
  end if;

  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'user_name'), ''),
    split_part(new.email, '@', 1)
  );

  v_code := upper(substr(replace(new.id::text,'-',''),1,12));
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.profiles (id,email,display_name,role,referral_code,referred_by)
      values (new.id,new.email,v_display_name,'customer',v_code,v_referrer)
      on conflict (id) do nothing;
      exit;
    exception when unique_violation then
      -- The id already exists (on conflict) or the code is taken; only the code
      -- can be replaced, and it is worth a few tries before failing sign-up.
      if v_attempt >= 5 then raise; end if;
      v_code := 'U' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,11));
    end;
  end loop;

  insert into public.carts(user_id) values(new.id) on conflict (user_id) do nothing;
  return new;
end; $$;

-- Trigger-only function: no client role may call it directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;
