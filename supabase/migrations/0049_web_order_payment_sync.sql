-- 0049: website orders' payment_status could never be changed from the admin, so a
-- delivered (and paid-at-the-counter) order stayed "Pending" on the admin Sales page
-- and on the customer's tracking page forever. The admin Web Orders screen now lets
-- the shop set it; this keeps the linked sale (created when the order is delivered)
-- in step, in either order (paid before or after delivery).
create or replace function public.website_order_sync_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sale_id is not null then
    update public.sales
    set payment_status = case new.payment_status
                           when 'paid' then 'paid'
                           when 'partial' then 'partial'
                           else 'pending'
                         end
    where id = new.sale_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_website_order_sync_payment on public.website_orders;
create trigger trg_website_order_sync_payment
  after update of payment_status on public.website_orders
  for each row when (new.payment_status is distinct from old.payment_status)
  execute function public.website_order_sync_payment();
