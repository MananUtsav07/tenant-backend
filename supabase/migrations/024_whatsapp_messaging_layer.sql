-- 024_whatsapp_messaging_layer.sql
-- Provider-neutral WhatsApp delivery and inbound webhook audit foundation.

create table if not exists public.whatsapp_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  automation_job_id uuid references public.automation_jobs(id) on delete set null,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  integration_event_id uuid references public.integration_events(id) on delete set null,
  provider text not null default 'stub',
  policy_mode text not null default 'template',
  message_kind text not null default 'template',
  template_key text,
  recipient text not null,
  recipient_e164 text,
  rendered_body text,
  fallback_text text,
  action_payload jsonb not null default '{}'::jsonb,
  provider_message_id text,
  provider_conversation_id text,
  provider_payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempt_key text,
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_message_deliveries_policy_mode_check check (
    policy_mode in ('template', 'session', 'action')
  ),
  constraint whatsapp_message_deliveries_message_kind_check check (
    message_kind in ('template', 'freeform', 'action')
  ),
  constraint whatsapp_message_deliveries_status_check check (
    status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')
  )
);

create unique index if not exists whatsapp_message_deliveries_attempt_key_idx
  on public.whatsapp_message_deliveries (attempt_key)
  where attempt_key is not null;

create index if not exists whatsapp_message_deliveries_org_status_idx
  on public.whatsapp_message_deliveries (organization_id, status, created_at desc);

create index if not exists whatsapp_message_deliveries_provider_message_idx
  on public.whatsapp_message_deliveries (provider_message_id)
  where provider_message_id is not null;

create index if not exists whatsapp_message_deliveries_recipient_idx
  on public.whatsapp_message_deliveries (recipient_e164, created_at desc)
  where recipient_e164 is not null;

create table if not exists public.whatsapp_inbound_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  delivery_id uuid references public.whatsapp_message_deliveries(id) on delete set null,
  integration_event_id uuid references public.integration_events(id) on delete set null,
  provider text not null default 'stub',
  event_type text not null default 'unknown',
  message_type text not null default 'unknown',
  sender text,
  sender_e164 text,
  recipient text,
  recipient_e164 text,
  external_message_id text,
  provider_conversation_id text,
  payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_inbound_events_event_type_check check (
    event_type in ('challenge', 'message', 'status', 'unknown')
  ),
  constraint whatsapp_inbound_events_message_type_check check (
    message_type in ('text', 'interactive', 'button', 'image', 'video', 'document', 'system', 'unknown')
  ),
  constraint whatsapp_inbound_events_status_check check (
    status in ('received', 'processed', 'failed', 'ignored')
  )
);

create index if not exists whatsapp_inbound_events_org_created_idx
  on public.whatsapp_inbound_events (organization_id, created_at desc);

create index if not exists whatsapp_inbound_events_message_idx
  on public.whatsapp_inbound_events (external_message_id)
  where external_message_id is not null;

drop trigger if exists set_updated_at_whatsapp_message_deliveries on public.whatsapp_message_deliveries;
create trigger set_updated_at_whatsapp_message_deliveries
before update on public.whatsapp_message_deliveries
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_whatsapp_inbound_events on public.whatsapp_inbound_events;
create trigger set_updated_at_whatsapp_inbound_events
before update on public.whatsapp_inbound_events
for each row
execute function public.set_updated_at();

alter table public.whatsapp_message_deliveries enable row level security;
alter table public.whatsapp_inbound_events enable row level security;
