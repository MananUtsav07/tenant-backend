import { z } from 'zod'

export const ownerAutomationSettingsUpdateSchema = z
  .object({
    compliance_alerts_enabled: z.boolean().optional(),
    rent_chasing_enabled: z.boolean().optional(),
    portfolio_visibility_enabled: z.boolean().optional(),
    cash_flow_reporting_enabled: z.boolean().optional(),
    daily_digest_enabled: z.boolean().optional(),
    weekly_digest_enabled: z.boolean().optional(),
    monthly_digest_enabled: z.boolean().optional(),
    status_command_enabled: z.boolean().optional(),
    yield_alert_threshold_percent: z
      .preprocess((value) => {
        if (value === '' || value === null || typeof value === 'undefined') {
          return null
        }
        return typeof value === 'string' ? Number(value) : value
      }, z.number().min(0).max(100).nullable())
      .optional(),
    yield_alert_cooldown_days: z.coerce.number().int().min(1).max(90).optional(),
    quiet_hours_start: z
      .string()
      .trim()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
      .nullable()
      .optional(),
    quiet_hours_end: z
      .string()
      .trim()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
      .nullable()
      .optional(),
  })
  .strict()

export const internalAutomationTickSchema = z
  .object({
    enqueue_only: z.boolean().optional().default(false),
    dispatch_limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    now: z.string().datetime().optional(),
  })
  .strict()

export const internalAutomationDispatchSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    now: z.string().datetime().optional(),
  })
  .strict()

export const adminAutomationRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  flow_name: z.string().trim().max(80).optional(),
  status: z.enum(['success', 'failed', 'partial', 'skipped', 'cancelled']).optional(),
  organization_id: z.string().uuid().optional(),
})

export const adminAutomationJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  job_type: z.string().trim().max(80).optional(),
  lifecycle_status: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled']).optional(),
  organization_id: z.string().uuid().optional(),
})

export const adminAutomationErrorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  flow_name: z.string().trim().max(80).optional(),
  organization_id: z.string().uuid().optional(),
})

export const ownerAutomationActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
})

export const ownerAutomationCashFlowGenerateSchema = z
  .object({
    scope: z.enum(['current', 'monthly', 'annual']).optional().default('current'),
    year: z.coerce.number().int().min(2000).max(9999).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  })
  .strict()

export const ownerAutomationMaintenanceCostCreateSchema = z
  .object({
    property_id: z.string().uuid(),
    amount: z.coerce.number().positive(),
    incurred_on: z.string().date(),
    vendor_name: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    invoice_ref: z.string().trim().max(120).nullable().optional(),
    source_type: z.enum(['manual', 'ticket', 'invoice', 'automation']).optional().default('manual'),
  })
  .strict()

export const adminAutomationComplianceQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
})

export const adminAutomationCashFlowQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
})

export const adminAutomationPortfolioVisibilityQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
})
