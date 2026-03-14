import type { PostgrestError } from '@supabase/supabase-js'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

type OwnerTelegramChatLink = {
  chat_id: string
  telegram_username: string | null
}

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

export function isTelegramMessagingConfigured() {
  return typeof env.TELEGRAM_BOT_TOKEN === 'string' && env.TELEGRAM_BOT_TOKEN.trim().length > 0
}

export async function getOwnerTelegramChatLink(input: { organizationId: string; ownerId: string }) {
  const { data, error } = await supabaseAdmin
    .from('telegram_chat_links')
    .select('chat_id, telegram_username')
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'owner')
    .eq('owner_id', input.ownerId)
    .eq('is_active', true)
    .maybeSingle()

  throwIfError(error, 'Failed to load owner Telegram chat link')
  return (data as OwnerTelegramChatLink | null) ?? null
}

export async function sendTelegramMessage(input: { chatId: string; text: string }) {
  if (!isTelegramMessagingConfigured()) {
    return
  }

  const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const responseBody = await response.text()
    throw new AppError('Failed to send Telegram message', 502, responseBody)
  }
}
