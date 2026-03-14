# Tenant Backend API Routes

Base URL: `http://localhost:8787`

## Health

### GET `/api/health`
Response:
```json
{
  "ok": true,
  "env": "development",
  "service": "tenant-backend",
  "ts": "2026-03-08T08:00:00.000Z"
}
```

## Public Website

### POST `/api/public/contact`
Body:
```json
{
  "name": "Alex Morgan",
  "email": "support@prophives.com",
  "message": "I want a demo for a 40-property portfolio."
}
```

Response:
```json
{
  "ok": true,
  "message": "Contact message submitted successfully",
  "contact_message": {
    "id": "7e7c79ac-4c84-4108-a8f7-6f0942d95d30",
    "created_at": "2026-03-08T08:00:00.000Z"
  }
}
```

### POST `/api/public/analytics`
Body:
```json
{
  "event_name": "cta_click",
  "user_type": "public",
  "metadata": {
    "section": "hero",
    "action": "Get Started"
  }
}
```

## Owner Auth

### POST `/api/auth/owner/register`
Body:
```json
{
  "email": "support@prophives.com",
  "password": "Password@123",
  "full_name": "John Owner",
  "company_name": "Skyline PM",
  "support_email": "support@prophives.com",
  "support_whatsapp": "+919876543210",
  "country_code": "AE"
}
```

### POST `/api/auth/owner/login`
Body:
```json
{
  "email": "support@prophives.com",
  "password": "Password@123"
}
```

### GET `/api/auth/owner/me`
Headers: `Authorization: Bearer <owner_token>`

## Tenant Auth

### POST `/api/auth/tenant/login`
Body:
```json
{
  "tenant_access_id": "TEN-AB12CD34",
  "password": "Tenant@123",
  "email": "support@prophives.com"
}
```

### GET `/api/auth/tenant/me`
Headers: `Authorization: Bearer <tenant_token>`

## Blog (Public)

### GET `/api/blog`
Query params:
- `page`
- `page_size`
- `search`
- `sort_by` (`created_at` | `title`)
- `sort_order` (`asc` | `desc`)

### GET `/api/blog/:slug`
Returns a single published blog post.

## Admin Auth

### POST `/api/admin/login`
Body:
```json
{
  "email": "support@prophives.com",
  "password": "Admin@12345"
}
```

### GET `/api/admin/me`
Headers: `Authorization: Bearer <admin_token>`

## Admin Routes
All routes below require admin token.

### GET `/api/admin/dashboard-summary`
Returns platform totals, recent contact messages, and recent registrations.

### GET `/api/admin/system-health`
Returns uptime, memory, Node version, and DB latency metrics.

### GET `/api/admin/organizations`
Supports query params:
- `page`
- `page_size`
- `search`
- `sort_by` (`created_at` | `name` | `slug` | `plan_code`)
- `sort_order`

### GET `/api/admin/organizations/:id`
Returns organization detail with owners, tenants, properties, tickets, and subscriptions.

### GET `/api/admin/owners`
### GET `/api/admin/tenants`
### GET `/api/admin/properties`
### GET `/api/admin/tickets`
### GET `/api/admin/contact-messages`

List endpoints support query params:
- `page`
- `page_size`
- `search`
- `sort_by`
- `sort_order`
- `organization_id` (optional UUID filter)

### GET `/api/admin/analytics`
Query params:
- `days` (default 30)
- plus list query params above

### GET `/api/admin/ai-status`
Returns:
- `openai_configured`
- `organizations_with_ai_enabled`
- `ticket_classification_enabled_count`
- `reminder_generation_enabled_count`
- `ticket_summarization_enabled_count`

### GET `/api/admin/automations/health`
Returns queue health, latest run, and latest error.

### GET `/api/admin/automations/runs`
Query params:
- `page`
- `page_size`
- `flow_name` (optional)
- `status` (`success` | `failed` | `partial`, optional)
- `organization_id` (optional UUID)

### GET `/api/admin/automations/errors`
Query params:
- `page`
- `page_size`
- `flow_name` (optional)
- `organization_id` (optional UUID)

### GET `/api/admin/blog`
### POST `/api/admin/blog`
### PUT `/api/admin/blog/:id`
### DELETE `/api/admin/blog/:id`

## Owner Routes
All routes below require owner token.

### POST `/api/owners/properties`
### GET `/api/owners/properties`
### PATCH `/api/owners/properties/:id`
### DELETE `/api/owners/properties/:id`

### POST `/api/owners/tenants`
Body:
```json
{
  "property_id": "<uuid>",
  "full_name": "Tenant Name",
  "email": "support@prophives.com",
  "phone": "+919999999999",
  "password": "Tenant@123",
  "lease_start_date": "2026-03-01",
  "lease_end_date": "2027-02-28",
  "monthly_rent": 25000,
  "payment_due_day": 5
}
```

### GET `/api/owners/tenants`
### GET `/api/owners/tenants/:id`
Returns tenant, ticket history, and reminder history.

### PATCH `/api/owners/tenants/:id`
### DELETE `/api/owners/tenants/:id`

### GET `/api/owners/tickets`
### PATCH `/api/owners/tickets/:id`
Body:
```json
{ "status": "in_progress" }
```

### GET `/api/owners/notifications`
### PATCH `/api/owners/notifications/:id/read`

### GET `/api/owners/dashboard-summary`
Response:
```json
{
  "ok": true,
  "summary": {
    "active_tenants": 6,
    "open_tickets": 2,
    "overdue_rent": 1,
    "reminders_pending": 15,
    "unread_notifications": 4
  }
}
```

### POST `/api/owners/process-reminders`
Generates reminder rows for active tenants and creates owner notifications for currently due reminders.

### GET `/api/owners/automation/settings`
Returns current owner automation settings. Defaults are returned when no settings row exists.

### PUT `/api/owners/automation/settings`
Updates owner automation settings.

### GET `/api/owners/automation/activity`
Returns automation run history for the owner's organization.

## Owner AI Settings (Preparation Mode)
All routes below require owner token.

### GET `/api/owner/ai-settings`
Returns current organization AI settings and whether backend OpenAI is configured.
If no settings row exists yet, defaults are returned.

### PUT `/api/owner/ai-settings`
Body (partial update supported):
```json
{
  "automation_enabled": false,
  "ticket_classification_enabled": false,
  "reminder_generation_enabled": false,
  "ticket_summarization_enabled": false,
  "ai_model": "gpt-4.1-mini"
}
```

## Tenant Routes
All routes below require tenant token.

### GET `/api/tenants/dashboard-summary`
Response:
```json
{
  "ok": true,
  "summary": {
    "open_tickets": 1,
    "pending_reminders": 2,
    "payment_status": "pending",
    "monthly_rent": 25000,
    "payment_due_day": 5,
    "lease_start_date": "2026-03-01",
    "lease_end_date": "2027-02-28",
    "next_due_date": "2026-04-05T09:00:00.000Z"
  }
}
```

### GET `/api/tenants/property`
Returns tenant + property + lease/rent fields.

### GET `/api/tenants/tickets`
### POST `/api/tenants/tickets`
Body:
```json
{
  "subject": "Leaking tap",
  "message": "The tap in kitchen is leaking since morning"
}
```

### GET `/api/tenants/owner-contact`
Returns support email + WhatsApp.

## Internal Scheduler Routes
Use header `x-internal-automation-key` (or bearer token) with `INTERNAL_AUTOMATION_KEY`.

### POST `/api/internal/automation/tick`
Enqueues daily automation jobs and optionally dispatches pending jobs.

### POST `/api/internal/automation/dispatch`
Dispatches pending automation jobs only.

## Notes
- Owner and tenant auth are isolated JWT flows and include `organization_id` in JWT payload.
- Admin JWT flow is isolated with `role: "admin"` tokens.
- Creating a support ticket writes an owner notification and attempts owner email delivery.
- Reminder processing is manual for now and cron-ready.
- Internal automation foundation now supports queue-based scheduled workflows.
- Owner/Tenant resource routes are organization-scoped; cross-organization access is blocked.
- AI module endpoints are infrastructure-only in this phase; no AI workflow is active yet.
