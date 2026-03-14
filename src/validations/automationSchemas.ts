import { z } from 'zod'

export const ownerAutomationSettingsUpdateSchema = z
  .object({
    compliance_alerts_enabled: z.boolean().optional(),
    rent_chasing_enabled: z.boolean().optional(),
    portfolio_visibility_enabled: z.boolean().optional(),
    daily_digest_enabled: z.boolean().optional(),
    weekly_digest_enabled: z.boolean().optional(),
    monthly_digest_enabled: z.boolean().optional(),
    status_command_enabled: z.boolean().optional(),
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
  status: z.enum(['success', 'failed', 'partial']).optional(),
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
