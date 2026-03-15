import type { Request, Response } from 'express'

import { asyncHandler } from '../lib/errors.js'
import { getAutomationProviderRegistry } from '../services/automation/providers/providerRegistry.js'
import { whatsappWebhookChallengeSchema, whatsappWebhookPayloadSchema } from '../validations/whatsappSchemas.js'

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
  const result = await getAutomationProviderRegistry().whatsapp.handleWebhookEvent({
    headers: collectHeaders(request),
    body: payload,
    requestId: request.requestId ?? null,
  })

  response.status(result.statusCode).json({
    ok: true,
    handled: result.handled,
    processed_events: result.events.length,
  })
})
