import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

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

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
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
  const { data, error } = await supabaseAdmin
    .from('whatsapp_chat_links')
    .select('id, organization_id, user_role, owner_id, tenant_id, phone_number, phone_number_e164, is_active, linked_via, last_inbound_at')
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'owner')
    .eq('owner_id', input.ownerId)
    .eq('is_active', true)
    .maybeSingle()

  throwIfError(error, 'Failed to load owner WhatsApp link')
  return (data as WhatsAppChatLink | null) ?? null
}

export async function getTenantWhatsAppLink(input: { organizationId: string; tenantId: string }) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_chat_links')
    .select('id, organization_id, user_role, owner_id, tenant_id, phone_number, phone_number_e164, is_active, linked_via, last_inbound_at')
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'tenant')
    .eq('tenant_id', input.tenantId)
    .eq('is_active', true)
    .maybeSingle()

  throwIfError(error, 'Failed to load tenant WhatsApp link')
  return (data as WhatsAppChatLink | null) ?? null
}

export async function getOwnerWhatsAppLinkBySender(sender: string) {
  const normalized = normalizeWhatsAppPhone(sender)
  let query = supabaseAdmin
    .from('whatsapp_chat_links')
    .select('id, organization_id, user_role, owner_id, tenant_id, phone_number, phone_number_e164, is_active, linked_via, last_inbound_at')
    .eq('user_role', 'owner')
    .eq('is_active', true)

  if (normalized) {
    query = query.eq('phone_number_e164', normalized)
  }

  const { data, error } = await query.limit(1)
  throwIfError(error, 'Failed to load owner WhatsApp link by sender')

  const exact = ((data ?? [])[0] as WhatsAppChatLink | undefined) ?? null
  if (exact) {
    return exact
  }

  const { data: fallbackRows, error: fallbackError } = await supabaseAdmin
    .from('whatsapp_chat_links')
    .select('id, organization_id, user_role, owner_id, tenant_id, phone_number, phone_number_e164, is_active, linked_via, last_inbound_at')
    .eq('user_role', 'owner')
    .eq('is_active', true)

  throwIfError(fallbackError, 'Failed to load owner WhatsApp fallback links')
  return ((fallbackRows ?? []) as WhatsAppChatLink[]).find((row) => phoneMatch(row.phone_number, sender)) ?? null
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
    const { error } = await supabaseAdmin
      .from('whatsapp_chat_links')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', input.organizationId)
      .eq('user_role', 'owner')
      .eq('owner_id', input.ownerId)

    throwIfError(error, 'Failed to deactivate owner WhatsApp link')
    return null
  }

  const payload = {
    organization_id: input.organizationId,
    user_role: 'owner' as const,
    owner_id: input.ownerId,
    tenant_id: null,
    phone_number: input.phoneNumber?.trim() ?? normalized,
    phone_number_e164: normalized,
    is_active: input.isActive ?? true,
    linked_via: input.linkedVia ?? 'owner_profile',
    linked_at: new Date().toISOString(),
    last_inbound_at: input.lastInboundAt ?? undefined,
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('whatsapp_chat_links')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('user_role', 'owner')
    .eq('owner_id', input.ownerId)
    .maybeSingle()

  throwIfError(existingError, 'Failed to load owner WhatsApp link for upsert')

  if (existing?.id) {
    const { data, error } = await supabaseAdmin
      .from('whatsapp_chat_links')
      .update({
        phone_number: payload.phone_number,
        phone_number_e164: payload.phone_number_e164,
        is_active: payload.is_active,
        linked_via: payload.linked_via,
        linked_at: payload.linked_at,
        last_inbound_at: payload.last_inbound_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, organization_id, user_role, owner_id, tenant_id, phone_number, phone_number_e164, is_active, linked_via, last_inbound_at')
      .single()

    throwIfError(error, 'Failed to update owner WhatsApp link')
    return data as WhatsAppChatLink
  }

  const { data, error } = await supabaseAdmin
    .from('whatsapp_chat_links')
    .insert(payload)
    .select('id, organization_id, user_role, owner_id, tenant_id, phone_number, phone_number_e164, is_active, linked_via, last_inbound_at')
    .single()

  throwIfError(error, 'Failed to create owner WhatsApp link')
  return data as WhatsAppChatLink
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
    const { error } = await supabaseAdmin
      .from('whatsapp_chat_links')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', input.organizationId)
      .eq('user_role', 'tenant')
      .eq('tenant_id', input.tenantId)

    throwIfError(error, 'Failed to deactivate tenant WhatsApp link')
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('whatsapp_chat_links')
    .upsert(
      {
        organization_id: input.organizationId,
        user_role: 'tenant',
        owner_id: input.ownerId ?? null,
        tenant_id: input.tenantId,
        phone_number: input.phoneNumber?.trim() ?? normalized,
        phone_number_e164: normalized,
        is_active: input.isActive ?? true,
        linked_via: input.linkedVia ?? 'tenant_phone',
        linked_at: new Date().toISOString(),
        last_inbound_at: input.lastInboundAt ?? undefined,
      },
      { onConflict: 'organization_id,user_role,tenant_id' },
    )
    .select('id, organization_id, user_role, owner_id, tenant_id, phone_number, phone_number_e164, is_active, linked_via, last_inbound_at')
    .single()

  throwIfError(error, 'Failed to upsert tenant WhatsApp link')
  return data as WhatsAppChatLink
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

  let request = supabaseAdmin
    .from('whatsapp_chat_links')
    .update({
      phone_number_e164: normalized,
      phone_number: input.senderPhone.trim(),
      is_active: true,
      last_inbound_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', input.organizationId)
    .eq('user_role', input.userRole)

  if (input.userRole === 'owner' && input.ownerId) {
    request = request.eq('owner_id', input.ownerId)
  }
  if (input.userRole === 'tenant' && input.tenantId) {
    request = request.eq('tenant_id', input.tenantId)
  }

  const { error } = await request
  throwIfError(error, 'Failed to update WhatsApp inbound timestamp')
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

  const lookback = new Date(Date.now() - (input.withinHours ?? 24) * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('whatsapp_inbound_events')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('sender_e164', normalized)
    .gte('received_at', lookback)
    .order('received_at', { ascending: false })
    .limit(1)

  throwIfError(error, 'Failed to verify WhatsApp session window')
  return (data ?? []).length > 0
}
