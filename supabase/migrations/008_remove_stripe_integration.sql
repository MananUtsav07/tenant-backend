-- 008_remove_stripe_integration.sql
-- Stripe billing is disabled for now. Keep plans/subscriptions tables without Stripe identifiers.

drop index if exists public.subscriptions_customer_idx;

alter table if exists public.subscriptions
  drop constraint if exists subscriptions_stripe_subscription_id_key;

alter table if exists public.subscriptions
  drop column if exists stripe_customer_id,
  drop column if exists stripe_subscription_id;
