-- Helper functions for RLS (stable, security definer, fixed search_path)

create or replace function public.auth_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'anon'
  );
$$;

create or replace function public.my_location()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select location_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('employee','manager','admin') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_staff_at(loc uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin()
      or coalesce(
        (select role in ('employee','manager') and location_id = loc
           from public.profiles where id = auth.uid()),
        false
      );
$$;

-- updated_at trigger
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
