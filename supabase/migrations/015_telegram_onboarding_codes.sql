create table if not exists public.telegram_onboarding_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_role text not null check (user_role in ('owner', 'tenant')),
  owner_id uuid null references public.owners(id) on delete cascade,
  tenant_id uuid null references public.tenants(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint telegram_onboarding_codes_role_entity_check check (
    (user_role = 'owner' and owner_id is not null and tenant_id is null)
    or
    (user_role = 'tenant' and tenant_id is not null and owner_id is null)
  )
);

create index if not exists telegram_onboarding_codes_expires_idx
  on public.telegram_onboarding_codes(expires_at);

create index if not exists telegram_onboarding_codes_role_org_idx
  on public.telegram_onboarding_codes(user_role, organization_id);

alter table public.telegram_onboarding_codes enable row level security;
