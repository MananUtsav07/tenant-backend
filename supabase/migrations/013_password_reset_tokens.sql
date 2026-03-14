-- 013_password_reset_tokens.sql
-- Secure single-use password reset tokens for owner and tenant accounts.

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_role text not null,
  email text,
  tenant_access_id text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint password_reset_tokens_user_role_check check (user_role in ('owner', 'tenant')),
  constraint password_reset_tokens_subject_check check (
    (user_role = 'owner' and owner_id is not null and tenant_id is null)
    or
    (user_role = 'tenant' and tenant_id is not null and owner_id is null)
  )
);

create index if not exists password_reset_tokens_owner_idx
  on public.password_reset_tokens (owner_id, expires_at desc);

create index if not exists password_reset_tokens_tenant_idx
  on public.password_reset_tokens (tenant_id, expires_at desc);

create index if not exists password_reset_tokens_role_consumed_idx
  on public.password_reset_tokens (user_role, consumed_at, expires_at desc);

alter table public.password_reset_tokens enable row level security;
