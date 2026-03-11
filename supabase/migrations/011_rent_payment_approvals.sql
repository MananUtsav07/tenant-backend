-- 011_rent_payment_approvals.sql
-- Tenant -> owner rent payment verification workflow.

create table if not exists public.rent_payment_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  cycle_year integer not null,
  cycle_month integer not null,
  due_date date not null,
  amount_paid numeric(12,2) not null default 0,
  status text not null default 'awaiting_owner_approval',
  rejection_reason text,
  reviewed_by_owner_id uuid references public.owners(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rent_payment_approvals_status_check check (status in ('awaiting_owner_approval', 'approved', 'rejected')),
  constraint rent_payment_approvals_cycle_month_check check (cycle_month between 1 and 12),
  constraint rent_payment_approvals_cycle_year_check check (cycle_year between 2000 and 9999),
  constraint rent_payment_approvals_amount_paid_check check (amount_paid >= 0),
  constraint rent_payment_approvals_rejection_reason_check check (
    rejection_reason is null or length(trim(rejection_reason)) > 0
  )
);

create index if not exists rent_payment_approvals_org_owner_status_idx
  on public.rent_payment_approvals (organization_id, owner_id, status, created_at desc);

create index if not exists rent_payment_approvals_org_tenant_cycle_idx
  on public.rent_payment_approvals (organization_id, tenant_id, cycle_year, cycle_month);

create index if not exists rent_payment_approvals_owner_created_idx
  on public.rent_payment_approvals (owner_id, created_at desc);

create unique index if not exists rent_payment_approvals_unique_active_cycle_idx
  on public.rent_payment_approvals (organization_id, tenant_id, cycle_year, cycle_month)
  where status in ('awaiting_owner_approval', 'approved');

drop trigger if exists set_updated_at_rent_payment_approvals on public.rent_payment_approvals;
create trigger set_updated_at_rent_payment_approvals
before update on public.rent_payment_approvals
for each row
execute function public.set_updated_at();

alter table public.rent_payment_approvals enable row level security;
