import { prisma } from '../lib/db.js'

export type WhatsAppLinkRole = 'owner' | 'tenant'

export type WhatsAppChatLink = {
  id: string
  organization_id: string
  user_role: WhatsAppLinkRole
  owner_id: string | null
  tenant_id: string | null
  phone_number: string
  phone_number_e164: string | null
  is_active: boolean
  linked_via: string | null
  last_inbound_at: string | null
}

const linkSelect = {
  id: true,
  organization_id: true,
  user_role: true,
  owner_id: true,
  tenant_id: true,
  phone_number: true,
  phone_number_e164: true,
  is_active: true,
  linked_via: true,
  last_inbound_at: true,
}

function toWhatsAppChatLink(row: {
  id: string
  organization_id: string
  user_role: string
  owner_id: string | null
  tenant_id: string | null
  phone_number: string
  phone_number_e164: string | null
  is_active: boolean
  linked_via: string | null
  last_inbound_at: Date | string | null
}): WhatsAppChatLink {
  return {
    id: row.id,
    organization_id: row.organization_id,
    user_role: row.user_role as WhatsAppLinkRole,
    owner_id: row.owner_id,
    tenant_id: row.tenant_id,
    phone_number: row.phone_number,
    phone_number_e164: row.phone_number_e164,
    is_active: row.is_active,
    linked_via: row.linked_via,
    last_inbound_at: row.last_inbound_at instanceof Date ? row.last_inbound_at.toISOString() : (row.last_inbound_at as string | null),
  }
}

export function normalizeWhatsAppPhone(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  if (digits.length < 7) {
    return null
  }

  return `${trimmed.startsWith('+') ? '+' : ''}${digits}`
}

function phoneMatch(aRaw: string, bRaw: string) {
  const a = normalizeWhatsAppPhone(aRaw)
  const b = normalizeWhatsAppPhone(bRaw)
  if (!a || !b) {
    return false
  }
  if (a === b) {
    return true
  }

  const aDigits = a.replace('+', '')
  const bDigits = b.replace('+', '')
  return aDigits.length >= 10 && bDigits.length >= 10 && (aDigits.endsWith(bDigits) || bDigits.endsWith(aDigits))
}

export async function getOwnerWhatsAppLink(input: { organizationId: string; ownerId: string }) {
  const row = await prisma.whatsapp_chat_links.findFirst({
    select: linkSelect,
    where: { organization_id: input.organizationId, user_role: 'owner', owner_id: input.ownerId, is_active: true },
  })
  return row ? toWhatsAppChatLink(row) : null
}

export async function getTenantWhatsAppLink(input: { organizationId: string; tenantId: string }) {
  const row = await prisma.whatsapp_chat_links.findFirst({
    select: linkSelect,
    where: { organization_id: input.organizationId, user_role: 'tenant', tenant_id: input.tenantId, is_active: true },
  })
  return row ? toWhatsAppChatLink(row) : null
}

export async function getOwnerWhatsAppLinkBySender(sender: string) {
  const normalized = normalizeWhatsAppPhone(sender)

  if (normalized) {
    const exact = await prisma.whatsapp_chat_links.findFirst({
      select: linkSelect,
      where: { user_role: 'owner', is_active: true, phone_number_e164: normalized },
    })
    if (exact) return toWhatsAppChatLink(exact)
  }

  const allOwnerLinks = await prisma.whatsapp_chat_links.findMany({
    select: linkSelect,
    where: { user_role: 'owner', is_active: true },
  })

  const match = allOwnerLinks.find((row) => phoneMatch(row.phone_number, sender))
  return match ? toWhatsAppChatLink(match) : null
}

export async function upsertOwnerWhatsAppLink(input: {
  organizationId: string
  ownerId: string
  phoneNumber: string | null | undefined
  linkedVia?: string
  isActive?: boolean
  lastInboundAt?: string | null
}) {
  const normalized = normalizeWhatsAppPhone(input.phoneNumber)
  if (!normalized) {
    await prisma.whatsapp_chat_links.updateMany({
      where: { organization_id: input.organizationId, user_role: 'owner', owner_id: input.ownerId },
      data: { is_active: false, updated_at: new Date() },
    })
    return null
  }

  const existing = await prisma.whatsapp_chat_links.findFirst({
    select: { id: true },
    where: { organization_id: input.organizationId, user_role: 'owner', owner_id: input.ownerId },
  })

  const now = new Date()
  const lastInboundAt = input.lastInboundAt ? new Date(input.lastInboundAt) : undefined

  if (existing) {
    const row = await prisma.whatsapp_chat_links.update({
      select: linkSelect,
      where: { id: existing.id },
      data: {
        phone_number: input.phoneNumber?.trim() ?? normalized,
        phone_number_e164: normalized,
        is_active: input.isActive ?? true,
        linked_via: input.linkedVia ?? 'owner_profile',
        linked_at: now,
        last_inbound_at: lastInboundAt,
        updated_at: now,
      },
    })
    return toWhatsAppChatLink(row)
  }

  const row = await prisma.whatsapp_chat_links.create({
    select: linkSelect,
    data: {
      organization_id: input.organizationId,
      user_role: 'owner',
      owner_id: input.ownerId,
      tenant_id: null,
      phone_number: input.phoneNumber?.trim() ?? normalized,
      phone_number_e164: normalized,
      is_active: input.isActive ?? true,
      linked_via: input.linkedVia ?? 'owner_profile',
      linked_at: now,
      last_inbound_at: lastInboundAt,
    },
  })
  return toWhatsAppChatLink(row)
}

export async function upsertTenantWhatsAppLink(input: {
  organizationId: string
  tenantId: string
  ownerId?: string | null
  phoneNumber: string | null | undefined
  linkedVia?: string
  isActive?: boolean
  lastInboundAt?: string | null
}) {
  const normalized = normalizeWhatsAppPhone(input.phoneNumber)
  if (!normalized) {
    await prisma.whatsapp_chat_links.updateMany({
      where: { organization_id: input.organizationId, user_role: 'tenant', tenant_id: input.tenantId },
      data: { is_active: false, updated_at: new Date() },
    })
    return null
  }

  const existing = await prisma.whatsapp_chat_links.findFirst({
    select: { id: true },
    where: { organization_id: input.organizationId, user_role: 'tenant', tenant_id: input.tenantId },
  })

  const now = new Date()
  const lastInboundAt = input.lastInboundAt ? new Date(input.lastInboundAt) : undefined
  const upsertData = {
    organization_id: input.organizationId,
    user_role: 'tenant' as const,
    owner_id: input.ownerId ?? null,
    tenant_id: input.tenantId,
    phone_number: input.phoneNumber?.trim() ?? normalized,
    phone_number_e164: normalized,
    is_active: input.isActive ?? true,
    linked_via: input.linkedVia ?? 'tenant_phone',
    linked_at: now,
    last_inbound_at: lastInboundAt,
  }

  if (existing) {
    const row = await prisma.whatsapp_chat_links.update({
      select: linkSelect,
      where: { id: existing.id },
      data: { ...upsertData, updated_at: now },
    })
    return toWhatsAppChatLink(row)
  }

  const row = await prisma.whatsapp_chat_links.create({ select: linkSelect, data: upsertData })
  return toWhatsAppChatLink(row)
}

export async function markWhatsAppInboundSeen(input: {
  organizationId: string
  userRole: WhatsAppLinkRole
  ownerId?: string | null
  tenantId?: string | null
  senderPhone: string
}) {
  const normalized = normalizeWhatsAppPhone(input.senderPhone)
  if (!normalized) {
    return
  }

  const now = new Date()
  const where: Record<string, unknown> = { organization_id: input.organizationId, user_role: input.userRole }
  if (input.userRole === 'owner' && input.ownerId) where.owner_id = input.ownerId
  if (input.userRole === 'tenant' && input.tenantId) where.tenant_id = input.tenantId

  await prisma.whatsapp_chat_links.updateMany({
    where,
    data: { phone_number_e164: normalized, phone_number: input.senderPhone.trim(), is_active: true, last_inbound_at: now, updated_at: now },
  })
}

export async function hasRecentWhatsAppSession(input: {
  organizationId: string
  phoneNumber: string
  withinHours?: number
}) {
  const normalized = normalizeWhatsAppPhone(input.phoneNumber)
  if (!normalized) {
    return false
  }

  const lookback = new Date(Date.now() - (input.withinHours ?? 24) * 60 * 60 * 1000)
  const row = await prisma.whatsapp_inbound_events.findFirst({
    select: { id: true },
    where: { organization_id: input.organizationId, sender_e164: normalized, received_at: { gte: lookback } },
    orderBy: { received_at: 'desc' },
  })
  return Boolean(row)
}
