-- Fixes two live bugs found during end-to-end testing:
--
-- 1. Customer review submission (ReviewForm.tsx) fails with 401 /
--    PostgREST 42501 for every customer — `reviews` has table-level grants
--    for anon (confirmed) but NO RLS policy permits an anon INSERT at all
--    (only a SELECT-when-featured policy and an admin-only ALL policy
--    exist). New reviews must land as unfeatured/unmoderated — the
--    `with check` blocks a submitter from setting is_featured themselves,
--    matching how "Featured reviews publicly viewable" already gates
--    public visibility on is_featured = true (i.e. admin approval, via
--    the "Customer Testimonials" moderation flow).
--
-- 2. "Track Repair Status" (repair-track.tsx) always shows nothing —
--    `repair_enquiries` only has an anon INSERT policy ("Anyone can
--    submit a repair enquiry"), no SELECT policy, so the tracking page's
--    read-by-phone query is silently filtered to zero rows by RLS.
--    Mirrors the exact pattern `website_orders` already uses for its
--    (working) Order Tracking page: an open SELECT policy, phone
--    filtering handled client-side by the query itself.

drop policy if exists "Anyone can submit a review" on public.reviews;
create policy "Anyone can submit a review" on public.reviews
  for insert
  to anon, authenticated
  with check (is_featured = false);

drop policy if exists "Repair enquiries viewable for tracking" on public.repair_enquiries;
create policy "Repair enquiries viewable for tracking" on public.repair_enquiries
  for select
  to anon, authenticated
  using (true);
