-- 022_tenant_screening_workflow.sql
-- Applicant screening and qualification workflow for owner review.

create table if not exists public.screening_applicants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  vacancy_campaign_id uuid references public.vacancy_campaigns(id) on delete set null,
  vacancy_application_id uuid references public.vacancy_applications(id) on delete set null,
  enquiry_source text not null default 'manual_owner',
  source_reference text,
  applicant_name text not null,
  email text,
  phone text,
  employer text,
  monthly_salary numeric(12,2),
  current_residence text,
  reason_for_moving text,
  number_of_occupants integer,
  desired_move_in_date date,
  target_rent_amount numeric(12,2),
  identification_status text not null default 'pending',
  employment_verification_status text not null default 'pending',
  affordability_ratio numeric(8,4),
  recommendation_category text not null default 'unscored',
  recommendation_summary text,
  recommendation_reasons jsonb not null default '[]'::jsonb,
  recommendation_generated_at timestamptz,
  ai_screening_status text not null default 'not_requested',
  viewing_decision text not null default 'pending',
  final_disposition text not null default 'in_review',
  owner_decision_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint screening_applicants_enquiry_source_check check (
    enquiry_source in ('manual_owner', 'manual_admin', 'listing', 'whatsapp', 'vacancy_campaign', 'webhook', 'other')
  ),
  constraint screening_applicants_identification_status_check check (
    identification_status in ('pending', 'submitted', 'verified', 'failed', 'not_provided')
  ),
  constraint screening_applicants_employment_status_check check (
    employment_verification_status in ('pending', 'submitted', 'verified', 'failed', 'not_provided')
  ),
  constraint screening_applicants_recommendation_category_check check (
    recommendation_category in ('green', 'amber', 'red', 'unscored')
  ),
  constraint screening_applicants_ai_status_check check (
    ai_screening_status in ('not_requested', 'skipped', 'generated', 'failed')
  ),
  constraint screening_applicants_viewing_decision_check check (
    viewing_decision in ('pending', 'approved', 'rejected', 'scheduled')
  ),
  constraint screening_applicants_final_disposition_check check (
    final_disposition in ('in_review', 'rejected', 'viewing', 'lease_prep', 'withdrawn', 'approved')
  ),
  constraint screening_applicants_monthly_salary_check check (
    monthly_salary is null or monthly_salary >= 0
  ),
  constraint screening_applicants_target_rent_check check (
    target_rent_amount is null or target_rent_amount >= 0
  ),
  constraint screening_applicants_ratio_check check (
    affordability_ratio is null or affordability_ratio >= 0
  ),
  constraint screening_applicants_occupants_check check (
    number_of_occupants is null or number_of_occupants >= 0
  )
);

create unique index if not exists screening_applicants_vacancy_application_unique
  on public.screening_applicants(vacancy_application_id)
  where vacancy_application_id is not null;

create index if not exists screening_applicants_owner_created_idx
  on public.screening_applicants(owner_id, created_at desc);

create index if not exists screening_applicants_org_category_idx
  on public.screening_applicants(organization_id, recommendation_category, final_disposition, created_at desc);

create table if not exists public.screening_questionnaire_answers (
  id uuid primary key default gen_random_uuid(),
  screening_applicant_id uuid not null references public.screening_applicants(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  answer_key text not null,
  answer_label text not null,
  answer_value text,
  is_verified boolean not null default false,
  verification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint screening_questionnaire_answers_unique_key unique (screening_applicant_id, answer_key)
);

create index if not exists screening_questionnaire_answers_applicant_idx
  on public.screening_questionnaire_answers(screening_applicant_id, created_at asc);

create table if not exists public.screening_documents (
  id uuid primary key default gen_random_uuid(),
  screening_applicant_id uuid not null references public.screening_applicants(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  file_name text not null,
  storage_path text,
  public_url text,
  mime_type text,
  file_size_bytes bigint,
  extraction_status text not null default 'not_requested',
  verification_status text not null default 'submitted',
  extracted_payload jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint screening_documents_document_type_check check (
    document_type in ('emirates_id', 'salary_slip', 'employment_letter', 'passport', 'visa', 'other')
  ),
  constraint screening_documents_extraction_status_check check (
    extraction_status in ('not_requested', 'pending', 'extracted', 'failed', 'manual')
  ),
  constraint screening_documents_verification_status_check check (
    verification_status in ('pending', 'submitted', 'verified', 'failed', 'not_provided')
  ),
  constraint screening_documents_file_size_check check (
    file_size_bytes is null or file_size_bytes >= 0
  )
);

create index if not exists screening_documents_applicant_idx
  on public.screening_documents(screening_applicant_id, document_type, created_at desc);

create table if not exists public.screening_events (
  id uuid primary key default gen_random_uuid(),
  screening_applicant_id uuid not null references public.screening_applicants(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_role text not null,
  actor_owner_id uuid references public.owners(id) on delete set null,
  actor_admin_id uuid references public.admin_users(id) on delete set null,
  event_type text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint screening_events_actor_role_check check (
    actor_role in ('owner', 'admin', 'system')
  ),
  constraint screening_events_actor_identity_check check (
    (actor_role = 'owner' and actor_owner_id is not null and actor_admin_id is null)
    or (actor_role = 'admin' and actor_admin_id is not null and actor_owner_id is null)
    or (actor_role = 'system' and actor_owner_id is null and actor_admin_id is null)
  ),
  constraint screening_events_type_check check (
    event_type in (
      'applicant_created',
      'questionnaire_updated',
      'document_added',
      'recommendation_generated',
      'viewing_decision_updated',
      'final_disposition_updated'
    )
  )
);

create index if not exists screening_events_applicant_idx
  on public.screening_events(screening_applicant_id, created_at desc);

drop trigger if exists set_updated_at_screening_applicants on public.screening_applicants;
create trigger set_updated_at_screening_applicants
before update on public.screening_applicants
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_screening_questionnaire_answers on public.screening_questionnaire_answers;
create trigger set_updated_at_screening_questionnaire_answers
before update on public.screening_questionnaire_answers
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_screening_documents on public.screening_documents;
create trigger set_updated_at_screening_documents
before update on public.screening_documents
for each row
execute function public.set_updated_at();

alter table public.screening_applicants enable row level security;
alter table public.screening_questionnaire_answers enable row level security;
alter table public.screening_documents enable row level security;
alter table public.screening_events enable row level security;
