import { randomBytes } from 'node:crypto'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
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

function ensureTelegramBotUsername() {
  if (!env.TELEGRAM_BOT_USERNAME) throw new AppError('Telegram bot username is not configured', 500)
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
  return `tg_${randomBytes(32).toString('base64url')}`
}

function expiresAtIso() {
  return new Date(Date.now() + env.TELEGRAM_ONBOARDING_TOKEN_TTL_MINUTES * 60_000)
}

async function createOnboardingCodeRecord(input: {
  role: TelegramUserRole
  organizationId: string
  ownerId?: string
  tenantId?: string
}) {
  const code = createOnboardingCode()
  await prisma.telegram_onboarding_codes.create({
    data: {
      code,
      user_role: input.role,
      organization_id: input.organizationId,
      owner_id: input.role === 'owner' ? input.ownerId ?? null : null,
      tenant_id: input.role === 'tenant' ? input.tenantId ?? null : null,
      expires_at: expiresAtIso(),
    },
  })
  return code
}

export async function createOwnerTelegramConnectUrl(input: { ownerId: string; organizationId: string }) {
  const code = await createOnboardingCodeRecord({ role: 'owner', ownerId: input.ownerId, organizationId: input.organizationId })
  return buildDeepLink(code)
}

export async function createTenantTelegramConnectUrl(input: { tenantId: string; organizationId: string }) {
  const code = await createOnboardingCodeRecord({ role: 'tenant', tenantId: input.tenantId, organizationId: input.organizationId })
  return buildDeepLink(code)
}

async function consumeOnboardingCode(code: string) {
  const row = await prisma.telegram_onboarding_codes.findFirst({
    select: { code: true, user_role: true, organization_id: true, owner_id: true, tenant_id: true, expires_at: true, consumed_at: true },
    where: { code },
  })

  if (!row) throw new AppError('Invalid Telegram onboarding token', 400)
  if (row.consumed_at) throw new AppError('Telegram onboarding token already used', 400)

  const now = new Date()
  if (row.expires_at <= now) throw new AppError('Invalid or expired Telegram onboarding token', 400)

  await prisma.telegram_onboarding_codes.updateMany({
    where: { code, consumed_at: null },
    data: { consumed_at: now },
  })

  return row
}

async function getConnectionByRole(input: {
  role: TelegramUserRole
  organizationId: string
  ownerId?: string
  tenantId?: string
}): Promise<TelegramConnectionState> {
  const row = await prisma.telegram_chat_links.findFirst({
    select: { chat_id: true, telegram_username: true, telegram_first_name: true, telegram_last_name: true, linked_at: true },
    where: {
      organization_id: input.organizationId,
      user_role: input.role,
      is_active: true,
      ...(input.role === 'owner' ? { owner_id: input.ownerId ?? '' } : { tenant_id: input.tenantId ?? '' }),
    },
  })

  if (!row) return { connected: false, linked_chat: null }

  const r = row as unknown as TelegramConnectionRow
  return {
    connected: true,
    linked_chat: {
      chat_id: r.chat_id,
      username: r.telegram_username,
      first_name: r.telegram_first_name,
      last_name: r.telegram_last_name,
      linked_at: typeof r.linked_at === 'string' ? r.linked_at : (r.linked_at as unknown as Date).toISOString(),
    },
  }
}

export function getOwnerTelegramConnectionState(input: { ownerId: string; organizationId: string }) {
  return getConnectionByRole({ role: 'owner', ownerId: input.ownerId, organizationId: input.organizationId })
}

export function getTenantTelegramConnectionState(input: { tenantId: string; organizationId: string }) {
  return getConnectionByRole({ role: 'tenant', tenantId: input.tenantId, organizationId: input.organizationId })
}

export async function disconnectOwnerTelegram(input: { ownerId: string; organizationId: string }) {
  const result = await prisma.telegram_chat_links.updateMany({
    where: { organization_id: input.organizationId, user_role: 'owner', owner_id: input.ownerId, is_active: true },
    data: { is_active: false },
  })
  return result.count > 0
}

export async function disconnectTenantTelegram(input: { tenantId: string; organizationId: string }) {
  const result = await prisma.telegram_chat_links.updateMany({
    where: { organization_id: input.organizationId, user_role: 'tenant', tenant_id: input.tenantId, is_active: true },
    data: { is_active: false },
  })
  return result.count > 0
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
    if (!owner) throw new AppError('Owner not found for Telegram onboarding', 404)

    await prisma.telegram_chat_links.upsert({
      where: { owner_id: onboarding.owner_id },
      create: {
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
        linked_at: new Date(),
      },
      update: {
        chat_id: input.chatId,
        telegram_user_id: input.telegramUserId,
        telegram_username: input.username,
        telegram_first_name: input.firstName,
        telegram_last_name: input.lastName,
        is_active: true,
        linked_at: new Date(),
      },
    })

    return { role: 'owner' as const, owner_id: onboarding.owner_id, tenant_id: null, organization_id: organizationId }
  }

  if (typeof onboarding.tenant_id !== 'string' || onboarding.tenant_id.length === 0) {
    throw new AppError('Invalid tenant token payload', 400)
  }

  const tenant = await getTenantById(onboarding.tenant_id, organizationId)
  if (!tenant) throw new AppError('Tenant not found for Telegram onboarding', 404)

  await prisma.telegram_chat_links.upsert({
    where: { tenant_id: onboarding.tenant_id },
    create: {
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
      linked_at: new Date(),
    },
    update: {
      chat_id: input.chatId,
      telegram_user_id: input.telegramUserId,
      telegram_username: input.username,
      telegram_first_name: input.firstName,
      telegram_last_name: input.lastName,
      is_active: true,
      linked_at: new Date(),
    },
  })

  return { role: 'tenant' as const, owner_id: null, tenant_id: onboarding.tenant_id, organization_id: organizationId }
}
