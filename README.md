# Sai Communication — Retail ERP

Admin Portal + Staff Portal + Public Website, sharing one Supabase database.
No duplicate data entry: a price/stock change made anywhere shows up
everywhere else via Supabase Realtime.

## Structure

```
apps/
  admin/     Vite + React — owner's full-control back office (http://localhost:5173)
  staff/     Vite + React — mobile-first billing/clock-in portal (http://localhost:5174)
  web/       Next.js 14 — public catalog + enquiry form (http://localhost:3000)
packages/
  shared/    One Supabase client, TS types, Excel export util, GST PDF generator,
             design tokens — imported by all three apps as "@sai/shared"
supabase/
  migrations/  Run in order: 0001 schema, 0002 functions/triggers, 0003 RLS, 0004 realtime,
               0005 Phase 1 gap-fill schema, 0006 Phase 1 gap-fill RLS/realtime
  seed.sql     Optional seed data + instructions for creating your first admin/staff logins
  functions/create-staff/  Edge Function the Admin "Add Staff" form calls (service role)
```

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project. Note the **Project URL**
   and **anon public key** (Project Settings → API).
2. In the SQL Editor, run the files in `supabase/migrations/` **in order**
   (0001 → 0002 → 0003 → 0004 → 0005 → 0006), then optionally `supabase/seed.sql`.
3. Storage → create a bucket named `wholesaler-invoices` (used by the invoice
   upload feature). Private is fine — the admin app is the only reader.
4. Auth → create your first admin user (email + password), then in the SQL
   Editor:
   ```sql
   insert into profiles (id, role) values ('<the-user-id-from-auth-users>', 'admin');
   ```
5. (Optional, needed for the Admin "Add Staff" button) Install the
   [Supabase CLI](https://supabase.com/docs/guides/cli), then:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase functions deploy create-staff
   ```
   Until this is deployed, create staff logins manually — see the comments in
   `supabase/seed.sql`.

## 2. Install dependencies

From the repo root (this is an npm workspaces monorepo — one install links
`@sai/shared` into all three apps):

```bash
npm install
```

## 3. Configure each app's environment

Copy each `.env.example` to the real env file and fill in the Supabase URL/key
from step 1:

```bash
cp apps/admin/.env.example apps/admin/.env
cp apps/staff/.env.example apps/staff/.env
cp apps/web/.env.example apps/web/.env.local
```

## 4. Run

```bash
npm run dev:admin   # http://localhost:5173
npm run dev:staff   # http://localhost:5174
npm run dev:web     # http://localhost:3000
```

## Notes

- **RLS roles**: `profiles.role` decides access — `admin` gets full read/write
  on every table; `staff` gets the scoped policies in
  `supabase/migrations/0003_rls_policies.sql`; the public site uses the `anon`
  key and can only read in-stock products and insert enquiries.
- **Stock sync**: `sale_items` inserts auto-decrement `products.stock_qty` via
  a DB trigger; confirming a wholesaler invoice calls the
  `process_wholesaler_invoice` RPC to increment it. No app code touches stock
  math directly — it's centralized in
  `supabase/migrations/0002_functions_triggers.sql`.
- **Excel export**: implemented once in
  `packages/shared/src/exportExcel.ts` (`exportToExcel`) and reused by the
  `<ExportExcelButton>` on every table page.
- **Phase 2** (staff live location map, deeper repair kanban automation,
  finance analytics, AI forecasting, push notifications, WhatsApp invoices)
  is intentionally not built — see the Dashboard/Analytics pages for where it
  would plug in. Note: `repairs`, `attendance`, `finance_partners`, and
  `third_party_purchases` tables already exist in the schema (0001) even
  though those modules are Phase 2 per the client spec — the tables are
  harmless to keep, but don't treat their presence as those features being
  "done" for Phase 1 sign-off.
- **Phase 1 gap-fill (0005/0006)**: added on top of the original schema to
  close gaps against the client spec — `categories` (admin-configurable,
  replacing a hardcoded check constraint), `stock_movements` (audit trail for
  every stock change: purchase/sale/return/manual adjustment via the new
  `adjust_stock_manual` RPC), `customer_notes` (staff review notes, separate
  from `sales.staff_notes`), `suppliers`, `settings` (business profile for
  invoice header + invoice numbering), GST line-item fields on `sale_items`
  (`hsn_sac`, `gst_rate`, `cgst`/`sgst`/`igst`, `discount`) and `payment_method`
  on `sales`, extra product fields (`brand`, `model`, `serial_number`,
  `description`, `image_url`), `created_by`/`updated_by` audit columns, and an
  auto-link trigger so a website enquiry creates/matches a `customers` row by
  phone instead of living in a separate enquiry table with no connection to
  the customer database.
