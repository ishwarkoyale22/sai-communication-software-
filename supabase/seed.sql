-- Optional seed data. Run after migrations, safe to skip in production.

insert into finance_partners (name) values
  ('Bajaj Finance'),
  ('Home Credit'),
  ('IDFC First Bank'),
  ('Cash / No Finance')
on conflict (name) do nothing;

-- To create your first admin:
-- 1. In Supabase Dashboard -> Authentication -> Users -> Add User
--    (email + password, e.g. owner@yourshop.com)
-- 2. Copy the generated user id, then run:
--
-- insert into profiles (id, role) values ('<auth-user-uuid>', 'admin');
--
-- To create a staff login (phone 9876543210, PIN 1234):
-- 1. Insert into staff first:
--    insert into staff (name, role, phone, pin) values ('Ravi', 'cashier', '9876543210', '1234')
--    returning id;
-- 2. In Supabase Dashboard -> Authentication -> Users -> Add User
--    email: 9876543210@staff.internal, password: 1234
-- 3. insert into profiles (id, role, staff_id) values ('<auth-user-uuid>', 'staff', '<staff-id-from-step-1>');
--    update staff set auth_user_id = '<auth-user-uuid>' where id = '<staff-id-from-step-1>';
--
-- The Admin Portal's "Add Staff" form automates steps 1-3 via a Supabase Edge
-- Function (service role) — see supabase/functions/create-staff.
