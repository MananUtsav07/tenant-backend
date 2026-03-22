import { z } from 'zod'

export const tenantMarkRentPaidSchema = z.object({}).strict()

export const ownerReviewRentPaymentSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    rejection_reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'reject') {
      return
    }

    if (typeof value.rejection_reason !== 'undefined' && value.rejection_reason.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rejection_reason is only allowed when action is reject',
        path: ['rejection_reason'],
      })
    }
  })
