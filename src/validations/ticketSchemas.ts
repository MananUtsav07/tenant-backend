import { z } from 'zod'

const optionalTrimmedMessage = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  },
  z.string().max(3000).optional(),
)

export const createTicketReplySchema = z.object({
  message: z.string().trim().min(1).max(3000),
})

export const updateSupportTicketStatusSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
    closing_message: optionalTrimmedMessage,
  })
  .superRefine((value, context) => {
    if (value.closing_message && value.status !== 'closed') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closing_message'],
        message: 'Closing message can only be sent when closing a ticket',
      })
    }
  })
