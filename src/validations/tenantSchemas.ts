import { z } from 'zod'

export const createTenantTicketSchema = z.object({
  subject: z.string().trim().min(2).max(200),
  message: z.string().trim().min(5).max(3000),
})

export const tenantLeaseRenewalIntentSchema = z.object({
  decision: z.enum(['yes', 'no']),
})
