-- 006_multi_tenant_organizations.sql
-- Introduce organization-level tenancy and backfill all existing records.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan_code text,
  created_at timestamptz not null default now()
);

create index if not exists organizations_created_at_idx on public.organizations(created_at desc);
create index if not exists organizations_plan_code_idx on public.organizations(plan_code);

alter table public.owners
  add column if not exists organization_id uuid references public.organizations(id);

with generated_orgs as (
  select
    o.id as owner_id,
    gen_random_uuid() as organization_id,
    coalesce(
      nullif(trim(o.company_name), ''),
      nullif(trim(o.full_name), ''),
      split_part(o.email, '@', 1),
      'Organization'
    ) as organization_name,
    (
      coalesce(
        nullif(trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(o.company_name), ''), split_part(o.email, '@', 1), 'organization'), '[^a-zA-Z0-9]+', '-', 'g'))), ''),
        'organization'
      ) || '-' || substr(o.id::text, 1, 8)
    ) as organization_slug,
    o.created_at as owner_created_at
  from public.owners o
  where o.organization_id is null
)
insert into public.organizations (id, name, slug, plan_code, created_at)
select
  generated_orgs.organization_id,
  generated_orgs.organization_name,
  generated_orgs.organization_slug,
  'starter' as plan_code,
  generated_orgs.owner_created_at
from generated_orgs
on conflict (slug) do nothing;

update public.owners o
set organization_id = org.id
from public.organizations org
where o.organization_id is null
  and org.slug = (
    coalesce(
      nullif(trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(o.company_name), ''), split_part(o.email, '@', 1), 'organization'), '[^a-zA-Z0-9]+', '-', 'g'))), ''),
      'organization'
    ) || '-' || substr(o.id::text, 1, 8)
  );

alter table public.owners
  alter column organization_id set not null;

create index if not exists owners_organization_id_idx on public.owners(organization_id);

create table if not exists public.owner_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  constraint owner_memberships_role_check check (role in ('owner', 'manager', 'viewer')),
  constraint owner_memberships_unique unique (organization_id, owner_id)
);

create index if not exists owner_memberships_owner_idx on public.owner_memberships(owner_id);
create index if not exists owner_memberships_organization_idx on public.owner_memberships(organization_id);

insert into public.owner_memberships (organization_id, owner_id, role, created_at)
select
  o.organization_id,
  o.id,
  'owner',
  o.created_at
from public.owners o
where o.organization_id is not null
on conflict (organization_id, owner_id) do nothing;

alter table public.properties
  add column if not exists organization_id uuid references public.organizations(id);
update public.properties p
set organization_id = o.organization_id
from public.owners o
where p.organization_id is null and p.owner_id = o.id;
alter table public.properties
  alter column organization_id set not null;
create index if not exists properties_organization_id_idx on public.properties(organization_id);

alter table public.tenants
  add column if not exists organization_id uuid references public.organizations(id);
update public.tenants t
set organization_id = o.organization_id
from public.owners o
where t.organization_id is null and t.owner_id = o.id;
alter table public.tenants
  alter column organization_id set not null;
create index if not exists tenants_organization_id_idx on public.tenants(organization_id);

alter table public.support_tickets
  add column if not exists organization_id uuid references public.organizations(id);
update public.support_tickets st
set organization_id = coalesce(t.organization_id, o.organization_id)
from public.tenants t
left join public.owners o on o.id = t.owner_id
where st.organization_id is null and st.tenant_id = t.id;
update public.support_tickets st
set organization_id = o.organization_id
from public.owners o
where st.organization_id is null and st.owner_id = o.id;
alter table public.support_tickets
  alter column organization_id set not null;
create index if not exists support_tickets_organization_id_idx on public.support_tickets(organization_id);

alter table public.rent_reminders
  add column if not exists organization_id uuid references public.organizations(id);
update public.rent_reminders rr
set organization_id = coalesce(t.organization_id, o.organization_id)
from public.tenants t
left join public.owners o on o.id = t.owner_id
where rr.organization_id is null and rr.tenant_id = t.id;
update public.rent_reminders rr
set organization_id = o.organization_id
from public.owners o
where rr.organization_id is null and rr.owner_id = o.id;
alter table public.rent_reminders
  alter column organization_id set not null;
create index if not exists rent_reminders_organization_id_idx on public.rent_reminders(organization_id);

alter table public.owner_notifications
  add column if not exists organization_id uuid references public.organizations(id);
update public.owner_notifications onf
set organization_id = o.organization_id
from public.owners o
where onf.organization_id is null and onf.owner_id = o.id;
alter table public.owner_notifications
  alter column organization_id set not null;
create index if not exists owner_notifications_organization_id_idx on public.owner_notifications(organization_id);

alter table public.subscriptions
  add column if not exists organization_id uuid references public.organizations(id);
update public.subscriptions s
set organization_id = o.organization_id
from public.owners o
where s.organization_id is null and s.owner_id = o.id;
alter table public.subscriptions
  alter column organization_id set not null;
create index if not exists subscriptions_organization_id_idx on public.subscriptions(organization_id);
create unique index if not exists subscriptions_one_active_per_org_idx
  on public.subscriptions(organization_id)
  where status in ('active', 'trialing', 'past_due', 'unpaid');

alter table public.contact_messages
  add column if not exists organization_id uuid references public.organizations(id);
create index if not exists contact_messages_organization_id_idx on public.contact_messages(organization_id);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id text not null,
  actor_role text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_created_idx on public.audit_logs(organization_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id, actor_role, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs(action, created_at desc);

alter table public.organizations enable row level security;
alter table public.owner_memberships enable row level security;
alter table public.audit_logs enable row level security;
alter table public.owners enable row level security;
alter table public.properties enable row level security;
alter table public.tenants enable row level security;
alter table public.support_tickets enable row level security;
alter table public.rent_reminders enable row level security;
alter table public.owner_notifications enable row level security;
alter table public.subscriptions enable row level security;
alter table public.contact_messages enable row level security;
