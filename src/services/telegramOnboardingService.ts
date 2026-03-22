import type { PostgrestError } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { getOwnerById } from './ownerService.js'
import { getTenantById } from './tenantService.js'

type TelegramUserRole = 'owner' | 'tenant'

type TelegramConnectionRow = {
  chat_id: string
  telegram_username: string | null
  telegram_first_name: string | null
  telegram_last_name: string | null
  linked_at: string
}

type TelegramConnectionState = {
  connected: boolean
  linked_chat: {
    chat_id: string
    username: string | null
    first_name: string | null
    last_name: string | null
    linked_at: string
  } | null
}

type OnboardingCodeRow = {
  code: string
  user_role: TelegramUserRole
  organization_id: string
  owner_id: string | null
  tenant_id: string | null
  expires_at: string
  consumed_at: string | null
}

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function ensureTelegramBotUsername() {
  if (!env.TELEGRAM_BOT_USERNAME) {
    throw new AppError('Telegram bot username is not configured', 500)
  }

  return env.TELEGRAM_BOT_USERNAME
}

export function getTelegramBotUsername(): string | null {
  return env.TELEGRAM_BOT_USERNAME ?? null
}

function buildDeepLink(code: string) {
  const botUsername = ensureTelegramBotUsername()
  return `https://t.me/${botUsername}?start=${code}`
}

function createOnboardingCode() {
  // 43-char URL-safe payload, reliable for Telegram start deep links.
  return `tg_${randomBytes(32).toString('base64url')}`
}

function expiresAtIso() {
  return new Date(Date.now() + env.TELEGRAM_ONBOARDING_TOKEN_TTL_MINUTES * 60_000).toISOString()
}

async function createOnboardingCodeRecord(input: {
  role: TelegramUserRole
  organizationId: string
  ownerId?: string
  tenantId?: string
}) {
  const code = createOnboardingCode()
  const { error } = await supabaseAdmin.from('telegram_onboarding_codes').insert({
    code,
    user_role: input.role,
    organization_id: input.organizationId,
    owner_id: input.role === 'owner' ? input.ownerId ?? null : null,
    tenant_id: input.role === 'tenant' ? input.tenantId ?? null : null,
    expires_at: expiresAtIso(),
  })
  throwIfError(error, 'Failed to create Telegram onboarding code')
  return code
}

export async function createOwnerTelegramConnectUrl(input: { ownerId: string; organizationId: string }) {
  const code = await createOnboardingCodeRecord({
    role: 'owner',
    ownerId: input.ownerId,
    organizationId: input.organizationId,
  })
  return buildDeepLink(code)
}

export async function createTenantTelegramConnectUrl(input: { tenantId: string; organizationId: string }) {
  const code = await createOnboardingCodeRecord({
    role: 'tenant',
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
  return buildDeepLink(code)
}

async function consumeOnboardingCode(code: string): Promise<OnboardingCodeRow> {
  const { data, error } = await supabaseAdmin
    .from('telegram_onboarding_codes')
    .select('code, user_role, organization_id, owner_id, tenant_id, expires_at, consumed_at')
    .eq('code', code)
    .maybeSingle()

  throwIfError(error, 'Failed to verify Telegram onboarding code')

  const row = (data as OnboardingCodeRow | null) ?? null
  if (!row) {
    throw new AppError('Invalid Telegram onboarding token', 400)
  }

  if (row.consumed_at) {
    throw new AppError('Telegram onboarding token already used', 400)
  }

  const now = new Date()
  const expiresAt = new Date(row.expires_at)
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new AppError('Invalid or expired Telegram onboarding token', 400)
  }

  const { error: updateError } = await supabaseAdmin
    .from('telegram_onboarding_codes')
    .update({
      consumed_at: now.toISOString(),
    })
    .eq('code', code)
    .is('consumed_at', null)

  throwIfError(updateError, 'Failed to consume Telegram onboarding code')
  return row
}

async function getConnectionByRole(input: {
  role: TelegramUserRole
  organizationId: string
  ownerId?: string
  tenantId?: string
}): Promise<TelegramConnectionState> {
  let request = supabaseAdmin
    .from('telegram_chat_links')
    .select('chat_id, telegram_username, telegram_first_name, telegram_last_name, linked_at')
    .eq('organization_id', input.organizationId)
    .eq('user_role', input.role)
    .eq('is_active', true)
    .limit(1)

  if (input.role === 'owner') {
    request = request.eq('owner_id', input.ownerId ?? '')
  } else {
    request = request.eq('tenant_id', input.tenantId ?? '')
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to load Telegram connection state')

  const row = (data as TelegramConnectionRow | null) ?? null
  if (!row) {
    return {
      connected: false,
      linked_chat: null,
    }
  }

  return {
    connected: true,
    linked_chat: {
      chat_id: row.chat_id,
      username: row.telegram_username,
      first_name: row.telegram_first_name,
      last_name: row.telegram_last_name,
      linked_at: row.linked_at,
    },
  }
}

export function getOwnerTelegramConnectionState(input: { ownerId: string; organizationId: string }) {
  return getConnectionByRole({
    role: 'owner',
    ownerId: input.ownerId,
    organizationId: input.organizationId,
  })
}

export function getTenantTelegramConnectionState(input: { tenantId: string; organizationId: string }) {
  return getConnectionByRole({
    role: 'tenant',
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
}

export async function disconnectOwnerTelegram(input: { ownerId: string; organizationId: string }) {
  const { data, error } = await supabaseAdmin
    .from('telegram_chat_links')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'owner')
    .eq('owner_id', input.ownerId)
    .eq('is_active', true)
    .select('id')

  throwIfError(error, 'Failed to disconnect Telegram for owner')
  return (data ?? []).length > 0
}

export async function disconnectTenantTelegram(input: { tenantId: string; organizationId: string }) {
  const { data, error } = await supabaseAdmin
    .from('telegram_chat_links')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'tenant')
    .eq('tenant_id', input.tenantId)
    .eq('is_active', true)
    .select('id')

  throwIfError(error, 'Failed to disconnect Telegram for tenant')
  return (data ?? []).length > 0
}

export async function linkTelegramChatFromStartToken(input: {
  startToken: string
  chatId: string
  telegramUserId: string
  username: string | null
  firstName: string | null
  lastName: string | null
}) {
  const onboarding = await consumeOnboardingCode(input.startToken)
  const organizationId = onboarding.organization_id

  if (onboarding.user_role === 'owner') {
    if (typeof onboarding.owner_id !== 'string' || onboarding.owner_id.length === 0) {
      throw new AppError('Invalid owner token payload', 400)
    }

    const owner = await getOwnerById(onboarding.owner_id, organizationId)
    if (!owner) {
      throw new AppError('Owner not found for Telegram onboarding', 404)
    }

    const { error } = await supabaseAdmin.from('telegram_chat_links').upsert(
      {
        organization_id: organizationId,
        user_role: 'owner',
        owner_id: onboarding.owner_id,
        tenant_id: null,
        chat_id: input.chatId,
        telegram_user_id: input.telegramUserId,
        telegram_username: input.username,
        telegram_first_name: input.firstName,
        telegram_last_name: input.lastName,
        is_active: true,
        linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id' },
    )

    throwIfError(error, 'Failed to link owner Telegram chat')
    return {
      role: 'owner' as const,
      owner_id: onboarding.owner_id,
      tenant_id: null,
      organization_id: organizationId,
    }
  }

  if (typeof onboarding.tenant_id !== 'string' || onboarding.tenant_id.length === 0) {
    throw new AppError('Invalid tenant token payload', 400)
  }

  const tenant = await getTenantById(onboarding.tenant_id, organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found for Telegram onboarding', 404)
  }

  const { error } = await supabaseAdmin.from('telegram_chat_links').upsert(
    {
      organization_id: organizationId,
      user_role: 'tenant',
      owner_id: null,
      tenant_id: onboarding.tenant_id,
      chat_id: input.chatId,
      telegram_user_id: input.telegramUserId,
      telegram_username: input.username,
      telegram_first_name: input.firstName,
      telegram_last_name: input.lastName,
      is_active: true,
      linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  )

  throwIfError(error, 'Failed to link tenant Telegram chat')
  return {
    role: 'tenant' as const,
    owner_id: null,
    tenant_id: onboarding.tenant_id,
    organization_id: organizationId,
  }
}
