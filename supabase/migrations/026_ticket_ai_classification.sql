-- 026_ticket_ai_classification.sql
-- Adds AI classification result columns to support_tickets.
-- When ticket_classification_enabled is on, the backend classifies new tickets
-- and stores the result here.

alter table public.support_tickets
  add column if not exists ai_category text,
  add column if not exists ai_confidence numeric(4,3);

-- Only index tickets that have been classified
create index if not exists support_tickets_ai_category_idx
  on public.support_tickets (ai_category)
  where ai_category is not null;
