import { z } from 'zod'

export const whatsappWebhookChallengeSchema = z
  .object({
    'hub.mode': z.string().trim().optional(),
    'hub.verify_token': z.string().trim().optional(),
    'hub.challenge': z.string().trim().optional(),
    mode: z.string().trim().optional(),
    verify_token: z.string().trim().optional(),
    challenge: z.string().trim().optional(),
  })
  .passthrough()

export const whatsappWebhookPayloadSchema = z.unknown()
