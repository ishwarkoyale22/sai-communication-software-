-- 0050: finance report files were readable by anyone. Migration 0035 left a
-- `finance_report_files_read` policy (anon + authenticated) on the bucket, so
-- once the bucket exists (0046) any visitor could list and download every
-- uploaded report. Only admins may read them (via signed links); staff can
-- still upload. Also drop the duplicate upload policy added in 0046.
drop policy if exists "finance_report_files_read" on storage.objects;
drop policy if exists "finance_reports_staff_upload" on storage.objects;
