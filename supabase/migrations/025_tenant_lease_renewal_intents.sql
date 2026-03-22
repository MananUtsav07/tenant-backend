create table if not exists public.lease_renewal_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  broker_id uuid references public.brokers(id) on delete set null,
  lease_end_date date not null,
  response text not null check (response in ('yes', 'no')),
  source text not null default 'tenant_dashboard',
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_renewal_intents_tenant_lease_unique unique (tenant_id, lease_end_date)
);

create index if not exists lease_renewal_intents_org_owner_idx
  on public.lease_renewal_intents (organization_id, owner_id, responded_at desc);

create index if not exists lease_renewal_intents_tenant_idx
  on public.lease_renewal_intents (tenant_id, lease_end_date desc);

drop trigger if exists set_updated_at_lease_renewal_intents on public.lease_renewal_intents;
create trigger set_updated_at_lease_renewal_intents
before update on public.lease_renewal_intents
for each row
execute function public.set_updated_at();

alter table public.lease_renewal_intents enable row level security;
