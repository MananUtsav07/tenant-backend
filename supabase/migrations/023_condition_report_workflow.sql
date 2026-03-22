-- 023_condition_report_workflow.sql
-- Move-in and move-out condition documentation workflow.

create table if not exists public.condition_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  vacancy_campaign_id uuid references public.vacancy_campaigns(id) on delete set null,
  baseline_report_id uuid references public.condition_reports(id) on delete set null,
  report_type text not null,
  workflow_status text not null default 'draft',
  trigger_source text not null,
  trigger_reference text,
  report_label text not null,
  report_summary text,
  comparison_status text not null default 'not_applicable',
  comparison_summary text,
  ai_analysis_status text not null default 'not_requested',
  ai_analysis_payload jsonb not null default '{}'::jsonb,
  generated_document_status text not null default 'not_generated',
  generated_document_format text,
  generated_document_provider text,
  generated_document_url text,
  generated_document_payload jsonb not null default '{}'::jsonb,
  owner_confirmation_status text not null default 'pending',
  owner_confirmation_note text,
  owner_confirmed_at timestamptz,
  tenant_confirmation_status text not null default 'pending',
  tenant_confirmation_note text,
  tenant_confirmed_at timestamptz,
  last_summary_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condition_reports_type_check check (
    report_type in ('move_in', 'move_out')
  ),
  constraint condition_reports_workflow_status_check check (
    workflow_status in ('draft', 'collecting_evidence', 'ready_for_confirmation', 'confirmation_in_progress', 'confirmed', 'cancelled')
  ),
  constraint condition_reports_trigger_source_check check (
    trigger_source in ('tenant_created', 'tenant_activated', 'vacancy_campaign', 'manual_owner', 'manual_admin')
  ),
  constraint condition_reports_comparison_status_check check (
    comparison_status in ('not_applicable', 'baseline_missing', 'pending_review', 'matched', 'changes_detected')
  ),
  constraint condition_reports_ai_status_check check (
    ai_analysis_status in ('not_requested', 'pending_provider', 'analyzed', 'failed')
  ),
  constraint condition_reports_document_status_check check (
    generated_document_status in ('not_generated', 'pending_provider', 'generated', 'failed')
  ),
  constraint condition_reports_document_format_check check (
    generated_document_format is null or generated_document_format in ('pdf', 'html')
  ),
  constraint condition_reports_owner_confirmation_status_check check (
    owner_confirmation_status in ('pending', 'confirmed', 'disputed')
  ),
  constraint condition_reports_tenant_confirmation_status_check check (
    tenant_confirmation_status in ('pending', 'confirmed', 'disputed')
  ),
  constraint condition_reports_confirmation_timestamps_check check (
    (owner_confirmation_status = 'pending' or owner_confirmed_at is not null)
    and (tenant_confirmation_status = 'pending' or tenant_confirmed_at is not null)
  )
);

create index if not exists condition_reports_owner_created_idx
  on public.condition_reports(owner_id, created_at desc);

create index if not exists condition_reports_tenant_type_idx
  on public.condition_reports(tenant_id, report_type, created_at desc)
  where tenant_id is not null;

create index if not exists condition_reports_property_type_idx
  on public.condition_reports(property_id, report_type, created_at desc);

create index if not exists condition_reports_vacancy_campaign_idx
  on public.condition_reports(vacancy_campaign_id, created_at desc)
  where vacancy_campaign_id is not null;

create table if not exists public.condition_report_room_entries (
  id uuid primary key default gen_random_uuid(),
  condition_report_id uuid not null references public.condition_reports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_label text not null,
  display_order integer not null default 0,
  condition_rating text not null default 'not_reviewed',
  condition_notes text,
  comparison_result text not null default 'not_applicable',
  comparison_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condition_report_room_entries_unique_room unique (condition_report_id, room_label),
  constraint condition_report_room_entries_label_check check (
    room_label in ('bedroom', 'bathroom', 'kitchen', 'living_area', 'balcony', 'ac_unit', 'water_heater', 'hallway', 'storage', 'other')
  ),
  constraint condition_report_room_entries_rating_check check (
    condition_rating in ('not_reviewed', 'good', 'fair', 'poor')
  ),
  constraint condition_report_room_entries_comparison_check check (
    comparison_result in ('not_applicable', 'pending_review', 'matched', 'changed', 'attention_required')
  ),
  constraint condition_report_room_entries_display_order_check check (
    display_order >= 0
  )
);

create index if not exists condition_report_room_entries_report_order_idx
  on public.condition_report_room_entries(condition_report_id, display_order asc, created_at asc);

create table if not exists public.condition_report_media (
  id uuid primary key default gen_random_uuid(),
  condition_report_id uuid not null references public.condition_reports(id) on delete cascade,
  room_entry_id uuid references public.condition_report_room_entries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_label text not null,
  media_kind text not null default 'photo',
  media_url text,
  storage_path text,
  mime_type text,
  caption text,
  captured_by_role text not null,
  ai_analysis_status text not null default 'not_requested',
  ai_analysis_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condition_report_media_room_label_check check (
    room_label in ('bedroom', 'bathroom', 'kitchen', 'living_area', 'balcony', 'ac_unit', 'water_heater', 'hallway', 'storage', 'other')
  ),
  constraint condition_report_media_media_kind_check check (
    media_kind in ('photo', 'video', 'document', 'other')
  ),
  constraint condition_report_media_captured_by_check check (
    captured_by_role in ('owner', 'tenant', 'admin', 'system')
  ),
  constraint condition_report_media_ai_status_check check (
    ai_analysis_status in ('not_requested', 'pending_provider', 'analyzed', 'failed')
  ),
  constraint condition_report_media_reference_check check (
    media_url is not null or storage_path is not null
  )
);

create index if not exists condition_report_media_report_created_idx
  on public.condition_report_media(condition_report_id, created_at desc);

create index if not exists condition_report_media_room_idx
  on public.condition_report_media(room_entry_id, created_at desc)
  where room_entry_id is not null;

create table if not exists public.condition_report_events (
  id uuid primary key default gen_random_uuid(),
  condition_report_id uuid not null references public.condition_reports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_role text not null,
  actor_owner_id uuid references public.owners(id) on delete set null,
  actor_tenant_id uuid references public.tenants(id) on delete set null,
  actor_admin_id uuid references public.admin_users(id) on delete set null,
  event_type text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint condition_report_events_actor_role_check check (
    actor_role in ('owner', 'tenant', 'admin', 'system')
  ),
  constraint condition_report_events_actor_identity_check check (
    (actor_role = 'owner' and actor_owner_id is not null and actor_tenant_id is null and actor_admin_id is null)
    or (actor_role = 'tenant' and actor_tenant_id is not null and actor_owner_id is null and actor_admin_id is null)
    or (actor_role = 'admin' and actor_admin_id is not null and actor_owner_id is null and actor_tenant_id is null)
    or (actor_role = 'system' and actor_owner_id is null and actor_tenant_id is null and actor_admin_id is null)
  ),
  constraint condition_report_events_type_check check (
    event_type in (
      'report_created',
      'room_updated',
      'media_added',
      'comparison_refreshed',
      'document_refreshed',
      'owner_confirmed',
      'tenant_confirmed',
      'status_updated'
    )
  )
);

create index if not exists condition_report_events_report_created_idx
  on public.condition_report_events(condition_report_id, created_at desc);

drop trigger if exists set_updated_at_condition_reports on public.condition_reports;
create trigger set_updated_at_condition_reports
before update on public.condition_reports
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_condition_report_room_entries on public.condition_report_room_entries;
create trigger set_updated_at_condition_report_room_entries
before update on public.condition_report_room_entries
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_condition_report_media on public.condition_report_media;
create trigger set_updated_at_condition_report_media
before update on public.condition_report_media
for each row
execute function public.set_updated_at();

alter table public.condition_reports enable row level security;
alter table public.condition_report_room_entries enable row level security;
alter table public.condition_report_media enable row level security;
alter table public.condition_report_events enable row level security;
