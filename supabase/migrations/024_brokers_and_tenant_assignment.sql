create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  agency_name text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brokers_org_active_idx
  on public.brokers(organization_id, is_active, created_at desc);

create index if not exists brokers_org_email_idx
  on public.brokers(organization_id, email);

drop trigger if exists set_updated_at_brokers on public.brokers;
create trigger set_updated_at_brokers
before update on public.brokers
for each row
execute function public.set_updated_at();

alter table public.brokers enable row level security;

alter table public.tenants
  add column if not exists broker_id uuid references public.brokers(id) on delete set null;

create index if not exists tenants_broker_id_idx
  on public.tenants(broker_id);
