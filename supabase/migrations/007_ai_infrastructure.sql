-- 007_ai_infrastructure.sql
-- AI infrastructure scaffolding. No live automation is enabled by this migration.

create table if not exists public.organization_ai_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  automation_enabled boolean not null default false,
  ticket_classification_enabled boolean not null default false,
  reminder_generation_enabled boolean not null default false,
  ticket_summarization_enabled boolean not null default false,
  ai_model text not null default 'gpt-4.1-mini',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_ai_settings_ai_model_check check (length(trim(ai_model)) > 0)
);

create index if not exists organization_ai_settings_automation_enabled_idx
  on public.organization_ai_settings (automation_enabled)
  where automation_enabled = true;

create index if not exists organization_ai_settings_ticket_classification_enabled_idx
  on public.organization_ai_settings (ticket_classification_enabled)
  where ticket_classification_enabled = true;

create index if not exists organization_ai_settings_reminder_generation_enabled_idx
  on public.organization_ai_settings (reminder_generation_enabled)
  where reminder_generation_enabled = true;

create index if not exists organization_ai_settings_ticket_summarization_enabled_idx
  on public.organization_ai_settings (ticket_summarization_enabled)
  where ticket_summarization_enabled = true;

drop trigger if exists set_updated_at_organization_ai_settings on public.organization_ai_settings;
create trigger set_updated_at_organization_ai_settings
before update on public.organization_ai_settings
for each row
execute function public.set_updated_at();

alter table public.organization_ai_settings enable row level security;

