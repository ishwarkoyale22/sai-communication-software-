-- 0058_inventory_hsn_gst.sql
-- Products can carry the HSN/SAC code and GST rate that a tax invoice needs (Rule 46 of the CGST Rules).
-- Both are optional: blank = the sale form's own default GST rate and no printed HSN, exactly as before.

alter table public.inventory
  add column if not exists hsn_sac text,
  add column if not exists gst_rate numeric;

-- Only real GST slabs (blank allowed).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_gst_rate_check') then
    alter table public.inventory
      add constraint inventory_gst_rate_check check (gst_rate is null or gst_rate in (0, 0.25, 3, 5, 12, 18, 28));
  end if;
end $$;
