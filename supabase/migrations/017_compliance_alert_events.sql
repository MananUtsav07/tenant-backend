-- 017_compliance_alert_events.sql
-- Adds a durable audit trail for compliance reminders and 30-day legal-action preparation scaffolding.

create table if not exists public.compliance_alert_events (
  id uuid primary key default gen_random_uuid(),
  legal_date_id uuid not null references public.legal_dates(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  automation_job_id uuid references public.automation_jobs(id) on delete set null,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  trigger_date_type text not null,
  threshold_days integer not null,
  relevant_date date not null,
  days_remaining integer not null,
  notification_type text not null default 'compliance_alert',
  message_subject text,
  message_preview text,
  delivery_channels jsonb not null default '[]'::jsonb,
  next_action text,
  legal_action_recommended boolean not null default false,
  legal_action_initiated boolean not null default false,
  draft_title text,
  draft_body text,
  draft_payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint compliance_alert_events_trigger_date_type_check check (
    trigger_date_type in ('ejari_expiry', 'contract_end', 'rera_notice_date')
  ),
  constraint compliance_alert_events_threshold_days_check check (
    threshold_days in (120, 90, 60, 30)
  ),
  constraint compliance_alert_events_notification_type_check check (
    notification_type in ('compliance_alert', 'compliance_alert_urgent')
  ),
  constraint compliance_alert_events_days_remaining_check check (days_remaining >= 0),
  constraint compliance_alert_events_unique_threshold unique (legal_date_id, trigger_date_type, threshold_days)
);

create index if not exists compliance_alert_events_owner_sent_idx
  on public.compliance_alert_events (owner_id, sent_at desc);

create index if not exists compliance_alert_events_org_sent_idx
  on public.compliance_alert_events (organization_id, sent_at desc);

create index if not exists compliance_alert_events_job_idx
  on public.compliance_alert_events (automation_job_id, automation_run_id);

create index if not exists compliance_alert_events_recommended_idx
  on public.compliance_alert_events (organization_id, legal_action_recommended, sent_at desc)
  where legal_action_recommended = true;

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'compliance_alert',
  'email',
  'Compliance reminder: {{triggerLabel}} in {{daysRemaining}} days',
  'Property: {{propertyName}}\nUnit: {{unitNumber}}\nTenant: {{tenantName}}\nDate: {{relevantDateLabel}}\nDays remaining: {{daysRemaining}}\nNext action: {{recommendedAction}}'
where not exists (
  select 1
  from public.message_templates mt
  where mt.organization_id is null
    and mt.template_key = 'compliance_alert'
    and mt.channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'compliance_alert',
  'in_app',
  'Compliance reminder: {{triggerLabel}} in {{daysRemaining}} days',
  '{{propertyName}} {{unitLabel}} requires attention. {{triggerLabel}} is due on {{relevantDateLabel}}. Next action: {{recommendedAction}}'
where not exists (
  select 1
  from public.message_templates mt
  where mt.organization_id is null
    and mt.template_key = 'compliance_alert'
    and mt.channel = 'in_app'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'compliance_alert_urgent',
  'email',
  'Urgent compliance action: {{triggerLabel}} in {{daysRemaining}} days',
  'Property: {{propertyName}}\nUnit: {{unitNumber}}\nTenant: {{tenantName}}\nDate: {{relevantDateLabel}}\nThis item has reached the 30-day action window.\nNext action: {{recommendedAction}}\nDraft note: {{draftTitle}}'
where not exists (
  select 1
  from public.message_templates mt
  where mt.organization_id is null
    and mt.template_key = 'compliance_alert_urgent'
    and mt.channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'compliance_alert_urgent',
  'in_app',
  'Urgent compliance action: {{triggerLabel}} in {{daysRemaining}} days',
  '{{propertyName}} {{unitLabel}} has entered the 30-day action window for {{triggerLabel}}. Next action: {{recommendedAction}}'
where not exists (
  select 1
  from public.message_templates mt
  where mt.organization_id is null
    and mt.template_key = 'compliance_alert_urgent'
    and mt.channel = 'in_app'
);

alter table public.compliance_alert_events enable row level security;
