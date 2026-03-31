import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { createAuditLog } from '../services/auditLogService.js'
import { getOrganizationAiSettings, updateOrganizationAiSettings } from '../services/ai/aiConfigService.js'
import { isAiConfigured } from '../services/ai/aiClient.js'
import { updateOrganizationAiSettingsSchema } from '../validations/aiSchemas.js'
import { env } from '../config/env.js'
import { classifyTicketIntent } from '../services/ai/intentClassifier.js'
import { summarizeTicket } from '../services/ai/ticketSummarizer.js'
import {
  createOwnerTelegramConnectUrl,
  getOwnerTelegramConnectionState,
  getTelegramBotUsername,
} from '../services/telegramOnboardingService.js'
import { getOwnerWhatsAppLink } from '../services/whatsappLinkService.js'

function requireOwnerContext(request: Request): { ownerId: string; organizationId: string } {
  const ownerId = request.owner?.ownerId
  const organizationId = request.owner?.organizationId ?? request.auth?.organizationId ?? null
  if (!ownerId || !organizationId) {
    throw new AppError('Owner authentication required', 401)
  }

  return { ownerId, organizationId }
}

export const getOwnerAiSettings = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const settings = await getOrganizationAiSettings(organizationId)

  response.json({
    ok: true,
    ai_configured: isAiConfigured(),
    settings,
  })
})

export const putOwnerAiSettings = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const patch = updateOrganizationAiSettingsSchema.parse(request.body)

  const settings = await updateOrganizationAiSettings(organizationId, patch)
  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'organization.ai_settings_updated',
    entity_type: 'organization_ai_settings',
    entity_id: settings.id,
    metadata: patch,
  })

  response.json({
    ok: true,
    ai_configured: isAiConfigured(),
    settings,
  })
})

export const getOwnerIntegrations = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const [telegramState, whatsappLink] = await Promise.all([
    getOwnerTelegramConnectionState({ ownerId, organizationId }),
    getOwnerWhatsAppLink({ ownerId, organizationId }),
  ])
  const telegramBotUsername = getTelegramBotUsername()
  const telegramConnectUrl =
    env.TELEGRAM_BOT_TOKEN && telegramBotUsername
      ? await createOwnerTelegramConnectUrl({
          ownerId,
          organizationId,
        })
      : null

  response.json({
    ok: true,
    integrations: {
      whatsapp: {
        configured: env.WHATSAPP_PROVIDER === 'meta',
        provider: env.WHATSAPP_PROVIDER ?? null,
        live: env.WHATSAPP_PROVIDER === 'meta' && !!env.WHATSAPP_ACCESS_TOKEN,
        linked: Boolean(whatsappLink?.is_active && whatsappLink.phone_number),
        linked_number: whatsappLink?.phone_number ?? null,
      },
      telegram: {
        configured: !!env.TELEGRAM_BOT_TOKEN,
        linked: telegramState.connected,
        bot_username: telegramBotUsername,
        connect_url: telegramConnectUrl,
        linked_chat: telegramState.linked_chat,
      },
      email: {
        configured: !!env.EMAIL_USER && !!env.EMAIL_PASS,
      },
      instagram: {
        configured: false,
        coming_soon: true,
      },
    },
  })
})

export const postOwnerTicketClassify = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const { subject, message, ticket_id } = request.body as {
    subject: string
    message: string
    ticket_id?: string
  }

  const result = await classifyTicketIntent({
    organizationId,
    ticketId: ticket_id,
    subject,
    message,
  })

  if (result === null) {
    response.json({ ok: false, reason: 'AI classification not enabled or not configured' })
    return
  }

  response.json({ ok: true, classification: result })
})

export const postOwnerTicketSummarize = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const { ticket_id, subject, message, updates } = request.body as {
    ticket_id: string
    subject: string
    message: string
    updates?: Array<{ timestamp: string; author: string; message: string }>
  }

  const result = await summarizeTicket({
    organizationId,
    ticketId: ticket_id,
    subject,
    message,
    updates,
  })

  if (result === null) {
    response.json({ ok: false, reason: 'AI summarization not enabled or not configured' })
    return
  }

  response.json({ ok: true, summary: result })
})

