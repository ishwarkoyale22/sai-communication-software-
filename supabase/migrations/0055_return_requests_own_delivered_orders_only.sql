-- A signed-in customer could file a return request for ANY order id (the insert policy only
-- checked customer_id = auth.uid()). Restrict it to the customer's own delivered/collected
-- orders, and to one open request per order — matching what the website form offers.
drop policy if exists "Users create own return requests" on public.return_requests;
create policy "Users create own return requests" on public.return_requests
  for insert to authenticated
  with check (
    auth.uid() = customer_id
    and exists (
      select 1 from public.website_orders o
      where o.id = order_id
        and o.customer_id = auth.uid()
        and o.order_status in ('delivered', 'collected')
    )
    and not exists (
      select 1 from public.return_requests r
      where r.order_id = order_id and r.status in ('requested', 'approved')
    )
  );
