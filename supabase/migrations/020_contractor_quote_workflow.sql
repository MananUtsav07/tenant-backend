-- 020_contractor_quote_workflow.sql
-- Structured maintenance contractor quote and approval workflow.

create table if not exists public.contractor_directory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete set null,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  whatsapp text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contractor_directory_organization_created_idx
  on public.contractor_directory(organization_id, created_at desc);

create index if not exists contractor_directory_organization_active_idx
  on public.contractor_directory(organization_id, is_active);

create table if not exists public.contractor_specialties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contractor_id uuid not null references public.contractor_directory(id) on delete cascade,
  specialty text not null,
  created_at timestamptz not null default now(),
  constraint contractor_specialties_specialty_check check (
    specialty in (
      'general',
      'plumbing',
      'electrical',
      'hvac',
      'appliance',
      'locksmith',
      'pest_control',
      'cleaning',
      'painting',
      'carpentry',
      'waterproofing',
      'other'
    )
  ),
  constraint contractor_specialties_unique unique (contractor_id, specialty)
);

create index if not exists contractor_specialties_organization_specialty_idx
  on public.contractor_specialties(organization_id, specialty);

create table if not exists public.maintenance_workflows (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  category text not null,
  urgency text not null default 'standard',
  workflow_status text not null default 'triaged',
  classification_source text not null default 'rules',
  classification_notes text,
  quote_requested_at timestamptz,
  approved_quote_id uuid,
  approved_at timestamptz,
  approved_by_owner_id uuid references public.owners(id) on delete set null,
  follow_up_due_at timestamptz,
  follow_up_alert_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_workflows_ticket_unique unique (ticket_id),
  constraint maintenance_workflows_category_check check (
    category in (
      'general',
      'plumbing',
      'electrical',
      'hvac',
      'appliance',
      'locksmith',
      'pest_control',
      'cleaning',
      'painting',
      'carpentry',
      'waterproofing',
      'other'
    )
  ),
  constraint maintenance_workflows_urgency_check check (urgency in ('emergency', 'urgent', 'standard')),
  constraint maintenance_workflows_status_check check (
    workflow_status in (
      'triaged',
      'quote_collection',
      'owner_review',
      'assigned',
      'scheduled',
      'in_progress',
      'awaiting_tenant_confirmation',
      'completed',
      'cancelled'
    )
  ),
  constraint maintenance_workflows_source_check check (classification_source in ('rules', 'ai', 'manual'))
);

create index if not exists maintenance_workflows_organization_status_idx
  on public.maintenance_workflows(organization_id, workflow_status, created_at desc);

create index if not exists maintenance_workflows_owner_status_idx
  on public.maintenance_workflows(owner_id, workflow_status, created_at desc);

create table if not exists public.contractor_quote_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_workflow_id uuid not null references public.maintenance_workflows(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  contractor_id uuid not null references public.contractor_directory(id) on delete cascade,
  request_channel text not null default 'email',
  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz,
  request_message text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_quote_requests_channel_check check (request_channel in ('email', 'whatsapp', 'internal')),
  constraint contractor_quote_requests_status_check check (status in ('requested', 'responded', 'declined', 'expired', 'cancelled')),
  constraint contractor_quote_requests_unique unique (maintenance_workflow_id, contractor_id)
);

create index if not exists contractor_quote_requests_ticket_created_idx
  on public.contractor_quote_requests(ticket_id, created_at desc);

create table if not exists public.contractor_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_workflow_id uuid not null references public.maintenance_workflows(id) on delete cascade,
  quote_request_id uuid references public.contractor_quote_requests(id) on delete set null,
  contractor_id uuid not null references public.contractor_directory(id) on delete cascade,
  amount numeric(12,2) not null,
  currency_code text not null,
  scope_of_work text not null,
  availability_note text,
  estimated_start_at timestamptz,
  estimated_completion_at timestamptz,
  status text not null default 'submitted',
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_quotes_amount_check check (amount >= 0),
  constraint contractor_quotes_status_check check (status in ('submitted', 'withdrawn', 'accepted', 'rejected'))
);

create index if not exists contractor_quotes_workflow_status_idx
  on public.contractor_quotes(maintenance_workflow_id, status, submitted_at desc);

create table if not exists public.maintenance_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_workflow_id uuid not null references public.maintenance_workflows(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  contractor_id uuid not null references public.contractor_directory(id) on delete cascade,
  quote_id uuid references public.contractor_quotes(id) on delete set null,
  approved_by_owner_id uuid not null references public.owners(id) on delete cascade,
  booking_status text not null default 'approved',
  appointment_start_at timestamptz,
  appointment_end_at timestamptz,
  appointment_notes text,
  completion_notes text,
  completed_at timestamptz,
  tenant_confirmed_at timestamptz,
  tenant_feedback_rating integer,
  tenant_feedback_note text,
  follow_up_due_at timestamptz,
  follow_up_alert_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_assignments_unique unique (maintenance_workflow_id),
  constraint maintenance_assignments_status_check check (
    booking_status in ('approved', 'scheduled', 'in_progress', 'completed', 'tenant_confirmed', 'cancelled', 'follow_up_required')
  ),
  constraint maintenance_assignments_feedback_rating_check check (
    tenant_feedback_rating is null or tenant_feedback_rating between 1 and 5
  )
);

create index if not exists maintenance_assignments_ticket_status_idx
  on public.maintenance_assignments(ticket_id, booking_status, created_at desc);

alter table public.maintenance_workflows
  drop constraint if exists maintenance_workflows_approved_quote_id_fkey;
alter table public.maintenance_workflows
  add constraint maintenance_workflows_approved_quote_id_fkey
  foreign key (approved_quote_id) references public.contractor_quotes(id) on delete set null;

drop trigger if exists set_updated_at_contractor_directory on public.contractor_directory;
create trigger set_updated_at_contractor_directory
before update on public.contractor_directory
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_maintenance_workflows on public.maintenance_workflows;
create trigger set_updated_at_maintenance_workflows
before update on public.maintenance_workflows
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_contractor_quote_requests on public.contractor_quote_requests;
create trigger set_updated_at_contractor_quote_requests
before update on public.contractor_quote_requests
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_contractor_quotes on public.contractor_quotes;
create trigger set_updated_at_contractor_quotes
before update on public.contractor_quotes
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_maintenance_assignments on public.maintenance_assignments;
create trigger set_updated_at_maintenance_assignments
before update on public.maintenance_assignments
for each row
execute function public.set_updated_at();

alter table public.contractor_directory enable row level security;
alter table public.contractor_specialties enable row level security;
alter table public.maintenance_workflows enable row level security;
alter table public.contractor_quote_requests enable row level security;
alter table public.contractor_quotes enable row level security;
alter table public.maintenance_assignments enable row level security;
