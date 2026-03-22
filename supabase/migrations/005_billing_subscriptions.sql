-- 005_billing_subscriptions.sql
-- Subscription billing plans and owner subscription state.

create table if not exists public.plans (
  plan_code text primary key,
  plan_name text not null,
  monthly_price integer not null default 0,
  features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_monthly_price_check check (monthly_price >= 0)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan_code text not null references public.plans(plan_code),
  status text not null default 'inactive',
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_owner_created_idx on public.subscriptions(owner_id, created_at desc);
create index if not exists subscriptions_status_idx on public.subscriptions(status, created_at desc);
create index if not exists subscriptions_plan_status_idx on public.subscriptions(plan_code, status);
create index if not exists subscriptions_customer_idx on public.subscriptions(stripe_customer_id);

drop trigger if exists set_updated_at_plans on public.plans;
create trigger set_updated_at_plans
before update on public.plans
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_subscriptions on public.subscriptions;
create trigger set_updated_at_subscriptions
before update on public.subscriptions
for each row
execute function public.set_updated_at();

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;

insert into public.plans (plan_code, plan_name, monthly_price, features)
values
  (
    'starter',
    'Starter',
    2900,
    '["Up to 10 properties","Tenant management","Support tickets","Email notifications"]'::jsonb
  ),
  (
    'professional',
    'Professional',
    7900,
    '["Up to 50 properties","Advanced reminders","Priority support","Team operations dashboard"]'::jsonb
  ),
  (
    'enterprise',
    'Enterprise',
    14900,
    '["Unlimited properties","Custom deployment","Dedicated support","SLA and migration support"]'::jsonb
  )
on conflict (plan_code) do update
set
  plan_name = excluded.plan_name,
  monthly_price = excluded.monthly_price,
  features = excluded.features,
  updated_at = now();
