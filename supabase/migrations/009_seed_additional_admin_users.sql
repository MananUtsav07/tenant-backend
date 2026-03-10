-- 009_seed_additional_admin_users.sql
-- Adds two additional admin users.
-- Password for both users: Manan@1234

insert into public.admin_users (email, password_hash, full_name)
values
  (
    'mananutsav100@gmail.com',
    crypt('Manan@1234', gen_salt('bf')),
    'Manan Utsav'
  ),
  (
    'tusharjainqwerty@gmail.com',
    crypt('12345678', gen_salt('bf')),
    'Tushar Jain'
  )
on conflict (email) do update
set
  password_hash = excluded.password_hash,
  full_name = excluded.full_name,
  updated_at = now();
