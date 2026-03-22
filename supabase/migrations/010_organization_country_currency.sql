-- 010_organization_country_currency.sql
-- Add organization-level country and currency settings for future pricing and current currency formatting.

alter table public.organizations
  add column if not exists country_code text,
  add column if not exists currency_code text;

update public.organizations
set
  country_code = coalesce(nullif(trim(country_code), ''), 'IN'),
  currency_code = coalesce(nullif(trim(currency_code), ''), 'INR');

alter table public.organizations
  alter column country_code set default 'IN',
  alter column currency_code set default 'INR',
  alter column country_code set not null,
  alter column currency_code set not null;

alter table public.organizations
  drop constraint if exists organizations_country_code_check;
alter table public.organizations
  add constraint organizations_country_code_check
  check (country_code in ('IN', 'US', 'GB', 'AE', 'CA', 'AU', 'SG', 'DE', 'FR', 'SA', 'NZ', 'MY', 'QA', 'ZA', 'JP'));

alter table public.organizations
  drop constraint if exists organizations_currency_code_check;
alter table public.organizations
  add constraint organizations_currency_code_check
  check (currency_code in ('INR', 'USD', 'GBP', 'AED', 'CAD', 'AUD', 'SGD', 'EUR', 'SAR', 'NZD', 'MYR', 'QAR', 'ZAR', 'JPY'));

create index if not exists organizations_country_code_idx on public.organizations(country_code);
