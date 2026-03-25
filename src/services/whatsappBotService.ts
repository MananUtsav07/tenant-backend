import bcrypt from 'bcryptjs'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { notifyTenantTicketReply } from './notificationService.js'
import { createProperty, createTenant, getOwnerDashboardSummary } from './ownerService.js'
import { reviewOwnerRentPaymentApproval } from './rentPaymentService.js'
import { replyToTicketAsOwner } from './ticketThreadService.js'

type SendTextFn = (input: {
  to: string
  text: string
  organizationId?: string | null
  ownerId?: string | null
  metadata?: Record<string, unknown>
}) => Promise<void>

type OwnerIdentity = {
  id: string
  organization_id: string
  full_name: string | null
  company_name: string | null
  email: string
  support_whatsapp: string | null
}

type AddPropertyConversation = {
  flow: 'add_property'
  ownerId: string
  organizationId: string
  step: 'property_name' | 'address' | 'unit_number' | 'confirm'
  data: {
    property_name?: string
    address?: string
    unit_number?: string
  }
  updatedAt: number
}

type AddTenantConversation = {
  flow: 'add_tenant'
  ownerId: string
  organizationId: string
  step: 'full_name' | 'email' | 'phone' | 'select_property' | 'password' | 'monthly_rent' | 'payment_due_day' | 'confirm'
  data: {
    full_name?: string
    email?: string
    phone?: string
    property_id?: string
    property_name?: string
    password?: string
    monthly_rent?: number
    payment_due_day?: number
    property_options?: Array<{ id: string; label: string }>
  }
  updatedAt: number
}

type ConversationState = AddPropertyConversation | AddTenantConversation

const CONVERSATION_TTL_MS = 10 * 60 * 1000
const conversations = new Map<string, ConversationState>()

function nowMs() {
  return Date.now()
}

function normalizePhone(value: string) {
  const trimmed = value.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  if (digits.length < 7) {
    return null
  }

  return `${trimmed.startsWith('+') ? '+' : ''}${digits}`
}

function phoneMatch(aRaw: string, bRaw: string) {
  const a = normalizePhone(aRaw)
  const b = normalizePhone(bRaw)
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

async function resolveOwnerBySenderPhone(sender: string): Promise<OwnerIdentity | null> {
  const { data, error } = await supabaseAdmin
    .from('owners')
    .select('id, organization_id, full_name, company_name, email, support_whatsapp')
    .not('support_whatsapp', 'is', null)

  if (error) {
    throw new AppError('Failed to resolve owner from WhatsApp sender', 500, error.message)
  }

  const rows = (data ?? []) as OwnerIdentity[]
  return rows.find((row) => (row.support_whatsapp ? phoneMatch(row.support_whatsapp, sender) : false)) ?? null
}

function getConversation(sender: string) {
  const conv = conversations.get(sender)
  if (!conv) {
    return null
  }

  if (nowMs() - conv.updatedAt > CONVERSATION_TTL_MS) {
    conversations.delete(sender)
    return null
  }

  return conv
}

function setConversation(sender: string, state: Omit<ConversationState, 'updatedAt'>) {
  conversations.set(sender, { ...state, updatedAt: nowMs() } as ConversationState)
}

function clearConversation(sender: string) {
  conversations.delete(sender)
}

function normalizeIncomingText(input: string | null | undefined) {
  if (!input) {
    return ''
  }
  return input.trim()
}

function normalizeCommandToken(text: string) {
  const normalized = text.trim().toLowerCase()
  if (!normalized) {
    return ''
  }

  const token = normalized.split(/\s+/)[0]
  return token.startsWith('/') ? token : `/${token}`
}

function parseReplyCommand(text: string): { ticketId: string; message: string } | null {
  const matched = text.trim().match(/^\/reply\s+([a-f0-9-]{36})\s+([\s\S]{1,2000})$/i)
  if (!matched) {
    return null
  }
  return {
    ticketId: matched[1],
    message: matched[2].trim(),
  }
}

function parseReviewCommand(text: string): { action: 'approve' | 'reject'; approvalId: string; message: string | null } | null {
  const matched = text.trim().match(/^\/(approve|reject)\s+([a-f0-9-]{36})(?:\s+([\s\S]{1,500}))?$/i)
  if (!matched) {
    return null
  }
  return {
    action: matched[1].toLowerCase() as 'approve' | 'reject',
    approvalId: matched[2],
    message: matched[3]?.trim() || null,
  }
}

function helpText() {
  return [
    'Prophives WhatsApp Commands',
    '/ownerstats - Owner quick stats',
    '/reply <ticket-id> <message> - Reply to tenant ticket',
    '/approve <approval-id> [message] - Approve rent',
    '/reject <approval-id> <reason> - Reject rent',
    '/addproperty - Add new property',
    '/addtenant - Add new tenant',
    '/disconnect - Stop WhatsApp bot for this number',
    '/cancel - Cancel active operation',
  ].join('\n')
}

async function handleOwnerStats(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn }) {
  const summary = await getOwnerDashboardSummary(input.owner.organization_id, input.owner.id)
  await input.sendText({
    to: input.sender,
    text: [
      'Owner Quick Stats',
      `Active tenants: ${summary.active_tenants}`,
      `Open tickets: ${summary.open_tickets}`,
      `Overdue rent: ${summary.overdue_rent}`,
      `Pending reminders: ${summary.reminders_pending}`,
      `Unread notifications: ${summary.unread_notifications}`,
      `Awaiting approvals: ${summary.awaiting_approvals}`,
    ].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_owner_stats' },
  })
}

async function handleReplyCommand(input: {
  owner: OwnerIdentity
  sender: string
  command: { ticketId: string; message: string }
  sendText: SendTextFn
}) {
  const replied = await replyToTicketAsOwner({
    ticketId: input.command.ticketId,
    ownerId: input.owner.id,
    organizationId: input.owner.organization_id,
    message: input.command.message,
  })

  const tenant = replied.ticket.tenants as
    | { full_name?: string | null; email?: string | null; properties?: { property_name?: string | null; unit_number?: string | null } | null }
    | null
  const owner = replied.ticket.owners as
    | { full_name?: string | null; company_name?: string | null; email?: string | null }
    | null
  const senderName = owner?.full_name?.trim() || owner?.company_name?.trim() || owner?.email?.trim() || 'Owner'

  await notifyTenantTicketReply({
    organizationId: replied.ticket.organization_id,
    ownerId: replied.ticket.owner_id,
    tenantId: replied.ticket.tenant_id,
    tenantEmail: tenant?.email ?? null,
    tenantName: tenant?.full_name ?? 'Tenant',
    subject: replied.ticket.subject,
    senderName,
    senderRoleLabel: 'Owner',
    propertyName: tenant?.properties?.property_name ?? null,
    unitNumber: tenant?.properties?.unit_number ?? null,
    message: input.command.message,
  })

  await input.sendText({
    to: input.sender,
    text: `Reply sent for ticket #${replied.ticket.id.slice(0, 8)}.`,
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_ticket_reply', ticket_id: replied.ticket.id },
  })
}

async function handleReviewCommand(input: {
  owner: OwnerIdentity
  sender: string
  command: { action: 'approve' | 'reject'; approvalId: string; message: string | null }
  sendText: SendTextFn
}) {
  await reviewOwnerRentPaymentApproval({
    approvalId: input.command.approvalId,
    ownerId: input.owner.id,
    organizationId: input.owner.organization_id,
    action: input.command.action,
    rejectionReason: input.command.action === 'reject' ? input.command.message ?? undefined : undefined,
    ownerMessage: input.command.message ?? undefined,
  })

  await input.sendText({
    to: input.sender,
    text:
      input.command.action === 'approve'
        ? `Approval ${input.command.approvalId.slice(0, 8)} approved.`
        : `Approval ${input.command.approvalId.slice(0, 8)} rejected.`,
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_rent_review', approval_id: input.command.approvalId, action: input.command.action },
  })
}

async function startAddProperty(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn }) {
  setConversation(input.sender, {
    flow: 'add_property',
    ownerId: input.owner.id,
    organizationId: input.owner.organization_id,
    step: 'property_name',
    data: {},
  })
  await input.sendText({
    to: input.sender,
    text: 'Add Property\nStep 1/3: Enter property name:',
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_add_property_start' },
  })
}

async function startAddTenant(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn }) {
  const { data: properties, error } = await supabaseAdmin
    .from('properties')
    .select('id, property_name, unit_number')
    .eq('organization_id', input.owner.organization_id)
    .eq('owner_id', input.owner.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    throw new AppError('Failed to load properties for Add Tenant', 500, error.message)
  }

  const options = (properties ?? []).map((property) => ({
    id: property.id as string,
    label: `${property.property_name}${property.unit_number ? ` (${property.unit_number})` : ''}`,
  }))

  if (options.length === 0) {
    await input.sendText({
      to: input.sender,
      text: 'You need at least one property before adding a tenant. Use /addproperty first.',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_add_tenant_no_properties' },
    })
    return
  }

  setConversation(input.sender, {
    flow: 'add_tenant',
    ownerId: input.owner.id,
    organizationId: input.owner.organization_id,
    step: 'full_name',
    data: {
      property_options: options,
    },
  })

  await input.sendText({
    to: input.sender,
    text: 'Add Tenant\nStep 1/7: Enter tenant full name:',
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_add_tenant_start' },
  })
}

async function disconnectOwnerWhatsAppLink(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn }) {
  const { error } = await supabaseAdmin
    .from('owners')
    .update({ support_whatsapp: null, updated_at: new Date().toISOString() })
    .eq('id', input.owner.id)
    .eq('organization_id', input.owner.organization_id)
    .eq('support_whatsapp', input.owner.support_whatsapp ?? '')

  if (error) {
    throw new AppError('Failed to disconnect WhatsApp number', 500, error.message)
  }

  await input.sendText({
    to: input.sender,
    text: 'WhatsApp bot disconnected for this account. Update support_whatsapp in app to reconnect.',
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_owner_disconnected' },
  })
}

async function processAddPropertyConversation(input: {
  sender: string
  conv: AddPropertyConversation
  text: string
  sendText: SendTextFn
}) {
  const value = input.text.trim()
  if (input.conv.step === 'property_name') {
    if (value.length < 1 || value.length > 200) {
      await input.sendText({ to: input.sender, text: 'Property name must be 1 to 200 characters. Try again.' })
      return
    }
    input.conv.data.property_name = value
    input.conv.step = 'address'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({ to: input.sender, text: `Saved: ${value}\nStep 2/3: Enter address:` })
    return
  }

  if (input.conv.step === 'address') {
    if (value.length < 1 || value.length > 400) {
      await input.sendText({ to: input.sender, text: 'Address must be 1 to 400 characters. Try again.' })
      return
    }
    input.conv.data.address = value
    input.conv.step = 'unit_number'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({ to: input.sender, text: `Saved address.\nStep 3/3: Enter unit number or type "skip".` })
    return
  }

  if (input.conv.step === 'unit_number') {
    if (value.toLowerCase() !== 'skip' && value.length > 50) {
      await input.sendText({ to: input.sender, text: 'Unit number must be <= 50 chars. Try again.' })
      return
    }
    input.conv.data.unit_number = value.toLowerCase() === 'skip' ? undefined : value
    input.conv.step = 'confirm'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({
      to: input.sender,
      text: [
        'Confirm property creation:',
        `Name: ${input.conv.data.property_name}`,
        `Address: ${input.conv.data.address}`,
        `Unit: ${input.conv.data.unit_number ?? '(none)'}`,
        'Reply YES to confirm, NO to cancel.',
      ].join('\n'),
    })
    return
  }

  if (input.conv.step === 'confirm') {
    if (value.toLowerCase() === 'yes') {
      const property = await createProperty({
        ownerId: input.conv.ownerId,
        organizationId: input.conv.organizationId,
        input: {
          property_name: input.conv.data.property_name!,
          address: input.conv.data.address!,
          unit_number: input.conv.data.unit_number,
        },
      })
      clearConversation(input.sender)
      await input.sendText({
        to: input.sender,
        text: `Property created.\nID: ${property.id}\nName: ${property.property_name}`,
        organizationId: input.conv.organizationId,
        ownerId: input.conv.ownerId,
        metadata: { event: 'whatsapp_add_property_success', property_id: property.id },
      })
      return
    }

    clearConversation(input.sender)
    await input.sendText({ to: input.sender, text: 'Add Property cancelled.' })
  }
}

async function processAddTenantConversation(input: {
  sender: string
  conv: AddTenantConversation
  text: string
  sendText: SendTextFn
}) {
  const value = input.text.trim()
  const lc = value.toLowerCase()
  if (input.conv.step === 'full_name') {
    if (value.length < 1 || value.length > 200) {
      await input.sendText({ to: input.sender, text: 'Name must be 1 to 200 characters. Try again.' })
      return
    }
    input.conv.data.full_name = value
    input.conv.step = 'email'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({ to: input.sender, text: 'Step 2/7: Enter email or type "skip".' })
    return
  }

  if (input.conv.step === 'email') {
    if (lc !== 'skip' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      await input.sendText({ to: input.sender, text: 'Invalid email. Enter valid email or "skip".' })
      return
    }
    input.conv.data.email = lc === 'skip' ? undefined : value.toLowerCase()
    input.conv.step = 'phone'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({ to: input.sender, text: 'Step 3/7: Enter phone number or type "skip".' })
    return
  }

  if (input.conv.step === 'phone') {
    if (lc !== 'skip' && value.length > 30) {
      await input.sendText({ to: input.sender, text: 'Phone must be <= 30 chars. Enter phone or "skip".' })
      return
    }
    input.conv.data.phone = lc === 'skip' ? undefined : value
    input.conv.step = 'select_property'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)

    const options = input.conv.data.property_options ?? []
    await input.sendText({
      to: input.sender,
      text: ['Step 4/7: Pick property by number', ...options.map((option, index) => `${index + 1}. ${option.label}`)].join('\n'),
    })
    return
  }

  if (input.conv.step === 'select_property') {
    const index = Number(value)
    const options = input.conv.data.property_options ?? []
    if (!Number.isInteger(index) || index < 1 || index > options.length) {
      await input.sendText({ to: input.sender, text: `Select a valid number between 1 and ${options.length}.` })
      return
    }

    const selected = options[index - 1]
    input.conv.data.property_id = selected.id
    input.conv.data.property_name = selected.label
    input.conv.step = 'password'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({ to: input.sender, text: 'Step 5/7: Enter tenant password (min 8 chars).' })
    return
  }

  if (input.conv.step === 'password') {
    if (value.length < 8) {
      await input.sendText({ to: input.sender, text: 'Password must be at least 8 characters.' })
      return
    }
    input.conv.data.password = value
    input.conv.step = 'monthly_rent'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({ to: input.sender, text: 'Step 6/7: Enter monthly rent amount.' })
    return
  }

  if (input.conv.step === 'monthly_rent') {
    const rent = Number(value)
    if (Number.isNaN(rent) || rent < 0) {
      await input.sendText({ to: input.sender, text: 'Enter valid non-negative rent amount.' })
      return
    }
    input.conv.data.monthly_rent = rent
    input.conv.step = 'payment_due_day'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({ to: input.sender, text: 'Step 7/7: Enter payment due day (1-31).' })
    return
  }

  if (input.conv.step === 'payment_due_day') {
    const dueDay = Number(value)
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      await input.sendText({ to: input.sender, text: 'Due day must be a number between 1 and 31.' })
      return
    }
    input.conv.data.payment_due_day = dueDay
    input.conv.step = 'confirm'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    await input.sendText({
      to: input.sender,
      text: [
        'Confirm tenant creation:',
        `Name: ${input.conv.data.full_name}`,
        `Email: ${input.conv.data.email ?? '(none)'}`,
        `Phone: ${input.conv.data.phone ?? '(none)'}`,
        `Property: ${input.conv.data.property_name}`,
        `Rent: ${input.conv.data.monthly_rent}`,
        `Due Day: ${input.conv.data.payment_due_day}`,
        'Reply YES to confirm, NO to cancel.',
      ].join('\n'),
    })
    return
  }

  if (input.conv.step === 'confirm') {
    if (lc === 'yes') {
      const passwordHash = await bcrypt.hash(input.conv.data.password!, 10)
      const tenant = await createTenant({
        ownerId: input.conv.ownerId,
        organizationId: input.conv.organizationId,
        input: {
          property_id: input.conv.data.property_id!,
          full_name: input.conv.data.full_name!,
          email: input.conv.data.email,
          phone: input.conv.data.phone,
          password_hash: passwordHash,
          monthly_rent: input.conv.data.monthly_rent!,
          payment_due_day: input.conv.data.payment_due_day!,
        },
      })
      clearConversation(input.sender)
      await input.sendText({
        to: input.sender,
        text: `Tenant created.\nAccess ID: ${tenant.tenant_access_id}\nName: ${tenant.full_name}`,
        organizationId: input.conv.organizationId,
        ownerId: input.conv.ownerId,
        metadata: { event: 'whatsapp_add_tenant_success', tenant_id: tenant.id },
      })
      return
    }

    clearConversation(input.sender)
    await input.sendText({ to: input.sender, text: 'Add Tenant cancelled.' })
  }
}

export async function processWhatsAppOwnerBotMessage(input: {
  sender: string
  text: string | null
  sendText: SendTextFn
}) {
  const incoming = normalizeIncomingText(input.text)
  if (!incoming) {
    return
  }

  const conv = getConversation(input.sender)
  const commandToken = normalizeCommandToken(incoming)
  if (commandToken === '/cancel') {
    if (conv) {
      clearConversation(input.sender)
      await input.sendText({ to: input.sender, text: 'Current operation cancelled.' })
    } else {
      await input.sendText({ to: input.sender, text: 'No active operation to cancel.' })
    }
    return
  }

  if (conv) {
    if (conv.flow === 'add_property') {
      await processAddPropertyConversation({ sender: input.sender, conv, text: incoming, sendText: input.sendText })
      return
    }
    if (conv.flow === 'add_tenant') {
      await processAddTenantConversation({ sender: input.sender, conv, text: incoming, sendText: input.sendText })
      return
    }
  }

  const owner = await resolveOwnerBySenderPhone(input.sender)
  if (!owner) {
    await input.sendText({
      to: input.sender,
      text: 'This number is not linked to any owner account. Add this WhatsApp number in your owner profile (support_whatsapp) and try again.',
      metadata: { event: 'whatsapp_owner_not_linked' },
    })
    return
  }

  if (commandToken === '/help' || commandToken === '/start') {
    await input.sendText({
      to: input.sender,
      text: helpText(),
      organizationId: owner.organization_id,
      ownerId: owner.id,
      metadata: { event: 'whatsapp_help' },
    })
    return
  }

  if (commandToken === '/ownerstats' || commandToken === '/stats') {
    await handleOwnerStats({ owner, sender: input.sender, sendText: input.sendText })
    return
  }

  const replyCommand = parseReplyCommand(incoming)
  if (replyCommand) {
    await handleReplyCommand({ owner, sender: input.sender, command: replyCommand, sendText: input.sendText })
    return
  }

  const reviewCommand = parseReviewCommand(incoming)
  if (reviewCommand) {
    await handleReviewCommand({ owner, sender: input.sender, command: reviewCommand, sendText: input.sendText })
    return
  }

  if (commandToken === '/addproperty') {
    await startAddProperty({ owner, sender: input.sender, sendText: input.sendText })
    return
  }

  if (commandToken === '/addtenant') {
    await startAddTenant({ owner, sender: input.sender, sendText: input.sendText })
    return
  }

  if (commandToken === '/disconnect' || commandToken === '/stop') {
    await disconnectOwnerWhatsAppLink({ owner, sender: input.sender, sendText: input.sendText })
    return
  }

  if (incoming.startsWith('/')) {
    await input.sendText({
      to: input.sender,
      text: `Unknown command: ${incoming}\n\n${helpText()}`,
      organizationId: owner.organization_id,
      ownerId: owner.id,
      metadata: { event: 'whatsapp_unknown_command' },
    })
  }
}
