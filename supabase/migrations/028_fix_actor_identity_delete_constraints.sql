-- Migration 028: Fix actor/sender identity constraints blocking owner and tenant deletion
--
-- Root cause: Tables like support_ticket_messages, condition_report_events, and
-- screening_events use ON DELETE SET NULL for actor/sender FK columns, but their
-- CHECK constraints require actor_owner_id IS NOT NULL when actor_role = 'owner'
-- (and same for tenant). When an owner or tenant is deleted, SET NULL fires first
-- and violates the constraint before we can stop it.
--
-- Fix: BEFORE DELETE triggers on owners and tenants that anonymise any rows
-- referencing the deleted actor (set role = 'system', null out the FK) so that
-- by the time PostgreSQL fires the FK SET NULL there is nothing left to violate.

-- ─── Owner anonymisation ───────────────────────────────────────────────────────

create or replace function fn_anonymize_owner_actor_refs()
returns trigger language plpgsql as $$
begin
  -- support_ticket_messages
  update public.support_ticket_messages
  set sender_role = 'system', sender_owner_id = null
  where sender_owner_id = old.id;

  -- condition_report_events
  update public.condition_report_events
  set actor_role = 'system', actor_owner_id = null
  where actor_owner_id = old.id;

  -- screening_events
  update public.screening_events
  set actor_role = 'system', actor_owner_id = null
  where actor_owner_id = old.id;

  return old;
end;
$$;

drop trigger if exists trg_anonymize_owner_actor_refs on public.owners;
create trigger trg_anonymize_owner_actor_refs
  before delete on public.owners
  for each row execute function fn_anonymize_owner_actor_refs();

-- ─── Tenant anonymisation ──────────────────────────────────────────────────────

create or replace function fn_anonymize_tenant_actor_refs()
returns trigger language plpgsql as $$
begin
  -- support_ticket_messages
  update public.support_ticket_messages
  set sender_role = 'system', sender_tenant_id = null
  where sender_tenant_id = old.id;

  -- condition_report_events
  update public.condition_report_events
  set actor_role = 'system', actor_tenant_id = null
  where actor_tenant_id = old.id;

  -- screening_events has no actor_tenant_id column (only owner/admin actors)

  return old;
end;
$$;

drop trigger if exists trg_anonymize_tenant_actor_refs on public.tenants;
create trigger trg_anonymize_tenant_actor_refs
  before delete on public.tenants
  for each row execute function fn_anonymize_tenant_actor_refs();
