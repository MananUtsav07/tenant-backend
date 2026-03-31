create table if not exists public.whatsapp_chat_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_role text not null,
  owner_id uuid references public.owners(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  phone_number text not null,
  phone_number_e164 text,
  is_active boolean not null default true,
  linked_via text,
  linked_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_chat_links_user_role_check check (user_role in ('owner', 'tenant')),
  constraint whatsapp_chat_links_entity_check check (
    (user_role = 'owner' and owner_id is not null and tenant_id is null)
    or
    (user_role = 'tenant' and tenant_id is not null)
  ),
  constraint whatsapp_chat_links_tenant_unique unique (organization_id, user_role, tenant_id)
);

alter table public.whatsapp_chat_links
  drop constraint if exists whatsapp_chat_links_owner_unique;

create index if not exists whatsapp_chat_links_phone_e164_idx
  on public.whatsapp_chat_links (phone_number_e164)
  where phone_number_e164 is not null;

create index if not exists whatsapp_chat_links_org_role_idx
  on public.whatsapp_chat_links (organization_id, user_role, is_active, created_at desc);

create unique index if not exists whatsapp_chat_links_owner_active_unique_idx
  on public.whatsapp_chat_links (organization_id, owner_id)
  where user_role = 'owner' and owner_id is not null;

drop trigger if exists set_updated_at_whatsapp_chat_links on public.whatsapp_chat_links;
create trigger set_updated_at_whatsapp_chat_links
before update on public.whatsapp_chat_links
for each row
execute function public.set_updated_at();

alter table public.whatsapp_chat_links enable row level security;

update public.whatsapp_chat_links wcl
set
  phone_number = o.support_whatsapp,
  phone_number_e164 = regexp_replace(o.support_whatsapp, '[^0-9+]', '', 'g'),
  is_active = true,
  linked_via = 'owner_profile_backfill',
  linked_at = now(),
  updated_at = now()
from public.owners o
where wcl.organization_id = o.organization_id
  and wcl.user_role = 'owner'
  and wcl.owner_id = o.id
  and o.support_whatsapp is not null
  and length(trim(o.support_whatsapp)) > 0;

insert into public.whatsapp_chat_links (
  organization_id,
  user_role,
  owner_id,
  tenant_id,
  phone_number,
  phone_number_e164,
  is_active,
  linked_via
)
select
  o.organization_id,
  'owner',
  o.id,
  null,
  o.support_whatsapp,
  regexp_replace(o.support_whatsapp, '[^0-9+]', '', 'g'),
  true,
  'owner_profile_backfill'
from public.owners o
where o.support_whatsapp is not null
  and length(trim(o.support_whatsapp)) > 0
  and not exists (
    select 1
    from public.whatsapp_chat_links wcl
    where wcl.organization_id = o.organization_id
      and wcl.user_role = 'owner'
      and wcl.owner_id = o.id
  );

insert into public.whatsapp_chat_links (
  organization_id,
  user_role,
  owner_id,
  tenant_id,
  phone_number,
  phone_number_e164,
  is_active,
  linked_via
)
select
  t.organization_id,
  'tenant',
  t.owner_id,
  t.id,
  t.phone,
  regexp_replace(t.phone, '[^0-9+]', '', 'g'),
  true,
  'tenant_phone_backfill'
from public.tenants t
where t.phone is not null
  and length(trim(t.phone)) > 0
on conflict (organization_id, user_role, tenant_id) do update
set
  phone_number = excluded.phone_number,
  phone_number_e164 = excluded.phone_number_e164,
  is_active = excluded.is_active,
  linked_via = excluded.linked_via,
  linked_at = now();

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'owner_ticket_created', 'whatsapp', null, '{{body}}'
where not exists (
  select 1 from public.message_templates where organization_id is null and template_key = 'owner_ticket_created' and channel = 'whatsapp'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'owner_ticket_reply', 'whatsapp', null, '{{body}}'
where not exists (
  select 1 from public.message_templates where organization_id is null and template_key = 'owner_ticket_reply' and channel = 'whatsapp'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'owner_rent_approval_required', 'whatsapp', null, '{{body}}'
where not exists (
  select 1 from public.message_templates where organization_id is null and template_key = 'owner_rent_approval_required' and channel = 'whatsapp'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'tenant_ticket_update', 'whatsapp', null, '{{body}}'
where not exists (
  select 1 from public.message_templates where organization_id is null and template_key = 'tenant_ticket_update' and channel = 'whatsapp'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'tenant_ticket_closed', 'whatsapp', null, '{{body}}'
where not exists (
  select 1 from public.message_templates where organization_id is null and template_key = 'tenant_ticket_closed' and channel = 'whatsapp'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'tenant_rent_payment_approved', 'whatsapp', null, '{{body}}'
where not exists (
  select 1 from public.message_templates where organization_id is null and template_key = 'tenant_rent_payment_approved' and channel = 'whatsapp'
);

insert into public.message_templates (organization_id, template_key, channel, subject, body)
select null, 'tenant_rent_payment_rejected', 'whatsapp', null, '{{body}}'
where not exists (
  select 1 from public.message_templates where organization_id is null and template_key = 'tenant_rent_payment_rejected' and channel = 'whatsapp'
);
