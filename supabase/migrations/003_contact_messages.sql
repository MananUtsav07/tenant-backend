-- 003_contact_messages.sql
-- Public website contact form storage.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_created_at_idx on public.contact_messages(created_at desc);
create index if not exists contact_messages_email_idx on public.contact_messages(email);

alter table public.contact_messages enable row level security;

