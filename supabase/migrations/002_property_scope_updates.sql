-- 002_property_scope_updates.sql
-- Safe follow-up migration for the standalone tenant app.

-- Remove chat-specific storage from the active scope.
drop table if exists public.tenant_chat_messages cascade;

-- Add updated_at columns for mutable entities.
alter table public.owners
  add column if not exists updated_at timestamptz not null default now();

alter table public.properties
  add column if not exists updated_at timestamptz not null default now();

alter table public.tenants
  add column if not exists updated_at timestamptz not null default now();

alter table public.support_tickets
  alter column updated_at set default now();

alter table public.rent_reminders
  add column if not exists updated_at timestamptz not null default now();

alter table public.owner_notifications
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_owners on public.owners;
create trigger set_updated_at_owners
before update on public.owners
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_properties on public.properties;
create trigger set_updated_at_properties
before update on public.properties
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_tenants on public.tenants;
create trigger set_updated_at_tenants
before update on public.tenants
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_support_tickets on public.support_tickets;
create trigger set_updated_at_support_tickets
before update on public.support_tickets
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_rent_reminders on public.rent_reminders;
create trigger set_updated_at_rent_reminders
before update on public.rent_reminders
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_owner_notifications on public.owner_notifications;
create trigger set_updated_at_owner_notifications
before update on public.owner_notifications
for each row
execute function public.set_updated_at();

-- Query-performance indexes.
create index if not exists properties_owner_created_idx on public.properties(owner_id, created_at desc);
create index if not exists tenants_owner_status_idx on public.tenants(owner_id, status);
create index if not exists tenants_owner_payment_status_idx on public.tenants(owner_id, payment_status);
create index if not exists support_tickets_owner_created_idx on public.support_tickets(owner_id, created_at desc);
create index if not exists support_tickets_tenant_created_idx on public.support_tickets(tenant_id, created_at desc);
create index if not exists rent_reminders_owner_status_scheduled_idx on public.rent_reminders(owner_id, status, scheduled_for);
create index if not exists owner_notifications_owner_read_created_idx on public.owner_notifications(owner_id, is_read, created_at desc);

-- Keep RLS enabled on scoped tables.
alter table public.owners enable row level security;
alter table public.properties enable row level security;
alter table public.tenants enable row level security;
alter table public.support_tickets enable row level security;
alter table public.rent_reminders enable row level security;
alter table public.owner_notifications enable row level security;