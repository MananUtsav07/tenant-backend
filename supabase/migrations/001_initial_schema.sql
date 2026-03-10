-- 001_initial_schema.sql
-- Run in Supabase SQL editor

create extension if not exists pgcrypto;

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text,
  company_name text,
  support_email text,
  support_whatsapp text,
  created_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_name text not null,
  address text not null,
  unit_number text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  tenant_access_id text not null unique,
  password_hash text not null,
  lease_start_date date,
  lease_end_date date,
  monthly_rent numeric(12,2) not null default 0,
  payment_due_day integer not null default 1,
  payment_status text not null default 'pending',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint tenants_due_day_check check (payment_due_day between 1 and 31),
  constraint tenants_payment_status_check check (payment_status in ('pending','paid','overdue','partial')),
  constraint tenants_status_check check (status in ('active','inactive','terminated'))
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_status_check check (status in ('open','in_progress','resolved','closed'))
);

create table if not exists public.tenant_chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  sender_type text not null,
  message text not null,
  intent text,
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint tenant_chat_messages_sender_type_check check (sender_type in ('tenant','bot','owner'))
);

create table if not exists public.rent_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  reminder_type text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint rent_reminders_status_check check (status in ('pending','sent','failed','canceled')),
  constraint rent_reminders_type_check check (reminder_type in ('7_days_before','1_day_before','due_today','3_days_late','7_days_late'))
);

create table if not exists public.owner_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  notification_type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists properties_owner_id_idx on public.properties(owner_id);
create index if not exists tenants_owner_id_idx on public.tenants(owner_id);
create index if not exists tenants_property_id_idx on public.tenants(property_id);
create index if not exists tenants_access_id_idx on public.tenants(tenant_access_id);
create index if not exists support_tickets_owner_status_idx on public.support_tickets(owner_id, status);
create index if not exists support_tickets_tenant_id_idx on public.support_tickets(tenant_id);
create index if not exists tenant_chat_messages_tenant_idx on public.tenant_chat_messages(tenant_id, created_at desc);
create index if not exists tenant_chat_messages_owner_idx on public.tenant_chat_messages(owner_id, created_at desc);
create index if not exists tenant_chat_messages_escalated_idx on public.tenant_chat_messages(escalated);
create index if not exists rent_reminders_owner_idx on public.rent_reminders(owner_id, scheduled_for);
create index if not exists rent_reminders_status_idx on public.rent_reminders(status, scheduled_for);
create unique index if not exists rent_reminders_unique_idx on public.rent_reminders(tenant_id, reminder_type, scheduled_for);
create index if not exists owner_notifications_owner_idx on public.owner_notifications(owner_id, is_read, created_at desc);

alter table public.owners enable row level security;
alter table public.properties enable row level security;
alter table public.tenants enable row level security;
alter table public.support_tickets enable row level security;
alter table public.tenant_chat_messages enable row level security;
alter table public.rent_reminders enable row level security;
alter table public.owner_notifications enable row level security;

-- Backend uses service role. With RLS enabled and no public policies, direct anon access is blocked.