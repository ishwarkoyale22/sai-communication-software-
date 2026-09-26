-- 0059_inventory_gst_rate_any.sql
-- The product GST rate can be any rate from 0 to 100 (new slabs appear over time, e.g. 40%), not a fixed list.
alter table public.inventory drop constraint if exists inventory_gst_rate_check;
alter table public.inventory
  add constraint inventory_gst_rate_check check (gst_rate is null or (gst_rate >= 0 and gst_rate <= 100));
