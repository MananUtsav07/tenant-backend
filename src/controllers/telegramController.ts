import type { Request, Response } from 'express'

import { env } from '../config/env.js'
import { asyncHandler } from '../lib/errors.js'
import { notifyTenantTicketClosed, notifyTenantTicketStatusUpdated } from '../services/notificationService.js'
import { updateTicketStatusAsOwner } from '../services/ticketThreadService.js'
import { linkTelegramChatFromStartToken } from '../services/telegramOnboardingService.js'
import {
  answerTelegramCallbackQuery,
  disconnectTelegramByChat,
  getOwnerTelegramChatLinkByChat,
  sendTelegramMessageWithRetry,
} from '../services/telegramService.js'

type TelegramWebhookUpdate = {
  message?: {
    text?: string
    chat?: {
      id?: number | string
    }
    from?: {
      id?: number | string
      username?: string
      first_name?: string
      last_name?: string
    }
  }
  callback_query?: {
    id?: string
    data?: string
    from?: {
      id?: number | string
    }
    message?: {
      chat?: {
        id?: number | string
      }
    }
  }
}

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

function readStartToken(text: string | undefined): string | null {
  if (typeof text !== 'string') {
    return null
  }

  const trimmed = text.trim()
  if (!trimmed.toLowerCase().startsWith('/start')) {
    return null
  }

  const commandPattern = /^\/start(?:@[a-z0-9_]+)?(?:\s+|=)([\s\S]+)$/i
  const matched = trimmed.match(commandPattern)
  if (!matched || typeof matched[1] !== 'string') {
    return null
  }

  return matched[1].replace(/\s+/g, '') || null
}

function isDisconnectCommand(text: string | undefined): boolean {
  if (typeof text !== 'string') {
    return false
  }

  const normalized = text.trim().toLowerCase()
  return normalized === '/stop' || normalized === '/disconnect'
}

function parseCallbackData(data: string | undefined): { ticketId: string; status: TicketStatus } | null {
  if (typeof data !== 'string') {
    return null
  }

  const matched = data.match(/^ts\|([a-f0-9-]{36})\|(open|in_progress|resolved|closed)$/i)
  if (!matched) {
    return null
  }

  return {
    ticketId: matched[1],
    status: matched[2] as TicketStatus,
  }
}

async function processDisconnectCommand(payload: TelegramWebhookUpdate['message']) {
  const chatId = payload?.chat?.id
  const userId = payload?.from?.id
  if (chatId === undefined) {
    return
  }

  const disconnectedCount = await disconnectTelegramByChat({
    chatId: String(chatId),
    telegramUserId: userId !== undefined ? String(userId) : undefined,
  })

  await sendTelegramMessageWithRetry({
    chatId: String(chatId),
    text:
      disconnectedCount > 0
        ? 'Telegram alerts disconnected for this account. You can reconnect anytime from the app.'
        : 'No active Telegram link found for this chat.',
    logContext: {
      userRole: 'system',
      eventType: 'telegram_disconnect_command',
      metadata: {
        disconnected_count: disconnectedCount,
      },
    },
  })
}

async function processTicketStatusCallback(callback: NonNullable<TelegramWebhookUpdate['callback_query']>) {
  const callbackId = callback.id
  const chatId = callback.message?.chat?.id
  const userId = callback.from?.id
  const action = parseCallbackData(callback.data)

  if (!callbackId || chatId === undefined || userId === undefined || !action) {
    if (callbackId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        text: 'Invalid action payload.',
        showAlert: true,
      })
    }
    return
  }

  const ownerLink = await getOwnerTelegramChatLinkByChat({
    chatId: String(chatId),
    telegramUserId: String(userId),
  })

  if (!ownerLink || !ownerLink.owner_id) {
    await answerTelegramCallbackQuery({
      callbackQueryId: callbackId,
      text: 'Owner link not found for this Telegram chat.',
      showAlert: true,
    })
    return
  }

  const ticket = await updateTicketStatusAsOwner({
    ticketId: action.ticketId,
    ownerId: ownerLink.owner_id,
    organizationId: ownerLink.organization_id,
    status: action.status,
  })

  if (!ticket) {
    await answerTelegramCallbackQuery({
      callbackQueryId: callbackId,
      text: 'Ticket not found for your account.',
      showAlert: true,
    })
    return
  }

  const tenant = ticket.tenants as
    | {
        full_name?: string | null
        email?: string | null
      }
    | null
  const owner = ticket.owners as
    | {
        full_name?: string | null
        company_name?: string | null
        email?: string | null
      }
    | null
  const senderName = owner?.full_name?.trim() || owner?.company_name?.trim() || owner?.email?.trim() || 'Owner'

  if (action.status === 'closed') {
    await notifyTenantTicketClosed({
      organizationId: ticket.organization_id,
      ownerId: ticket.owner_id,
      tenantId: ticket.tenant_id,
      tenantEmail: tenant?.email ?? null,
      tenantName: tenant?.full_name ?? 'Tenant',
      subject: ticket.subject,
      senderName,
      senderRoleLabel: 'Owner',
      propertyName: null,
      unitNumber: null,
      closingMessage: null,
    })
  } else {
    await notifyTenantTicketStatusUpdated({
      organizationId: ticket.organization_id,
      ownerId: ticket.owner_id,
      tenantId: ticket.tenant_id,
      tenantEmail: tenant?.email ?? null,
      tenantName: tenant?.full_name ?? 'Tenant',
      subject: ticket.subject,
      senderName,
      senderRoleLabel: 'Owner',
      status: action.status,
    })
  }

  await answerTelegramCallbackQuery({
    callbackQueryId: callbackId,
    text: `Ticket moved to ${action.status.replaceAll('_', ' ')}.`,
  })
}

export const postTelegramWebhook = asyncHandler(async (request: Request, response: Response) => {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const provided = request.headers['x-telegram-bot-api-secret-token']
    const token = Array.isArray(provided) ? provided[0] : provided
    if (token !== env.TELEGRAM_WEBHOOK_SECRET) {
      response.status(401).json({ ok: false, error: 'Unauthorized webhook token' })
      return
    }
  }

  const payload = request.body as TelegramWebhookUpdate

  if (payload.callback_query) {
    try {
      await processTicketStatusCallback(payload.callback_query)
      response.json({ ok: true, callback_processed: true })
    } catch (error) {
      console.error('[telegram-callback-action-failed]', {
        requestId: request.requestId,
        error,
      })
      response.json({ ok: true, callback_processed: false })
    }
    return
  }

  const text = payload.message?.text
  if (isDisconnectCommand(text)) {
    try {
      await processDisconnectCommand(payload.message)
      response.json({ ok: true, disconnected: true })
    } catch (error) {
      console.error('[telegram-disconnect-command-failed]', {
        requestId: request.requestId,
        error,
      })
      response.json({ ok: true, disconnected: false })
    }
    return
  }

  const startToken = readStartToken(text)
  const chatId = payload.message?.chat?.id
  const userId = payload.message?.from?.id

  if (!startToken || chatId === undefined || userId === undefined) {
    response.json({
      ok: true,
      linked: false,
      ignored: true,
    })
    return
  }

  try {
    await linkTelegramChatFromStartToken({
      startToken,
      chatId: String(chatId),
      telegramUserId: String(userId),
      username: payload.message?.from?.username ?? null,
      firstName: payload.message?.from?.first_name ?? null,
      lastName: payload.message?.from?.last_name ?? null,
    })

    await sendTelegramMessageWithRetry({
      chatId: String(chatId),
      text: 'Telegram connected successfully. You will now receive alerts for your linked account.',
      logContext: {
        userRole: 'system',
        eventType: 'telegram_onboarding_success',
      },
    })

    response.json({
      ok: true,
      linked: true,
    })
  } catch (error) {
    console.error('[telegram-onboarding-link-failed]', {
      requestId: request.requestId,
      error,
    })
    response.json({
      ok: true,
      linked: false,
    })
  }
})
