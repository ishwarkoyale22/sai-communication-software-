-- ============================================================================
-- 0010_product_images_storage.sql
-- Creates a public storage bucket for product photos, with admin-only
-- write access (is_admin()) and public read access — same pattern as
-- every other RLS policy this session. Nothing here touches the
-- `inventory` table itself.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "public_read_product_images" on storage.objects;
create policy "public_read_product_images" on storage.objects
  for select
  using (bucket_id = 'product-images');

drop policy if exists "admin_upload_product_images" on storage.objects;
create policy "admin_upload_product_images" on storage.objects
  for insert
  with check (bucket_id = 'product-images' and is_admin());

drop policy if exists "admin_update_product_images" on storage.objects;
create policy "admin_update_product_images" on storage.objects
  for update
  using (bucket_id = 'product-images' and is_admin())
  with check (bucket_id = 'product-images' and is_admin());

drop policy if exists "admin_delete_product_images" on storage.objects;
create policy "admin_delete_product_images" on storage.objects
  for delete
  using (bucket_id = 'product-images' and is_admin());
