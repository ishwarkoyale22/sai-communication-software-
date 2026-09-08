-- Gallery Management: the `gallery` table already exists live (id,
-- image_url, caption, sort_order, created_at — confirmed via REST
-- introspection, already has full anon/authenticated grants) and the
-- website's /gallery page already reads it — it's just permanently empty
-- because nothing has ever been able to upload to it. Adding a dedicated
-- public storage bucket + policies, mirroring the exact pattern already
-- used for product-images (public read, admin-only write via the existing
-- is_admin() helper).

insert into storage.buckets (id, name, public)
select 'gallery', 'gallery', true
where not exists (select 1 from storage.buckets where id = 'gallery');

drop policy if exists "public_read_gallery" on storage.objects;
create policy "public_read_gallery" on storage.objects
  for select using (bucket_id = 'gallery');

drop policy if exists "admin_upload_gallery" on storage.objects;
create policy "admin_upload_gallery" on storage.objects
  for insert with check (bucket_id = 'gallery' and is_admin());

drop policy if exists "admin_update_gallery" on storage.objects;
create policy "admin_update_gallery" on storage.objects
  for update using (bucket_id = 'gallery' and is_admin()) with check (bucket_id = 'gallery' and is_admin());

drop policy if exists "admin_delete_gallery" on storage.objects;
create policy "admin_delete_gallery" on storage.objects
  for delete using (bucket_id = 'gallery' and is_admin());
