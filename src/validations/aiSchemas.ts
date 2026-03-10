import { z } from 'zod'

export const updateOrganizationAiSettingsSchema = z
  .object({
    automation_enabled: z.boolean().optional(),
    ticket_classification_enabled: z.boolean().optional(),
    reminder_generation_enabled: z.boolean().optional(),
    ticket_summarization_enabled: z.boolean().optional(),
    ai_model: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one AI setting field is required',
  })

