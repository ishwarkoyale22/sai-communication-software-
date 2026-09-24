-- Adds 'Home Appliances' as an inventory category (the app's category list
-- and this check constraint must stay in sync).
alter table public.inventory drop constraint if exists inventory_category_check;
alter table public.inventory add constraint inventory_category_check
  check (category = ANY (ARRAY['Smartphones', 'Feature Phones', 'Tablets', 'Accessories', 'Refurbished', 'Home Appliances']));
