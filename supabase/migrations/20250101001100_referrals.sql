-- Referrals are immutable after signup. Codes are unique UUID-derived identifiers.
alter table public.profiles add column referral_code text unique;
alter table public.profiles add column referred_by uuid references public.profiles(id);
update public.profiles set referral_code = upper(substr(replace(id::text, '-', ''), 1, 12)) where referral_code is null;
alter table public.profiles alter column referral_code set not null;
alter table public.profiles alter column referral_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
alter table public.profiles add constraint no_self_referral check (referred_by is distinct from id);
-- Re-create trigger so referral attribution is resolved only on the server, at account creation.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_referrer uuid;
begin
  select id into v_referrer from public.profiles
   where referral_code = upper(btrim(coalesce(new.raw_user_meta_data->>'referral_code', '')))
   limit 1;
  if nullif(btrim(coalesce(new.raw_user_meta_data->>'referral_code','')), '') is not null and v_referrer is null then
    raise exception 'Invalid referral code';
  end if;
  insert into public.profiles (id,email,display_name,role,referral_code,referred_by)
  values (new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),
          'customer',upper(substr(replace(new.id::text,'-',''),1,12)),v_referrer)
  on conflict (id) do nothing;
  insert into public.carts(user_id) values(new.id) on conflict (user_id) do nothing;
  return new;
end; $$;
-- Extend ledger type constraint; awards are idempotent by referee/order.
alter table public.reward_transactions drop constraint reward_transactions_type_check;
alter table public.reward_transactions add constraint reward_transactions_type_check
 check (type in ('order_earn','redeem','adjustment','referral_signup','referral_purchase'));
create unique index referral_signup_once on public.reward_transactions(user_id, type, (memo)) where type = 'referral_signup';
create unique index referral_purchase_once on public.reward_transactions(order_id) where type = 'referral_purchase';
create or replace function public.tg_referral_signup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.referred_by is not null then
    update public.profiles set points_balance = points_balance + 10 where id = new.referred_by;
    insert into public.reward_transactions(user_id,points,type,memo)
      values(new.referred_by,10,'referral_signup','Referral signup ' || new.id::text);
  end if;
  return new;
end; $$;
create trigger referral_signup after insert on public.profiles for each row execute function public.tg_referral_signup();
create or replace function public.tg_referral_purchase() returns trigger language plpgsql security definer set search_path = public as $$
declare v_referrer uuid;
begin
  select referred_by into v_referrer from public.profiles where id = new.user_id;
  if v_referrer is not null and not exists (
    select 1 from public.orders o where o.user_id = new.user_id and o.id <> new.id
  ) then
    update public.profiles set points_balance = points_balance + 50 where id = v_referrer;
    insert into public.reward_transactions(user_id,points,type,order_id,memo)
      values(v_referrer,50,'referral_purchase',new.id,'First purchase by referral');
  end if;
  return new;
end; $$;
create trigger referral_purchase after insert on public.orders for each row execute function public.tg_referral_purchase();
