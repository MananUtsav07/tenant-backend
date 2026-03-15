-- 019_portfolio_visibility_snapshots.sql
-- Adds durable portfolio visibility snapshots and baseline templates for Automation 05.

create table if not exists public.portfolio_visibility_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  automation_job_id uuid references public.automation_jobs(id) on delete set null,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  snapshot_scope text not null,
  trigger_type text not null,
  snapshot_label text not null,
  period_start date not null,
  period_end date not null,
  currency_code text not null default 'INR',
  active_tenant_count integer not null default 0,
  open_ticket_count integer not null default 0,
  new_ticket_count integer not null default 0,
  urgent_open_ticket_count integer not null default 0,
  stale_ticket_count integer not null default 0,
  overdue_rent_count integer not null default 0,
  reminders_pending_count integer not null default 0,
  awaiting_approvals_count integer not null default 0,
  occupied_property_count integer not null default 0,
  vacant_property_count integer not null default 0,
  upcoming_compliance_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint portfolio_visibility_snapshots_scope_check check (
    snapshot_scope in ('current', 'daily', 'weekly', 'monthly')
  ),
  constraint portfolio_visibility_snapshots_trigger_type_check check (
    trigger_type in ('schedule', 'event', 'manual')
  ),
  constraint portfolio_visibility_snapshots_active_tenant_count_check check (active_tenant_count >= 0),
  constraint portfolio_visibility_snapshots_open_ticket_count_check check (open_ticket_count >= 0),
  constraint portfolio_visibility_snapshots_new_ticket_count_check check (new_ticket_count >= 0),
  constraint portfolio_visibility_snapshots_urgent_open_ticket_count_check check (urgent_open_ticket_count >= 0),
  constraint portfolio_visibility_snapshots_stale_ticket_count_check check (stale_ticket_count >= 0),
  constraint portfolio_visibility_snapshots_overdue_rent_count_check check (overdue_rent_count >= 0),
  constraint portfolio_visibility_snapshots_reminders_pending_count_check check (reminders_pending_count >= 0),
  constraint portfolio_visibility_snapshots_awaiting_approvals_count_check check (awaiting_approvals_count >= 0),
  constraint portfolio_visibility_snapshots_occupied_property_count_check check (occupied_property_count >= 0),
  constraint portfolio_visibility_snapshots_vacant_property_count_check check (vacant_property_count >= 0),
  constraint portfolio_visibility_snapshots_upcoming_compliance_count_check check (upcoming_compliance_count >= 0)
);

create index if not exists portfolio_visibility_snapshots_owner_scope_created_idx
  on public.portfolio_visibility_snapshots (owner_id, snapshot_scope, created_at desc);

create index if not exists portfolio_visibility_snapshots_org_scope_created_idx
  on public.portfolio_visibility_snapshots (organization_id, snapshot_scope, created_at desc);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_daily_digest',
  'email',
  'Daily portfolio brief | {{snapshotLabel}}',
  'Daily Prophives portfolio visibility brief. Overdue rent: {{overdueRentCount}}. New tickets: {{newTicketCount}}. Urgent tickets: {{urgentOpenTicketCount}}. Upcoming compliance items: {{upcomingComplianceCount}}. Awaiting approvals: {{awaitingApprovalsCount}}.'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_daily_digest'
    and channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_daily_digest',
  'in_app',
  null,
  'Daily visibility brief ready. Overdue rent: {{overdueRentCount}}, urgent tickets: {{urgentOpenTicketCount}}, compliance items: {{upcomingComplianceCount}}.'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_daily_digest'
    and channel = 'in_app'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_weekly_digest',
  'email',
  'Weekly portfolio digest | {{snapshotLabel}}',
  'Weekly Prophives portfolio digest. Overdue rent: {{overdueRentCount}}. New tickets this week: {{newTicketCount}}. Open tickets: {{openTicketCount}}. Upcoming compliance items: {{upcomingComplianceCount}}. Vacant properties: {{vacantPropertyCount}}.'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_weekly_digest'
    and channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_weekly_digest',
  'in_app',
  null,
  'Weekly portfolio digest ready. Open tickets: {{openTicketCount}}, overdue rent: {{overdueRentCount}}, vacant properties: {{vacantPropertyCount}}.'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_weekly_digest'
    and channel = 'in_app'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_monthly_digest',
  'email',
  'Monthly portfolio overview | {{snapshotLabel}}',
  'Monthly Prophives portfolio overview. Overdue rent: {{overdueRentCount}}. Open tickets: {{openTicketCount}}. Upcoming compliance items: {{upcomingComplianceCount}}. Net income: {{cashFlowNetIncome}}. Trailing yield: {{cashFlowAnnualYield}}.'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_monthly_digest'
    and channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_monthly_digest',
  'in_app',
  null,
  'Monthly portfolio overview ready. Open tickets: {{openTicketCount}}, overdue rent: {{overdueRentCount}}, net income: {{cashFlowNetIncome}}.'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_monthly_digest'
    and channel = 'in_app'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_event_alert',
  'email',
  '{{alertTitle}}',
  '{{alertSummary}} Next action: {{ownerAction}}'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_event_alert'
    and channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'portfolio_event_alert',
  'in_app',
  null,
  '{{alertSummary}}'
where not exists (
  select 1
  from public.message_templates
  where organization_id is null
    and template_key = 'portfolio_event_alert'
    and channel = 'in_app'
);

alter table public.portfolio_visibility_snapshots enable row level security;
