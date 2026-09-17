-- Gallery: support video uploads alongside images.
-- Adds a media_type column so the frontend can render <video> vs <img>,
-- and raises the gallery bucket's file size limit to 1GB for video uploads.

alter table public.gallery add column if not exists media_type text not null default 'image';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gallery_media_type_check'
  ) then
    alter table public.gallery add constraint gallery_media_type_check check (media_type in ('image', 'video'));
  end if;
end $$;

update storage.buckets
set file_size_limit = 1073741824, -- 1GB
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
where id = 'gallery';
