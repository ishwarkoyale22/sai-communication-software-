-- 0048: the admin New Sale form offers "Bank Transfer" (and the payment reports
-- already bucket it under Card), but sales.payment_method only allowed
-- cash/upi/card/emi/credit — so completing a Bank Transfer sale failed with a
-- check-constraint error. Allow it.
alter table public.sales drop constraint if exists sales_payment_method_check;
alter table public.sales add constraint sales_payment_method_check
  check (payment_method = any (array['cash','upi','card','emi','credit','bank_transfer']));
