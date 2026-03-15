-- 018_cash_flow_reporting.sql
-- Adds durable cash-flow report snapshots, maintenance cost entries,
-- and owner-level alert settings for Automation 07.

alter table public.owner_automation_settings
  add column if not exists cash_flow_reporting_enabled boolean not null default true,
  add column if not exists yield_alert_threshold_percent numeric(5,2),
  add column if not exists yield_alert_cooldown_days integer not null default 7;

update public.owner_automation_settings
set
  cash_flow_reporting_enabled = coalesce(cash_flow_reporting_enabled, true),
  yield_alert_cooldown_days = coalesce(yield_alert_cooldown_days, 7);

alter table public.owner_automation_settings
  drop constraint if exists owner_automation_settings_yield_alert_threshold_check;
alter table public.owner_automation_settings
  add constraint owner_automation_settings_yield_alert_threshold_check
  check (yield_alert_threshold_percent is null or yield_alert_threshold_percent >= 0);

alter table public.owner_automation_settings
  drop constraint if exists owner_automation_settings_yield_alert_cooldown_check;
alter table public.owner_automation_settings
  add constraint owner_automation_settings_yield_alert_cooldown_check
  check (yield_alert_cooldown_days between 1 and 90);

create table if not exists public.maintenance_cost_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  source_ticket_id uuid references public.support_tickets(id) on delete set null,
  source_type text not null default 'manual',
  recorded_by_role text not null default 'system',
  recorded_by_owner_id uuid references public.owners(id) on delete set null,
  recorded_by_admin_id uuid references public.admin_users(id) on delete set null,
  vendor_name text,
  description text,
  invoice_ref text,
  amount numeric(12,2) not null,
  incurred_on date not null,
  status text not null default 'recorded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_cost_entries_source_type_check check (source_type in ('manual', 'ticket', 'invoice', 'automation')),
  constraint maintenance_cost_entries_recorded_by_role_check check (recorded_by_role in ('owner', 'admin', 'system')),
  constraint maintenance_cost_entries_status_check check (status in ('recorded', 'voided')),
  constraint maintenance_cost_entries_amount_check check (amount >= 0),
  constraint maintenance_cost_entries_identity_check check (
    (recorded_by_role = 'owner' and recorded_by_owner_id is not null and recorded_by_admin_id is null)
    or (recorded_by_role = 'admin' and recorded_by_admin_id is not null and recorded_by_owner_id is null)
    or (recorded_by_role = 'system' and recorded_by_owner_id is null and recorded_by_admin_id is null)
  )
);

create index if not exists maintenance_cost_entries_owner_incurred_idx
  on public.maintenance_cost_entries (owner_id, incurred_on desc);

create index if not exists maintenance_cost_entries_property_incurred_idx
  on public.maintenance_cost_entries (property_id, incurred_on desc);

create table if not exists public.cash_flow_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  automation_job_id uuid references public.automation_jobs(id) on delete set null,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  report_scope text not null,
  trigger_type text not null,
  report_year integer not null,
  report_month integer not null,
  report_period_key text not null,
  report_label text not null,
  period_start date not null,
  period_end date not null,
  currency_code text not null default 'INR',
  property_count integer not null default 0,
  portfolio_gross_rent numeric(12,2) not null default 0,
  portfolio_maintenance numeric(12,2) not null default 0,
  portfolio_fixed_charges numeric(12,2) not null default 0,
  portfolio_net_income numeric(12,2) not null default 0,
  portfolio_yield_percent numeric(7,2),
  below_target_count integer not null default 0,
  alerts_sent jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cash_flow_report_snapshots_scope_check check (report_scope in ('current', 'monthly', 'annual')),
  constraint cash_flow_report_snapshots_trigger_type_check check (trigger_type in ('schedule', 'event', 'manual')),
  constraint cash_flow_report_snapshots_report_year_check check (report_year between 2000 and 9999),
  constraint cash_flow_report_snapshots_report_month_check check (report_month between 1 and 12),
  constraint cash_flow_report_snapshots_property_count_check check (property_count >= 0),
  constraint cash_flow_report_snapshots_below_target_count_check check (below_target_count >= 0)
);

create index if not exists cash_flow_report_snapshots_owner_scope_created_idx
  on public.cash_flow_report_snapshots (owner_id, report_scope, created_at desc);

create index if not exists cash_flow_report_snapshots_org_scope_period_idx
  on public.cash_flow_report_snapshots (organization_id, report_scope, report_period_key, created_at desc);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'cash_flow_monthly_report',
  'email',
  'Cash flow report | {{reportPeriod}}',
  'Monthly cash-flow report for {{reportPeriod}}. Gross rent received: {{portfolioGrossRent}}. Maintenance: {{portfolioMaintenance}}. Fixed charges: {{portfolioFixedCharges}}. Net income: {{portfolioNetIncome}}. Portfolio yield: {{portfolioYield}}.'
where not exists (
  select 1 from public.message_templates
  where organization_id is null
    and template_key = 'cash_flow_monthly_report'
    and channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'cash_flow_monthly_report',
  'in_app',
  null,
  'Cash-flow report ready for {{reportPeriod}}. Net income: {{portfolioNetIncome}} across {{propertyCount}} properties.'
where not exists (
  select 1 from public.message_templates
  where organization_id is null
    and template_key = 'cash_flow_monthly_report'
    and channel = 'in_app'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'cash_flow_yield_alert',
  'email',
  'Yield alert | {{reportLabel}}',
  'Attention required: yield has fallen below the configured threshold for {{alertCount}} tracked items in {{reportLabel}}. Portfolio yield: {{portfolioYield}}. Immediate review recommended.'
where not exists (
  select 1 from public.message_templates
  where organization_id is null
    and template_key = 'cash_flow_yield_alert'
    and channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'cash_flow_yield_alert',
  'in_app',
  null,
  'Yield alert raised for {{reportLabel}}. {{alertCount}} item(s) are below target. Review portfolio cash flow.'
where not exists (
  select 1 from public.message_templates
  where organization_id is null
    and template_key = 'cash_flow_yield_alert'
    and channel = 'in_app'
);

drop trigger if exists set_updated_at_maintenance_cost_entries on public.maintenance_cost_entries;
create trigger set_updated_at_maintenance_cost_entries
before update on public.maintenance_cost_entries
for each row
execute function public.set_updated_at();

alter table public.maintenance_cost_entries enable row level security;
alter table public.cash_flow_report_snapshots enable row level security;
