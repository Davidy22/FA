-- Rebrand: "Fab Anything" is now "Make Anyth.ing".
--
-- Brand-derived prefixes move from 'FA' to 'MA':
--   * order numbers   FA-YYYY-NNNNNN -> MA-YYYY-NNNNNN
--   * reward coupons  FA##########   -> MA##########  (offer codes keep 'OF')
--
-- Existing rows are never rewritten: old FA-* order numbers and coupon codes stay
-- valid, so links in already-sent confirmation emails keep working. New rows only.
--
-- Numbering stays continuous rather than restarting at 1. The sequence below
-- counts both prefixes, so the first new MA-YYYY-NNNNNN order continues where
-- FA-YYYY-NNNNNN left off. 'MA-' and 'FA-' differ, so the unique index on
-- orders.order_number can never collide across the two generations.

-- ------- generate order number -------
create or replace function public.next_order_number()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  year text := to_char(now(), 'YYYY');
  seq bigint;
begin
  -- Best-effort monotonic numbering scoped by year using a gapless sequence emulated via advisory lock.
  perform pg_advisory_xact_lock(hashtext('ma.order_number.'||year));
  -- Both prefixes feed the same counter so rebranding does not restart numbering.
  select coalesce(max(nullif(regexp_replace(order_number, '^(FA|MA)-'||year||'-', ''),'')::bigint),0) + 1
    into seq from public.orders where order_number ~ ('^(FA|MA)-'||year||'-');
  return 'MA-'||year||'-'||lpad(seq::text, 6, '0');
end;
$$;

-- ------- internal helpers -------

-- Unambiguous code alphabet (no 0/O/1/I). Not cryptographic on its own; callers
-- retry on the unique index, and codes are combined with per-user claims locks.
create or replace function public._coupon_code(p_prefix text default 'MA', p_len int default 10)
returns text
language plpgsql volatile
set search_path = public
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_out text := '';
  i int;
begin
  for i in 1..p_len loop
    v_out := v_out || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
  end loop;
  return p_prefix || v_out;
end;
$$;
