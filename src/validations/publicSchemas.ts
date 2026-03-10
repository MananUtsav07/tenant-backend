import { z } from 'zod'

export const createContactMessageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  message: z.string().trim().min(10).max(3000),
})

export const createAnalyticsEventSchema = z.object({
  event_name: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9_:\-.]+$/i),
  user_type: z.enum(['public', 'owner', 'tenant', 'admin', 'system']).default('public'),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
