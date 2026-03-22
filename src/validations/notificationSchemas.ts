import { z } from 'zod'

export const ownerNotificationPreferencesUpdateSchema = z
  .object({
    ticket_created_email: z.boolean().optional(),
    ticket_created_telegram: z.boolean().optional(),
    ticket_reply_email: z.boolean().optional(),
    ticket_reply_telegram: z.boolean().optional(),
    rent_payment_awaiting_approval_email: z.boolean().optional(),
    rent_payment_awaiting_approval_telegram: z.boolean().optional(),
  })
  .strict()

export const ownerTelegramDeliveryLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
})

export const adminTelegramMaintenanceSchema = z
  .object({
    onboarding_code_max_age_hours: z.coerce.number().int().min(1).max(72).optional().default(12),
    delivery_log_max_age_days: z.coerce.number().int().min(1).max(365).optional().default(30),
  })
  .strict()
