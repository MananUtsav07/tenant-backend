# Prophives Automation Module

This folder is the implementation home for the native Prophives automation system.

## Current audit snapshot

The codebase already had a useful first-wave scaffold before this module was formalized:

- `automation_jobs`, `automation_runs`, `automation_errors`, `owner_automation_settings`, `legal_dates`, `rent_ledger`, and `message_templates` exist in Supabase.
- Internal protected automation routes already exist:
  - `POST /api/internal/automation/tick`
  - `POST /api/internal/automation/dispatch`
- Core first-wave services already exist:
  - compliance alerts
  - rent chasing
  - daily portfolio visibility
- Adjacent systems already exist and are reused here:
  - owner/admin notifications
  - branded email delivery
  - Telegram delivery hooks
  - AI feature flags/config scaffolding
  - organization-scoped audit logging

## What this module adds

This module organizes the automation work so the platform can scale into the full Prophives brief without turning the service layer into a set of unrelated cron handlers.

- `jobTypes.ts`
  - single source of truth for supported automation job types
- `jobScheduler.ts`
  - deterministic schedule builder for daily / weekly / monthly jobs
- `messageTemplateService.ts`
  - resolves DB-backed message templates with safe fallback rendering
- `providers/messageProvider.ts`
  - email + Telegram delivery abstraction
  - WhatsApp delivery orchestration for owner-facing automation sends
- `providers/whatsappProvider.ts`
  - provider-neutral WhatsApp send + webhook abstraction
  - outbound delivery journaling and inbound webhook normalization
- `cashFlowReportService.ts`
  - monthly owner cash-flow reporting built on `rent_ledger` and property financial profiles

## Delivery phases

### Phase 1: infrastructure

- central job type registry
- scheduled job builder
- delivery provider abstraction
- DB-backed message template resolver
- event/integration journaling and financial profile support

### Phase 2: first live operational flows

- compliance alerts
- rent chasing
- daily / weekly / monthly portfolio visibility
- monthly cash-flow reporting

### Phase 3: contractor multi-quote flow

- contractor directory
- quote request / response journaling
- owner approval workflow

### Phase 4: vacancy re-letting flow

- vacancy campaigns
- enquiry capture
- viewing booking orchestration

### Phase 5: tenant screening

- applicant records
- screening checks
- document analysis orchestration

### Phase 6: security deposit documentation

- condition reports
- asset storage links
- move-in / move-out comparison workflow

## Implementation guardrails

- keep all reads/writes organization-scoped
- preserve existing owner / tenant / admin flows
- prefer reusable providers and template services over one-off job code
- treat AI as optional enhancement behind existing feature flags
- log every scheduled run and every failure
- keep vendor-specific webhook logic behind provider adapters
