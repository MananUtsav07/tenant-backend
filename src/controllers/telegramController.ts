import type { Request, Response } from 'express'

import { env } from '../config/env.js'
import { asyncHandler } from '../lib/errors.js'
import { linkTelegramChatFromStartToken } from '../services/telegramOnboardingService.js'

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
}

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

  // Telegram clients can wrap long payloads; JWT payload never contains whitespace.
  const normalizedToken = matched[1].replace(/\s+/g, '')
  return normalizedToken.length > 0 ? normalizedToken : null
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
  const startToken = readStartToken(payload.message?.text)
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
