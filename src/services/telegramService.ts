import type { PostgrestError } from '@supabase/supabase-js'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

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

type TelegramInlineKeyboardButton = {
  text: string
  callback_data: string
}

type TelegramReplyMarkup =
  | {
      inline_keyboard: TelegramInlineKeyboardButton[][]
    }
  | {
      force_reply: true
      input_field_placeholder?: string
      selective?: boolean
    }

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

export function isTelegramMessagingConfigured() {
  return typeof env.TELEGRAM_BOT_TOKEN === 'string' && env.TELEGRAM_BOT_TOKEN.trim().length > 0
}

async function postTelegramApi<TPayload extends Record<string, unknown>>(method: string, payload: TPayload) {
  if (!isTelegramMessagingConfigured()) {
    throw new AppError('Telegram bot token is not configured', 500)
  }

  const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const responseBody = await response.text()
    throw new AppError(`Telegram API ${method} failed`, 502, responseBody)
  }
}

async function createTelegramDeliveryLog(input: TelegramDeliveryLogInput) {
  const { error } = await supabaseAdmin.from('telegram_delivery_logs').insert({
    organization_id: input.organizationId ?? null,
    owner_id: input.ownerId ?? null,
    tenant_id: input.tenantId ?? null,
    user_role: input.userRole ?? 'system',
    event_type: input.eventType,
    recipient_chat_id: input.recipientChatId,
    status: input.status,
    attempts: input.attempts,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? {},
  })

  throwIfError(error, 'Failed to log Telegram delivery status')
}

export async function listOwnerTelegramDeliveryLogs(input: {
  organizationId: string
  ownerId: string
  page: number
  pageSize: number
}) {
  const from = (input.page - 1) * input.pageSize
  const to = from + input.pageSize - 1

  const { data, error, count } = await supabaseAdmin
    .from('telegram_delivery_logs')
    .select(
      'id, event_type, status, attempts, recipient_chat_id, error_message, metadata, created_at, updated_at',
      { count: 'exact' },
    )
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .order('created_at', { ascending: false })
    .range(from, to)

  throwIfError(error, 'Failed to load Telegram delivery logs')
  return {
    items: data ?? [],
    total: count ?? 0,
  }
}

export async function getOwnerTelegramChatLink(input: { organizationId: string; ownerId: string }) {
  const { data, error } = await supabaseAdmin
    .from('telegram_chat_links')
    .select('organization_id, owner_id, tenant_id, chat_id, telegram_user_id, telegram_username')
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'owner')
    .eq('owner_id', input.ownerId)
    .eq('is_active', true)
    .maybeSingle()

  throwIfError(error, 'Failed to load owner Telegram chat link')
  return (data as TelegramChatLink | null) ?? null
}

export async function getTenantTelegramChatLink(input: { organizationId: string; tenantId: string }) {
  const { data, error } = await supabaseAdmin
    .from('telegram_chat_links')
    .select('organization_id, owner_id, tenant_id, chat_id, telegram_user_id, telegram_username')
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'tenant')
    .eq('tenant_id', input.tenantId)
    .eq('is_active', true)
    .maybeSingle()

  throwIfError(error, 'Failed to load tenant Telegram chat link')
  return (data as TelegramChatLink | null) ?? null
}

export async function getOwnerTelegramChatLinkByChat(input: { chatId: string; telegramUserId?: string }) {
  let request = supabaseAdmin
    .from('telegram_chat_links')
    .select('organization_id, owner_id, tenant_id, chat_id, telegram_user_id, telegram_username')
    .eq('user_role', 'owner')
    .eq('chat_id', input.chatId)
    .eq('is_active', true)
    .limit(1)

  if (input.telegramUserId) {
    request = request.eq('telegram_user_id', input.telegramUserId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to load owner Telegram chat link for chat')
  return (data as TelegramChatLink | null) ?? null
}

export async function disconnectTelegramByChat(input: { chatId: string; telegramUserId?: string }) {
  let request = supabaseAdmin
    .from('telegram_chat_links')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('chat_id', input.chatId)
    .eq('is_active', true)

  if (input.telegramUserId) {
    request = request.eq('telegram_user_id', input.telegramUserId)
  }

  const { data, error } = await request.select('id')
  throwIfError(error, 'Failed to disconnect Telegram chat link by chat')
  return (data ?? []).length
}

export async function sendTelegramMessage(input: {
  chatId: string
  text: string
  replyMarkup?: TelegramReplyMarkup
}) {
  await postTelegramApi('sendMessage', {
    chat_id: input.chatId,
    text: input.text,
    disable_web_page_preview: true,
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
  })
}

export async function answerTelegramCallbackQuery(input: {
  callbackQueryId: string
  text?: string
  showAlert?: boolean
}) {
  await postTelegramApi('answerCallbackQuery', {
    callback_query_id: input.callbackQueryId,
    text: input.text,
    show_alert: input.showAlert ?? false,
  })
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
    await createTelegramDeliveryLog({
      organizationId: input.logContext.organizationId,
      ownerId: input.logContext.ownerId,
      tenantId: input.logContext.tenantId,
      userRole: input.logContext.userRole ?? 'system',
      eventType: input.logContext.eventType,
      recipientChatId: input.chatId,
      status: 'failed',
      attempts: 1,
      errorMessage: 'Telegram bot token is not configured',
      metadata: input.logContext.metadata,
    })
    return false
  }

  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 5))
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await sendTelegramMessage({
        chatId: input.chatId,
        text: input.text,
        replyMarkup: input.replyMarkup,
      })

      await createTelegramDeliveryLog({
        organizationId: input.logContext.organizationId,
        ownerId: input.logContext.ownerId,
        tenantId: input.logContext.tenantId,
        userRole: input.logContext.userRole ?? 'system',
        eventType: input.logContext.eventType,
        recipientChatId: input.chatId,
        status: 'success',
        attempts: attempt,
        metadata: input.logContext.metadata,
      })

      return true
    } catch (error) {
      lastError = error
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : 'Telegram message delivery failed'
  await createTelegramDeliveryLog({
    organizationId: input.logContext.organizationId,
    ownerId: input.logContext.ownerId,
    tenantId: input.logContext.tenantId,
    userRole: input.logContext.userRole ?? 'system',
    eventType: input.logContext.eventType,
    recipientChatId: input.chatId,
    status: 'failed',
    attempts: maxAttempts,
    errorMessage,
    metadata: input.logContext.metadata,
  })

  return false
}

export async function cleanupTelegramArtifacts(input: {
  onboardingCodeMaxAgeHours: number
  deliveryLogMaxAgeDays: number
}) {
  const now = new Date()
  const onboardingCutoff = new Date(now.getTime() - input.onboardingCodeMaxAgeHours * 60 * 60 * 1000).toISOString()
  const deliveryCutoff = new Date(now.getTime() - input.deliveryLogMaxAgeDays * 24 * 60 * 60 * 1000).toISOString()

  const { error: onboardingError, data: onboardingRows } = await supabaseAdmin
    .from('telegram_onboarding_codes')
    .delete()
    .or(`expires_at.lt.${now.toISOString()},created_at.lt.${onboardingCutoff}`)
    .select('id')

  throwIfError(onboardingError, 'Failed to clean Telegram onboarding codes')

  const { error: deliveryError, data: deliveryRows } = await supabaseAdmin
    .from('telegram_delivery_logs')
    .delete()
    .lt('created_at', deliveryCutoff)
    .select('id')

  throwIfError(deliveryError, 'Failed to clean Telegram delivery logs')

  return {
    onboarding_codes_removed: (onboardingRows ?? []).length,
    delivery_logs_removed: (deliveryRows ?? []).length,
  }
}
