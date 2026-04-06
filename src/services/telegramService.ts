import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'

type TelegramUserRole = 'owner' | 'tenant' | 'system'

type TelegramChatLink = {
  organization_id: string
  owner_id: string | null
  tenant_id: string | null
  chat_id: string
  telegram_user_id: string
  telegram_username: string | null
}

type TelegramDeliveryLogInput = {
  organizationId?: string
  ownerId?: string
  tenantId?: string
  userRole?: TelegramUserRole
  eventType: string
  recipientChatId: string
  status: 'success' | 'failed'
  attempts: number
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

type TelegramInlineKeyboardButton = { text: string; callback_data: string }
type TelegramReplyMarkup =
  | { inline_keyboard: TelegramInlineKeyboardButton[][] }
  | { force_reply: true; input_field_placeholder?: string; selective?: boolean }

export function isTelegramMessagingConfigured() {
  return typeof env.TELEGRAM_BOT_TOKEN === 'string' && env.TELEGRAM_BOT_TOKEN.trim().length > 0
}

async function postTelegramApi<TPayload extends Record<string, unknown>>(method: string, payload: TPayload) {
  if (!isTelegramMessagingConfigured()) throw new AppError('Telegram bot token is not configured', 500)
  const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (!response.ok) {
    const responseBody = await response.text()
    throw new AppError(`Telegram API ${method} failed`, 502, responseBody)
  }
}

async function createTelegramDeliveryLog(input: TelegramDeliveryLogInput) {
  await prisma.telegram_delivery_logs.create({
    data: {
      organization_id: input.organizationId ?? null,
      owner_id: input.ownerId ?? null,
      tenant_id: input.tenantId ?? null,
      user_role: input.userRole ?? 'system',
      event_type: input.eventType,
      recipient_chat_id: input.recipientChatId,
      status: input.status,
      attempts: input.attempts,
      error_message: input.errorMessage ?? null,
      metadata: (input.metadata ?? {}) as object,
    },
  })
}

export async function listOwnerTelegramDeliveryLogs(input: { organizationId: string; ownerId: string; page: number; pageSize: number }) {
  const skip = (input.page - 1) * input.pageSize
  const [items, total] = await prisma.$transaction([
    prisma.telegram_delivery_logs.findMany({
      select: { id: true, event_type: true, status: true, attempts: true, recipient_chat_id: true, error_message: true, metadata: true, created_at: true, updated_at: true },
      where: { organization_id: input.organizationId, owner_id: input.ownerId },
      orderBy: { created_at: 'desc' },
      skip,
      take: input.pageSize,
    }),
    prisma.telegram_delivery_logs.count({ where: { organization_id: input.organizationId, owner_id: input.ownerId } }),
  ])
  return { items, total }
}

export async function getOwnerTelegramChatLink(input: { organizationId: string; ownerId: string }) {
  return prisma.telegram_chat_links.findFirst({
    select: { organization_id: true, owner_id: true, tenant_id: true, chat_id: true, telegram_user_id: true, telegram_username: true },
    where: { organization_id: input.organizationId, user_role: 'owner', owner_id: input.ownerId, is_active: true },
  }) as Promise<TelegramChatLink | null>
}

export async function getTenantTelegramChatLink(input: { organizationId: string; tenantId: string }) {
  return prisma.telegram_chat_links.findFirst({
    select: { organization_id: true, owner_id: true, tenant_id: true, chat_id: true, telegram_user_id: true, telegram_username: true },
    where: { organization_id: input.organizationId, user_role: 'tenant', tenant_id: input.tenantId, is_active: true },
  }) as Promise<TelegramChatLink | null>
}

export async function getOwnerTelegramChatLinkByChat(input: { chatId: string; telegramUserId?: string }) {
  return prisma.telegram_chat_links.findFirst({
    select: { organization_id: true, owner_id: true, tenant_id: true, chat_id: true, telegram_user_id: true, telegram_username: true },
    where: { user_role: 'owner', chat_id: input.chatId, is_active: true, ...(input.telegramUserId ? { telegram_user_id: input.telegramUserId } : {}) },
  }) as Promise<TelegramChatLink | null>
}

export async function disconnectTelegramByChat(input: { chatId: string; telegramUserId?: string }) {
  const result = await prisma.telegram_chat_links.updateMany({
    where: { chat_id: input.chatId, is_active: true, ...(input.telegramUserId ? { telegram_user_id: input.telegramUserId } : {}) },
    data: { is_active: false },
  })
  return result.count
}

export async function sendTelegramMessage(input: { chatId: string; text: string; replyMarkup?: TelegramReplyMarkup }) {
  await postTelegramApi('sendMessage', { chat_id: input.chatId, text: input.text, disable_web_page_preview: true, ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}) })
}

export async function answerTelegramCallbackQuery(input: { callbackQueryId: string; text?: string; showAlert?: boolean }) {
  await postTelegramApi('answerCallbackQuery', { callback_query_id: input.callbackQueryId, text: input.text, show_alert: input.showAlert ?? false })
}

export async function sendTelegramMessageWithRetry(input: {
  chatId: string
  text: string
  replyMarkup?: TelegramReplyMarkup
  maxAttempts?: number
  logContext: {
    organizationId?: string
    ownerId?: string
    tenantId?: string
    userRole?: TelegramUserRole
    eventType: string
    metadata?: Record<string, unknown>
  }
}) {
  if (!isTelegramMessagingConfigured()) {
    await createTelegramDeliveryLog({ ...input.logContext, userRole: input.logContext.userRole ?? 'system', recipientChatId: input.chatId, status: 'failed', attempts: 1, errorMessage: 'Telegram bot token is not configured' })
    return false
  }

  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 5))
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendTelegramMessage({ chatId: input.chatId, text: input.text, replyMarkup: input.replyMarkup })
      await createTelegramDeliveryLog({ ...input.logContext, userRole: input.logContext.userRole ?? 'system', recipientChatId: input.chatId, status: 'success', attempts: attempt })
      return true
    } catch (error) {
      lastError = error
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : 'Telegram message delivery failed'
  await createTelegramDeliveryLog({ ...input.logContext, userRole: input.logContext.userRole ?? 'system', recipientChatId: input.chatId, status: 'failed', attempts: maxAttempts, errorMessage })
  return false
}

export async function cleanupTelegramArtifacts(input: { onboardingCodeMaxAgeHours: number; deliveryLogMaxAgeDays: number }) {
  const now = new Date()
  const onboardingCutoff = new Date(now.getTime() - input.onboardingCodeMaxAgeHours * 60 * 60 * 1000)
  const deliveryCutoff = new Date(now.getTime() - input.deliveryLogMaxAgeDays * 24 * 60 * 60 * 1000)

  const [onboardingResult, deliveryResult] = await Promise.all([
    prisma.telegram_onboarding_codes.deleteMany({ where: { OR: [{ expires_at: { lt: now } }, { created_at: { lt: onboardingCutoff } }] } }),
    prisma.telegram_delivery_logs.deleteMany({ where: { created_at: { lt: deliveryCutoff } } }),
  ])

  return { onboarding_codes_removed: onboardingResult.count, delivery_logs_removed: deliveryResult.count }
}
