-- Order status transition enforcement
create or replace function public.tg_enforce_order_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  role text;
begin
  -- No change: nothing to do
  if new.status = old.status then
    return new;
  end if;

  role := public.auth_role();

  -- Admin can do any transition including refunded
  if role = 'admin' then
    if new.status = 'refunded' and old.status not in ('shipped','cancelled') then
      raise exception 'Refund only allowed from shipped or cancelled status';
    end if;
    return new;
  end if;

  -- Anyone may cancel (with reason) but refund is admin only
  if new.status = 'cancelled' then
    if new.cancel_reason is null or length(trim(new.cancel_reason)) = 0 then
      raise exception 'cancel_reason required when cancelling';
    end if;
    return new;
  end if;

  if new.status = 'refunded' then
    raise exception 'Only admin can refund';
  end if;

  -- Staff transitions: pending->printing->completed->shipped
  if role not in ('employee','manager') then
    raise exception 'Status change not permitted for role %', role;
  end if;

  if old.status = 'pending' and new.status = 'printing' then return new; end if;
  if old.status = 'printing' and new.status = 'completed' then return new; end if;
  if old.status = 'completed' and new.status = 'shipped' then return new; end if;

  raise exception 'Illegal order status transition: % -> %', old.status, new.status;
end;
$$;

create trigger enforce_order_status
before update of status on public.orders
for each row execute function public.tg_enforce_order_status();
