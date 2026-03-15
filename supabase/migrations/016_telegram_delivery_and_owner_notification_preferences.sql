create table if not exists public.owner_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  ticket_created_email boolean not null default true,
  ticket_created_telegram boolean not null default true,
  ticket_reply_email boolean not null default true,
  ticket_reply_telegram boolean not null default true,
  rent_payment_awaiting_approval_email boolean not null default true,
  rent_payment_awaiting_approval_telegram boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_notification_preferences_owner_org_unique unique (organization_id, owner_id)
);

create index if not exists owner_notification_preferences_owner_idx
  on public.owner_notification_preferences(owner_id);

drop trigger if exists set_updated_at_owner_notification_preferences on public.owner_notification_preferences;
create trigger set_updated_at_owner_notification_preferences
before update on public.owner_notification_preferences
for each row
execute function public.set_updated_at();

alter table public.owner_notification_preferences enable row level security;

create table if not exists public.telegram_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  user_role text not null default 'system' check (user_role in ('owner', 'tenant', 'system')),
  event_type text not null,
  recipient_chat_id text not null,
  status text not null check (status in ('success', 'failed')),
  attempts integer not null default 1 check (attempts >= 1),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_delivery_logs_owner_created_idx
  on public.telegram_delivery_logs(owner_id, created_at desc);

create index if not exists telegram_delivery_logs_tenant_created_idx
  on public.telegram_delivery_logs(tenant_id, created_at desc);

create index if not exists telegram_delivery_logs_status_created_idx
  on public.telegram_delivery_logs(status, created_at desc);

drop trigger if exists set_updated_at_telegram_delivery_logs on public.telegram_delivery_logs;
create trigger set_updated_at_telegram_delivery_logs
before update on public.telegram_delivery_logs
for each row
execute function public.set_updated_at();

alter table public.telegram_delivery_logs enable row level security;
