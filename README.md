# Tenant Backend

Standalone Express + TypeScript backend for the Property Management Dashboard platform.

## Stack
- Express 5
- TypeScript
- Supabase Postgres (service role on server only)
- Nodemailer
- JWT (separate admin, owner, and tenant auth)

## Project Structure
- `src/app.ts`: Express app factory and route/middleware mounting.
- `src/index.ts`: local Node server bootstrap (`app.listen`).
- `api/index.js`: Vercel serverless entrypoint.
- `vercel.json`: Vercel build/runtime/routing config.
- `src/config/env.ts`: env validation and normalized config.
- `src/lib/*`: reusable infrastructure (JWT, Supabase client, mailer, errors).
- `src/middleware/*`: auth guards, request context, rate limiting, global error handling.
- `src/validations/*`: zod request schemas.
- `src/services/*`: database + business logic.
- `src/controllers/*`: thin HTTP handlers.
- `src/routes/*`: route groups.
- `src/controllers/publicController.ts`: public website handlers.
- `src/services/publicService.ts`: public contact data persistence.
- `src/controllers/adminController.ts`: admin auth + operations handlers.
- `src/controllers/blogController.ts`: public blog API handlers.
- `src/services/adminService.ts`: admin reporting/listing/system metrics.
- `src/services/blogService.ts`: blog CRUD/read services.
- `src/services/analyticsService.ts`: analytics event ingestion and summaries.
- `supabase/migrations/*`: SQL schema migrations.
- `docs/API_ROUTES.md`: request/response contract.

## Environment
Copy `.env.example` to `.env` and fill values.

Required vars:
- `PORT`
- `NODE_ENV`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `EMAIL_USER`
- `EMAIL_PASS`
- `OPENAI_API_KEY` (optional until AI rollout)
- `INTERNAL_AUTOMATION_KEY` (required for internal scheduler endpoints)
- `FRONTEND_URL`
- `ALLOWED_ORIGINS`

## Setup
```bash
npm install
npm run dev
```

Build and run:
```bash
npm run build
npm run start
```

## Deploy to Vercel
This backend is configured for Vercel serverless deployment.

1. Import the `tenant-backend` repo in Vercel.
2. Use default project settings.
3. Add environment variables in Vercel Project Settings:
   - `NODE_ENV=production`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `EMAIL_USER`
   - `EMAIL_PASS`
   - `OPENAI_API_KEY` (optional)
   - `INTERNAL_AUTOMATION_KEY`
   - `FRONTEND_URL` (your frontend Vercel URL)
   - `ALLOWED_ORIGINS` (comma-separated list; include your frontend URL)
4. Deploy and verify health:
   - `https://<your-backend-project>.vercel.app/api/health`

## Database Setup
Run migrations in Supabase SQL editor, in order:
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_property_scope_updates.sql`
- `supabase/migrations/003_contact_messages.sql`
- `supabase/migrations/004_admin_blog_analytics.sql`
- `supabase/migrations/005_billing_subscriptions.sql`
- `supabase/migrations/006_multi_tenant_organizations.sql`
- `supabase/migrations/007_ai_infrastructure.sql`
- `supabase/migrations/008_remove_stripe_integration.sql`
- `supabase/migrations/009_seed_additional_admin_users.sql`
- `supabase/migrations/010_organization_country_currency.sql`
- `supabase/migrations/011_rent_payment_approvals.sql`
- `supabase/migrations/012_automation_foundation.sql`

Seeded admin (development):
- email: `support@prophives.com`
- password: `Admin@12345`

## Public API
- `POST /api/public/contact` accepts contact form submissions from the marketing site.
- Contact messages are stored in `public.contact_messages`.
- Backend attempts to send a notification email to `EMAIL_USER` after storage.
- `POST /api/public/analytics` stores conversion/engagement events in `public.analytics_events`.
- `GET /api/blog` and `GET /api/blog/:slug` provide public blog content.

## Auth Model
- Owner JWT payload: `{ sub, role: "owner", email, organization_id }`
- Tenant JWT payload: `{ sub, role: "tenant", owner_id, tenant_access_id, organization_id }`
- Admin JWT payload: `{ sub, role: "admin", email }`

## Multi-Tenancy
- `organizations` is the top-level tenant boundary.
- Owner, tenant, property, ticket, reminder, notification, and subscription records are scoped by `organization_id`.
- Owner and tenant JWTs carry `organization_id`; middleware attaches `{ userId, role, organizationId }` to `req.auth`.
- Owner and tenant services enforce organization filtering on all reads/writes to prevent cross-organization access.
- `owner_memberships` supports organization-team expansion.
- `audit_logs` captures organization-aware actions for traceability.

## Admin API
- Admin auth: `POST /api/admin/login`, `GET /api/admin/me`
- Admin operations:
  - `GET /api/admin/dashboard-summary`
  - `GET /api/admin/ai-status`
  - `GET /api/admin/system-health`
  - `GET /api/admin/organizations`
  - `GET /api/admin/organizations/:id`
  - `GET /api/admin/owners`
  - `GET /api/admin/tenants`
  - `GET /api/admin/properties`
  - `GET /api/admin/tickets`
  - `GET /api/admin/contact-messages`
  - `GET /api/admin/analytics`
  - `GET /api/admin/automations/health`
  - `GET /api/admin/automations/runs`
  - `GET /api/admin/automations/errors`
  - Blog management: `GET/POST/PUT/DELETE /api/admin/blog...`

## Reminder Processing
- `POST /api/owners/process-reminders` creates and processes reminder records around rent due dates.
- Reminder notifications are added to owner notifications when reminder time has arrived.

## Automation Foundation
- Owner automation settings/activity:
  - `GET /api/owners/automation/settings`
  - `PUT /api/owners/automation/settings`
  - `GET /api/owners/automation/activity`
- Internal scheduler endpoints:
  - `POST /api/internal/automation/tick`
  - `POST /api/internal/automation/dispatch`
  - Auth: `x-internal-automation-key` or `Authorization: Bearer <INTERNAL_AUTOMATION_KEY>`

## AI Infrastructure (Preparation Mode)
- AI service scaffolding is under `src/services/ai`.
- Organization-level AI settings are persisted in `organization_ai_settings`.
- Owner settings endpoints:
  - `GET /api/owner/ai-settings`
  - `PUT /api/owner/ai-settings`
- AI remains disabled by default and no live automation is enabled in current flows.

## Email Notifications
Owner receives email when:
- Tenant raises a support ticket

## Safety
- Service role key is never exposed to frontend.
- RLS is enabled in schema; app uses backend-only service role queries.
- Admin, owner, and tenant routes are protected with role-specific JWT middleware.
- Basic auth and tenant/public API rate limiting with request IDs are enabled.
