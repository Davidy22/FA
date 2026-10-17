-- Social sign-ups (Google/Facebook/GitHub) put the person's name in provider-specific
-- metadata rather than `display_name`. Prefer any name the provider gives us so the
-- header/account page does not fall back to the email local-part.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
  v_display_name text;
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

  insert into public.profiles (id,email,display_name,role,referral_code,referred_by)
  values (new.id,new.email,v_display_name,
          'customer',upper(substr(replace(new.id::text,'-',''),1,12)),v_referrer)
  on conflict (id) do nothing;
  insert into public.carts(user_id) values(new.id) on conflict (user_id) do nothing;
  return new;
end; $$;
