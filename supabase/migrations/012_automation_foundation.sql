-- 012_automation_foundation.sql
-- In-house automation foundation for Prophives wave-1 workflows.

create table if not exists public.owner_automation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  compliance_alerts_enabled boolean not null default true,
  rent_chasing_enabled boolean not null default true,
  portfolio_visibility_enabled boolean not null default true,
  daily_digest_enabled boolean not null default true,
  weekly_digest_enabled boolean not null default false,
  monthly_digest_enabled boolean not null default false,
  status_command_enabled boolean not null default true,
  quiet_hours_start text,
  quiet_hours_end text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_automation_settings_owner_org_unique unique (organization_id, owner_id),
  constraint owner_automation_settings_quiet_hours_start_check check (
    quiet_hours_start is null or quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  constraint owner_automation_settings_quiet_hours_end_check check (
    quiet_hours_end is null or quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  )
);

create index if not exists owner_automation_settings_owner_idx
  on public.owner_automation_settings (owner_id);

create table if not exists public.legal_dates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  ejari_expiry date,
  contract_end date,
  rera_notice_date date,
  form12_sent boolean not null default false,
  renewal_status text not null default 'unknown',
  alert_120_sent_at timestamptz,
  alert_90_sent_at timestamptz,
  alert_60_sent_at timestamptz,
  alert_30_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_dates_renewal_status_check check (
    renewal_status in ('unknown', 'renewed', 'not_renewed', 'vacating')
  ),
  constraint legal_dates_has_relevant_date_check check (
    ejari_expiry is not null or contract_end is not null
  )
);

create index if not exists legal_dates_org_owner_idx
  on public.legal_dates (organization_id, owner_id, created_at desc);

create index if not exists legal_dates_ejari_expiry_idx
  on public.legal_dates (ejari_expiry)
  where ejari_expiry is not null;

create index if not exists legal_dates_contract_end_idx
  on public.legal_dates (contract_end)
  where contract_end is not null;

create table if not exists public.rent_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  cycle_year integer not null,
  cycle_month integer not null,
  due_date date not null,
  amount_due numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  paid_date date,
  status text not null default 'pending',
  reminder_count integer not null default 0,
  last_reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rent_ledger_status_check check (status in ('pending', 'paid', 'overdue')),
  constraint rent_ledger_cycle_month_check check (cycle_month between 1 and 12),
  constraint rent_ledger_cycle_year_check check (cycle_year between 2000 and 9999),
  constraint rent_ledger_amount_due_check check (amount_due >= 0),
  constraint rent_ledger_amount_paid_check check (amount_paid >= 0),
  constraint rent_ledger_paid_date_check check (
    paid_date is null or paid_date >= due_date
  ),
  constraint rent_ledger_unique_cycle unique (organization_id, tenant_id, cycle_year, cycle_month)
);

create index if not exists rent_ledger_owner_status_idx
  on public.rent_ledger (owner_id, status, due_date);

create index if not exists rent_ledger_org_cycle_idx
  on public.rent_ledger (organization_id, cycle_year, cycle_month);

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete cascade,
  job_type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  locked_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_jobs_status_check check (status in ('pending', 'processing', 'completed', 'failed', 'canceled')),
  constraint automation_jobs_attempts_check check (attempts >= 0),
  constraint automation_jobs_max_attempts_check check (max_attempts >= 1),
  constraint automation_jobs_dedupe_key_unique unique (dedupe_key)
);

create index if not exists automation_jobs_status_run_at_idx
  on public.automation_jobs (status, run_at);

create index if not exists automation_jobs_org_owner_idx
  on public.automation_jobs (organization_id, owner_id, created_at desc);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.automation_jobs(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete cascade,
  flow_name text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  processed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_runs_status_check check (status in ('success', 'failed', 'partial')),
  constraint automation_runs_processed_count_check check (processed_count >= 0)
);

create index if not exists automation_runs_flow_started_idx
  on public.automation_runs (flow_name, started_at desc);

create index if not exists automation_runs_org_owner_idx
  on public.automation_runs (organization_id, owner_id, started_at desc);

create table if not exists public.automation_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.automation_runs(id) on delete set null,
  job_id uuid references public.automation_jobs(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete cascade,
  flow_name text not null,
  error_message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists automation_errors_flow_created_idx
  on public.automation_errors (flow_name, created_at desc);

create index if not exists automation_errors_org_owner_idx
  on public.automation_errors (organization_id, owner_id, created_at desc);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  template_key text not null,
  channel text not null default 'email',
  subject text,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_channel_check check (channel in ('email', 'whatsapp', 'in_app')),
  constraint message_templates_unique_key_channel unique (organization_id, template_key, channel)
);

create index if not exists message_templates_key_channel_idx
  on public.message_templates (template_key, channel, is_active);

drop trigger if exists set_updated_at_owner_automation_settings on public.owner_automation_settings;
create trigger set_updated_at_owner_automation_settings
before update on public.owner_automation_settings
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_legal_dates on public.legal_dates;
create trigger set_updated_at_legal_dates
before update on public.legal_dates
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_rent_ledger on public.rent_ledger;
create trigger set_updated_at_rent_ledger
before update on public.rent_ledger
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_automation_jobs on public.automation_jobs;
create trigger set_updated_at_automation_jobs
before update on public.automation_jobs
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_automation_runs on public.automation_runs;
create trigger set_updated_at_automation_runs
before update on public.automation_runs
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_message_templates on public.message_templates;
create trigger set_updated_at_message_templates
before update on public.message_templates
for each row
execute function public.set_updated_at();

alter table public.owner_automation_settings enable row level security;
alter table public.legal_dates enable row level security;
alter table public.rent_ledger enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_errors enable row level security;
alter table public.message_templates enable row level security;
