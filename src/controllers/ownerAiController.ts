import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { createAuditLog } from '../services/auditLogService.js'
import { getOrganizationAiSettings, updateOrganizationAiSettings } from '../services/ai/aiConfigService.js'
import { isAiConfigured } from '../services/ai/aiClient.js'
import { updateOrganizationAiSettingsSchema } from '../validations/aiSchemas.js'
import { env } from '../config/env.js'
import { classifyTicketIntent } from '../services/ai/intentClassifier.js'
import { summarizeTicket } from '../services/ai/ticketSummarizer.js'
import { draftTicketReply } from '../services/ai/replyDrafter.js'
import { draftBroadcastMessage } from '../services/ai/broadcastDrafter.js'
import { draftWhatsappMessage } from '../services/ai/whatsappDrafter.js'
import { generateLeaseDigest } from '../services/ai/leaseDigest.js'
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
        configured: env.WHATSAPP_PROVIDER === 'meta' || env.WHATSAPP_PROVIDER === 'twilio',
        provider: env.WHATSAPP_PROVIDER ?? null,
        live: (env.WHATSAPP_PROVIDER === 'meta' && !!env.WHATSAPP_ACCESS_TOKEN)
           || (env.WHATSAPP_PROVIDER === 'twilio' && !!env.TWILIO_ACCOUNT_SID),
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

export const postOwnerDraftTicketReply = asyncHandler(async (request: Request, response: Response) => {
  requireOwnerContext(request)
  const { ticket_id, subject, message, updates, tenant_name, property_name } = request.body as {
    ticket_id?: string
    subject: string
    message: string
    updates?: Array<{ timestamp: string; author: string; message: string }>
    tenant_name?: string
    property_name?: string
  }

  const result = await draftTicketReply({ subject, message, updates, tenantName: tenant_name, propertyName: property_name })

  if (result === null) {
    response.json({ ok: false, reason: 'AI reply drafting not available or not configured' })
    return
  }

  void ticket_id
  response.json({ ok: true, draft: result })
})

export const postOwnerDraftBroadcast = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const { topic } = request.body as { topic: string }

  void organizationId
  const result = await draftBroadcastMessage({ topic })

  if (result === null) {
    response.json({ ok: false, reason: 'AI broadcast drafting not available or not configured' })
    return
  }

  response.json({ ok: true, draft: result })
})

export const postOwnerDraftWhatsapp = asyncHandler(async (request: Request, response: Response) => {
  requireOwnerContext(request)
  const { intent, tenant_name } = request.body as { intent: string; tenant_name: string }

  const result = await draftWhatsappMessage({ intent, tenantName: tenant_name })

  if (result === null) {
    response.json({ ok: false, reason: 'AI WhatsApp drafting not available or not configured' })
    return
  }

  response.json({ ok: true, draft: result })
})

export const postOwnerLeaseDigest = asyncHandler(async (request: Request, response: Response) => {
  requireOwnerContext(request)
  const { tenants } = request.body as {
    tenants: Array<{ name: string; lease_end_date: string | null; payment_status: string; monthly_rent: number }>
  }

  const now = new Date()
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  const expiring = tenants.filter((t) => {
    if (!t.lease_end_date) return false
    const end = new Date(t.lease_end_date)
    return end >= now && end <= in60Days
  })

  const overdue = tenants.filter((t) => t.payment_status === 'overdue')

  const detailLines = tenants.map((t) => {
    const leaseEnd = t.lease_end_date ? new Date(t.lease_end_date).toDateString() : 'N/A'
    return `- ${t.name}: lease ends ${leaseEnd}, rent status: ${t.payment_status}`
  })

  const result = await generateLeaseDigest({
    expiringCount: expiring.length,
    overdueCount: overdue.length,
    tenantDetails: detailLines.join('\n'),
  })

  if (result === null) {
    response.json({ ok: false, reason: 'AI lease digest not available or not configured' })
    return
  }

  response.json({
    ok: true,
    digest: {
      ...result,
      expiring_count: expiring.length,
      overdue_count: overdue.length,
    },
  })
})

