import type { Request, Response } from 'express'

import { asyncHandler } from '../lib/errors.js'
import { getAutomationProviderRegistry } from '../services/automation/providers/providerRegistry.js'
import { whatsappWebhookChallengeSchema, whatsappWebhookPayloadSchema } from '../validations/whatsappSchemas.js'

// In-memory rate limiter: max 10 messages per sender per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000

function isRateLimited(sender: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(sender)
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(sender, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  if (entry.count >= RATE_LIMIT_MAX) return true
  entry.count++
  return false
}

function collectHeaders(request: Request) {
  return Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  )
}

export const getWhatsAppWebhook = asyncHandler(async (request: Request, response: Response) => {
  const query = whatsappWebhookChallengeSchema.parse(request.query ?? {})
  const result = await getAutomationProviderRegistry().whatsapp.handleWebhookChallenge({
    query,
    headers: collectHeaders(request),
  })

  if (!result.handled) {
    response.status(404).json({
      ok: false,
      error: 'WhatsApp webhook is not configured',
    })
    return
  }

  if (typeof result.body === 'string') {
    response.status(result.statusCode).send(result.body)
    return
  }

  response.status(result.statusCode).json(result.body)
})

export const postWhatsAppWebhook = asyncHandler(async (request: Request, response: Response) => {
  const payload = whatsappWebhookPayloadSchema.parse(request.body)

  // Extract sender phone for rate limiting (Twilio: From field, Meta: contacts[0].wa_id)
  const sender: string =
    (request.body?.From as string) ||
    (request.body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id as string) ||
    'unknown'

  if (isRateLimited(sender)) {
    response.status(429).json({ ok: false, error: 'Too many messages' })
    return
  }

  const result = await getAutomationProviderRegistry().whatsapp.handleWebhookEvent({
    headers: collectHeaders(request),
    body: payload,
    rawBody: request.rawBody ?? null,
    requestId: request.requestId ?? null,
  })

  response.status(result.statusCode).json({
    ok: true,
    handled: result.handled,
    processed_events: result.events.length,
  })
})
