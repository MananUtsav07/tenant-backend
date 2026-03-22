-- 014_support_ticket_threads.sql
-- Add auditable message history for support tickets.

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_role text not null,
  sender_owner_id uuid references public.owners(id) on delete set null,
  sender_tenant_id uuid references public.tenants(id) on delete set null,
  sender_admin_id uuid references public.admin_users(id) on delete set null,
  message text not null,
  message_type text not null default 'reply',
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_sender_role_check check (sender_role in ('tenant', 'owner', 'admin', 'system')),
  constraint support_ticket_messages_message_type_check check (message_type in ('initial_message', 'reply', 'closing_note', 'system')),
  constraint support_ticket_messages_sender_identity_check check (
    (sender_role = 'tenant' and sender_tenant_id is not null and sender_owner_id is null and sender_admin_id is null)
    or (sender_role = 'owner' and sender_owner_id is not null and sender_tenant_id is null and sender_admin_id is null)
    or (sender_role = 'admin' and sender_admin_id is not null and sender_owner_id is null and sender_tenant_id is null)
    or (sender_role = 'system' and sender_owner_id is null and sender_tenant_id is null and sender_admin_id is null)
  )
);

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages(ticket_id, created_at asc);

create index if not exists support_ticket_messages_organization_ticket_idx
  on public.support_ticket_messages(organization_id, ticket_id, created_at asc);

create or replace function public.create_support_ticket_initial_message()
returns trigger
language plpgsql
as $$
begin
  insert into public.support_ticket_messages (
    ticket_id,
    organization_id,
    sender_role,
    sender_tenant_id,
    message,
    message_type,
    created_at
  )
  values (
    new.id,
    new.organization_id,
    'tenant',
    new.tenant_id,
    new.message,
    'initial_message',
    new.created_at
  );

  return new;
end;
$$;

drop trigger if exists create_support_ticket_initial_message on public.support_tickets;
create trigger create_support_ticket_initial_message
after insert on public.support_tickets
for each row
execute function public.create_support_ticket_initial_message();

insert into public.support_ticket_messages (
  ticket_id,
  organization_id,
  sender_role,
  sender_tenant_id,
  message,
  message_type,
  created_at
)
select
  st.id,
  st.organization_id,
  'tenant',
  st.tenant_id,
  st.message,
  'initial_message',
  st.created_at
from public.support_tickets st
where not exists (
  select 1
  from public.support_ticket_messages stm
  where stm.ticket_id = st.id
    and stm.message_type = 'initial_message'
);

alter table public.support_ticket_messages enable row level security;
