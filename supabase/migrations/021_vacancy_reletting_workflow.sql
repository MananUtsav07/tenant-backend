-- 021_vacancy_reletting_workflow.sql
-- Vacancy re-letting workflow foundation for Prophives Automation 02.

alter table public.properties
  add column if not exists occupancy_status text not null default 'occupied',
  add column if not exists expected_vacancy_date date,
  add column if not exists vacancy_marked_at timestamptz,
  add column if not exists availability_notes text;

alter table public.properties
  drop constraint if exists properties_occupancy_status_check;

alter table public.properties
  add constraint properties_occupancy_status_check
  check (occupancy_status in ('occupied', 'pre_vacant', 'vacant', 'relisting_in_progress'));

update public.properties p
set occupancy_status = case
  when exists (
    select 1
    from public.tenants t
    where t.property_id = p.id
      and t.organization_id = p.organization_id
      and t.status = 'active'
  ) then 'occupied'
  else 'vacant'
end;

update public.properties p
set expected_vacancy_date = vacancy_source.lease_end_date
from (
  select distinct on (t.property_id)
    t.property_id,
    t.lease_end_date
  from public.tenants t
  where t.status = 'active'
    and t.lease_end_date is not null
  order by t.property_id, t.lease_end_date asc
) as vacancy_source
where p.id = vacancy_source.property_id
  and p.expected_vacancy_date is null;

create index if not exists properties_organization_occupancy_status_idx
  on public.properties(organization_id, occupancy_status, created_at desc);

create index if not exists properties_expected_vacancy_date_idx
  on public.properties(expected_vacancy_date)
  where expected_vacancy_date is not null;

create table if not exists public.vacancy_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  source_type text not null,
  campaign_status text not null default 'owner_review',
  vacancy_state text not null default 'pre_vacant',
  expected_vacancy_date date not null,
  actual_vacancy_date date,
  trigger_reference text,
  trigger_notes text,
  listing_title text,
  listing_description text,
  listing_features jsonb not null default '[]'::jsonb,
  availability_label text,
  draft_source text not null default 'template',
  draft_generation_status text not null default 'ready',
  draft_generated_at timestamptz,
  owner_approved_at timestamptz,
  approved_by_owner_id uuid references public.owners(id) on delete set null,
  listing_sync_status text not null default 'pending_approval',
  listing_provider text,
  listing_external_id text,
  listing_url text,
  enquiry_count integer not null default 0,
  scheduled_viewings_count integer not null default 0,
  applications_count integer not null default 0,
  last_status_digest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vacancy_campaigns_source_type_check check (source_type in ('tenant_notice', 'lease_expiry', 'manual')),
  constraint vacancy_campaigns_campaign_status_check check (
    campaign_status in ('owner_review', 'approved', 'relisting_in_progress', 'listed', 'leased', 'cancelled')
  ),
  constraint vacancy_campaigns_vacancy_state_check check (
    vacancy_state in ('pre_vacant', 'vacant', 'relisting_in_progress')
  ),
  constraint vacancy_campaigns_draft_source_check check (draft_source in ('template', 'ai')),
  constraint vacancy_campaigns_draft_generation_status_check check (
    draft_generation_status in ('ready', 'skipped', 'failed')
  ),
  constraint vacancy_campaigns_listing_sync_status_check check (
    listing_sync_status in ('pending_approval', 'not_configured', 'queued', 'published', 'failed')
  ),
  constraint vacancy_campaigns_enquiry_count_check check (enquiry_count >= 0),
  constraint vacancy_campaigns_scheduled_viewings_count_check check (scheduled_viewings_count >= 0),
  constraint vacancy_campaigns_applications_count_check check (applications_count >= 0)
);

create unique index if not exists vacancy_campaigns_active_property_unique_idx
  on public.vacancy_campaigns(property_id)
  where campaign_status in ('owner_review', 'approved', 'relisting_in_progress', 'listed');

create index if not exists vacancy_campaigns_org_owner_status_idx
  on public.vacancy_campaigns(organization_id, owner_id, campaign_status, created_at desc);

create index if not exists vacancy_campaigns_expected_vacancy_date_idx
  on public.vacancy_campaigns(expected_vacancy_date, campaign_status)
  where campaign_status in ('owner_review', 'approved', 'relisting_in_progress', 'listed');

create table if not exists public.vacancy_campaign_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vacancy_campaign_id uuid not null references public.vacancy_campaigns(id) on delete cascade,
  event_type text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint vacancy_campaign_events_event_type_check check (
    event_type in (
      'campaign_created',
      'listing_draft_generated',
      'owner_approved',
      'listing_publish_attempted',
      'lead_recorded',
      'viewing_recorded',
      'application_recorded',
      'status_update_sent',
      'campaign_state_changed'
    )
  )
);

create index if not exists vacancy_campaign_events_campaign_created_idx
  on public.vacancy_campaign_events(vacancy_campaign_id, created_at desc);

create table if not exists public.vacancy_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vacancy_campaign_id uuid not null references public.vacancy_campaigns(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  source text not null default 'internal',
  status text not null default 'new',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vacancy_leads_status_check check (status in ('new', 'qualified', 'viewing_scheduled', 'application_submitted', 'inactive'))
);

create index if not exists vacancy_leads_campaign_status_idx
  on public.vacancy_leads(vacancy_campaign_id, status, created_at desc);

create table if not exists public.vacancy_viewings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vacancy_campaign_id uuid not null references public.vacancy_campaigns(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  lead_id uuid references public.vacancy_leads(id) on delete set null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz,
  booking_status text not null default 'scheduled',
  notes text,
  calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vacancy_viewings_booking_status_check check (booking_status in ('scheduled', 'completed', 'cancelled', 'no_show'))
);

create index if not exists vacancy_viewings_campaign_status_idx
  on public.vacancy_viewings(vacancy_campaign_id, booking_status, scheduled_start_at desc);

create table if not exists public.vacancy_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vacancy_campaign_id uuid not null references public.vacancy_campaigns(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  lead_id uuid references public.vacancy_leads(id) on delete set null,
  applicant_name text not null,
  desired_move_in_date date,
  monthly_salary numeric(12,2),
  status text not null default 'submitted',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vacancy_applications_status_check check (status in ('submitted', 'under_review', 'approved', 'rejected')),
  constraint vacancy_applications_monthly_salary_check check (monthly_salary is null or monthly_salary >= 0)
);

create index if not exists vacancy_applications_campaign_status_idx
  on public.vacancy_applications(vacancy_campaign_id, status, created_at desc);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'vacancy_campaign_started',
  'email',
  'Vacancy campaign started for {{property.property_name}}',
  'Vacancy watch is active for {{property.property_name}} {{property.unit_number}}. Expected vacancy: {{campaign.expected_vacancy_date}}. Next step: {{campaign.next_action}}.'
where not exists (
  select 1
  from public.message_templates mt
  where mt.organization_id is null
    and mt.template_key = 'vacancy_campaign_started'
    and mt.channel = 'email'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select
  null,
  'vacancy_daily_status_update',
  'email',
  'Daily vacancy status update for {{owner.company_name}}',
  'Vacancy pipeline update: {{summary.active_campaigns}} active campaign(s), {{summary.vacant_count}} currently vacant, {{summary.viewings_count}} scheduled viewing(s), {{summary.applications_count}} application(s).' 
where not exists (
  select 1
  from public.message_templates mt
  where mt.organization_id is null
    and mt.template_key = 'vacancy_daily_status_update'
    and mt.channel = 'email'
);

drop trigger if exists set_updated_at_vacancy_campaigns on public.vacancy_campaigns;
create trigger set_updated_at_vacancy_campaigns
before update on public.vacancy_campaigns
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_vacancy_leads on public.vacancy_leads;
create trigger set_updated_at_vacancy_leads
before update on public.vacancy_leads
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_vacancy_viewings on public.vacancy_viewings;
create trigger set_updated_at_vacancy_viewings
before update on public.vacancy_viewings
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_vacancy_applications on public.vacancy_applications;
create trigger set_updated_at_vacancy_applications
before update on public.vacancy_applications
for each row
execute function public.set_updated_at();

alter table public.vacancy_campaigns enable row level security;
alter table public.vacancy_campaign_events enable row level security;
alter table public.vacancy_leads enable row level security;
alter table public.vacancy_viewings enable row level security;
alter table public.vacancy_applications enable row level security;
