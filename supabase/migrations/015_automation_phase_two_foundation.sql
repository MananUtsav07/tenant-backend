-- 015_automation_phase_two_foundation.sql
-- Expands the automation layer with rule journaling, integration events,
-- and property financial profiles used by reporting flows.

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete cascade,
  rule_key text not null,
  trigger_type text not null default 'schedule',
  enabled boolean not null default true,
  schedule_expression text,
  channel_preferences jsonb not null default '["email"]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rules_trigger_type_check check (trigger_type in ('schedule', 'event')),
  constraint automation_rules_unique_key unique (organization_id, owner_id, rule_key)
);

create index if not exists automation_rules_org_owner_idx
  on public.automation_rules (organization_id, owner_id, enabled);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  provider text not null,
  event_type text not null,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_events_status_check check (status in ('received', 'processing', 'processed', 'failed'))
);

create index if not exists integration_events_provider_status_idx
  on public.integration_events (provider, status, received_at desc);

create index if not exists integration_events_org_created_idx
  on public.integration_events (organization_id, created_at desc);

create unique index if not exists integration_events_dedupe_key_unique_idx
  on public.integration_events (dedupe_key)
  where dedupe_key is not null;

create table if not exists public.property_financial_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  service_charge_monthly numeric(12,2) not null default 0,
  agency_fee_monthly numeric(12,2) not null default 0,
  property_value numeric(14,2),
  target_yield_percent numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_financial_profiles_unique_property unique (property_id),
  constraint property_financial_profiles_service_charge_check check (service_charge_monthly >= 0),
  constraint property_financial_profiles_agency_fee_check check (agency_fee_monthly >= 0),
  constraint property_financial_profiles_property_value_check check (property_value is null or property_value >= 0),
  constraint property_financial_profiles_target_yield_check check (target_yield_percent is null or target_yield_percent >= 0)
);

insert into public.property_financial_profiles (organization_id, property_id)
select p.organization_id, p.id
from public.properties p
where not exists (
  select 1
  from public.property_financial_profiles pfp
  where pfp.property_id = p.id
);

create index if not exists property_financial_profiles_org_idx
  on public.property_financial_profiles (organization_id, property_id);

drop trigger if exists set_updated_at_automation_rules on public.automation_rules;
create trigger set_updated_at_automation_rules
before update on public.automation_rules
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_integration_events on public.integration_events;
create trigger set_updated_at_integration_events
before update on public.integration_events
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_property_financial_profiles on public.property_financial_profiles;
create trigger set_updated_at_property_financial_profiles
before update on public.property_financial_profiles
for each row
execute function public.set_updated_at();

alter table public.automation_rules enable row level security;
alter table public.integration_events enable row level security;
alter table public.property_financial_profiles enable row level security;
