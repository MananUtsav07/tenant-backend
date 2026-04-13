-- Run this on your production PostgreSQL database (prophives_db)
-- Adds Razorpay payment fields to subscriptions table
-- Also seeds the plans table with trial, starter, professional plans

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;

-- Seed plans (upsert so safe to run multiple times)
INSERT INTO plans (plan_code, plan_name, monthly_price, features, created_at, updated_at)
VALUES
  ('trial',        'Free Trial',    0,    '["14-day free trial","Up to 5 properties","Up to 10 tenants","Email notifications","Basic ticket system"]', NOW(), NOW()),
  ('starter',      'Starter',       2900, '["Up to 5 properties","Up to 10 tenants","Email notifications","Basic ticket system","Payment tracking","Smart reminders"]', NOW(), NOW()),
  ('professional', 'Professional',  9900, '["Up to 25 properties","Up to 50 tenants","AI automation suite","WhatsApp integration","Telegram bot","Payment tracking","Smart reminders"]', NOW(), NOW())
ON CONFLICT (plan_code) DO UPDATE
  SET plan_name     = EXCLUDED.plan_name,
      monthly_price = EXCLUDED.monthly_price,
      features      = EXCLUDED.features,
      updated_at    = NOW();
