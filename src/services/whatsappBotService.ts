import bcrypt from 'bcryptjs'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { notifyTenantTicketClosed, notifyTenantTicketReply, notifyTenantTicketStatusUpdated } from './notificationService.js'
import { createProperty, createTenant, getOwnerDashboardSummary } from './ownerService.js'
import { reviewOwnerRentPaymentApproval } from './rentPaymentService.js'
import { replyToTicketAsOwner, updateTicketStatusAsOwner } from './ticketThreadService.js'
import { getOwnerWhatsAppLinkBySender, markWhatsAppInboundSeen, upsertOwnerWhatsAppLink } from './whatsappLinkService.js'

type SendTextFn = (input: {
  to: string
  text: string
  organizationId?: string | null
  ownerId?: string | null
  metadata?: Record<string, unknown>
}) => Promise<void>

type SendActionFn = (input: {
  to: string
  body: string
  title?: string
  footer?: string
  actions: Array<{ id: string; label: string }>
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
  const link = await getOwnerWhatsAppLinkBySender(sender)
  if (link?.owner_id) {
    const { data, error } = await supabaseAdmin
      .from('owners')
      .select('id, organization_id, full_name, company_name, email, support_whatsapp')
      .eq('id', link.owner_id)
      .eq('organization_id', link.organization_id)
      .maybeSingle()

    if (error) {
      throw new AppError('Failed to resolve owner from WhatsApp link', 500, error.message)
    }
    return (data as OwnerIdentity | null) ?? null
  }

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

type TicketFilter = 'all' | 'open' | 'in_progress' | 'resolved' | 'closed'

function parseStatusCommand(text: string): { ticketId: string; status: 'open' | 'in_progress' | 'resolved' | 'closed' } | null {
  const matched = text.trim().match(/^\/status\s+([a-f0-9-]{36})\s+(open|in_progress|resolved|closed)$/i)
  if (!matched) {
    return null
  }
  return {
    ticketId: matched[1],
    status: matched[2].toLowerCase() as 'open' | 'in_progress' | 'resolved' | 'closed',
  }
}

function parseTicketsCommand(text: string): { filter: TicketFilter; page: number } {
  const parts = text.trim().split(/\s+/)
  let filter: TicketFilter = 'all'
  let page = 1

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase()
    if (['all', 'open', 'in_progress', 'resolved', 'closed'].includes(part)) {
      filter = part as TicketFilter
    } else if (/^\d+$/.test(part)) {
      page = Math.max(1, Number(part))
    }
  }

  return { filter, page }
}

function ticketFilterLabel(filter: TicketFilter) {
  switch (filter) {
    case 'all': return 'All'
    case 'open': return 'Open'
    case 'in_progress': return 'In Progress'
    case 'resolved': return 'Resolved'
    case 'closed': return 'Closed'
  }
}

const REJECTION_TEMPLATES: Record<string, string> = {
  proof: 'Payment proof is missing. Please upload valid proof and resubmit.',
  amount: 'Amount mismatch detected. Please review and resubmit the correct amount.',
  cycle: 'Payment was submitted for the wrong billing cycle. Please resubmit for the correct cycle.',
}

function helpText() {
  return [
    '🤖 Prophives WhatsApp Commands',
    '',
    '📊 View & Manage',
    '/ownerstats — Owner dashboard snapshot',
    '/tickets [all|open|in_progress|resolved|closed] [page] — List tickets',
    '/tenants — View recent tenants',
    '/properties — View properties with stats',
    '/approvals — Pending rent approvals',
    '/portfolio — Monthly portfolio snapshot',
    '/menu — Show main menu',
    '',
    '✏️ Actions',
    '/reply <ticket-id> <message> — Reply to tenant ticket',
    '/approve <approval-id> [message] — Approve rent',
    '/reject <approval-id> <reason|proof|amount|cycle> — Reject rent',
    '/status <ticket-id> <open|in_progress|resolved|closed> — Update ticket status',
    '',
    '➕ Create',
    '/addproperty — Add a new property',
    '/addtenant — Add a new tenant',
    '/cancel — Cancel current operation',
    '',
    '⚙️ Account',
    '/disconnect — Stop WhatsApp bot for this number',
  ].join('\n')
}

async function sendFlowActions(input: {
  owner: OwnerIdentity
  sender: string
  sendAction?: SendActionFn
  body: string
  actions: Array<{ id: string; label: string }>
  metadataEvent: string
  title?: string
}) {
  if (!input.sendAction || input.actions.length === 0) {
    return
  }

  await input.sendAction({
    to: input.sender,
    body: input.body,
    title: input.title,
    actions: input.actions.slice(0, 3),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: input.metadataEvent },
  })
}

async function sendCancelFlowAction(input: {
  owner: OwnerIdentity
  sender: string
  sendAction?: SendActionFn
  body?: string
  metadataEvent: string
}) {
  await sendFlowActions({
    owner: input.owner,
    sender: input.sender,
    sendAction: input.sendAction,
    body: input.body ?? 'You can continue typing or cancel this flow.',
    actions: [{ id: 'flow|cancel', label: 'Cancel' }],
    metadataEvent: input.metadataEvent,
  })
}

async function sendAddPropertyConfirmation(input: {
  owner: OwnerIdentity
  sender: string
  conv: AddPropertyConversation
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  await input.sendText({
    to: input.sender,
    text: [
      'Confirm property creation:',
      `Name: ${input.conv.data.property_name}`,
      `Address: ${input.conv.data.address}`,
      `Unit: ${input.conv.data.unit_number ?? '(none)'}`,
      'Reply YES to confirm, NO to cancel.',
    ].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
  })
  await sendFlowActions({
    owner: input.owner,
    sender: input.sender,
    sendAction: input.sendAction,
    body: 'Confirm or cancel this property creation.',
    actions: [
      { id: 'apc|yes', label: 'Confirm' },
      { id: 'apc|no', label: 'Cancel' },
    ],
    metadataEvent: 'whatsapp_add_property_confirm_actions',
  })
}

async function sendAddTenantPropertySelection(input: {
  owner: OwnerIdentity
  sender: string
  conv: AddTenantConversation
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const options = input.conv.data.property_options ?? []
  if (options.length <= 3 && input.sendAction) {
    await input.sendText({
      to: input.sender,
      text: 'Step 4/7: Pick a property below.',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
    })
    await sendFlowActions({
      owner: input.owner,
      sender: input.sender,
      sendAction: input.sendAction,
      body: 'Choose property for this tenant.',
      actions: options.map((option) => ({ id: `atp|${option.id}`, label: option.label.slice(0, 20) })),
      metadataEvent: 'whatsapp_add_tenant_property_actions',
    })
    return
  }

  await input.sendText({
    to: input.sender,
    text: ['Step 4/7: Pick property by number', ...options.map((option, index) => `${index + 1}. ${option.label}`)].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
  })
  await sendCancelFlowAction({
    owner: input.owner,
    sender: input.sender,
    sendAction: input.sendAction,
    metadataEvent: 'whatsapp_add_tenant_property_cancel',
  })
}

async function sendAddTenantConfirmation(input: {
  owner: OwnerIdentity
  sender: string
  conv: AddTenantConversation
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
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
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
  })
  await sendFlowActions({
    owner: input.owner,
    sender: input.sender,
    sendAction: input.sendAction,
    body: 'Confirm or cancel this tenant creation.',
    actions: [
      { id: 'atc|yes', label: 'Confirm' },
      { id: 'atc|no', label: 'Cancel' },
    ],
    metadataEvent: 'whatsapp_add_tenant_confirm_actions',
  })
}

async function finalizeAddProperty(input: {
  owner: OwnerIdentity
  sender: string
  conv: AddPropertyConversation
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
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
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function finalizeAddTenant(input: {
  owner: OwnerIdentity
  sender: string
  conv: AddTenantConversation
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
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
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function cancelActiveFlow(input: {
  owner: OwnerIdentity
  sender: string
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const conv = getConversation(input.sender)
  if (!conv) {
    await input.sendText({
      to: input.sender,
      text: 'No active operation to cancel.',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
    })
    return false
  }

  clearConversation(input.sender)
  const flowLabel = conv.flow === 'add_property' ? 'Add Property' : 'Add Tenant'
  await input.sendText({
    to: input.sender,
    text: `${flowLabel} cancelled.`,
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_flow_cancelled', flow: conv.flow },
  })
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
  return true
}

async function routeButtonCallback(
  text: string,
  ctx: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn },
) {
  const [scope, action, value] = text.trim().split('|')
  if (!scope || !action) {
    return false
  }

  if (scope === 'mn') {
    switch (action) {
      case 'menu':
      case 'refresh':
        await sendMenu(ctx)
        return true
      case 'stats':
        await handleOwnerStats(ctx)
        return true
      case 'tickets':
        await handleTicketsCommand({ ...ctx, filter: 'all', page: 1 })
        return true
      case 'tenants':
        await handleTenantsCommand(ctx)
        return true
      case 'properties':
        await handlePropertiesCommand(ctx)
        return true
      case 'approvals':
        await handleApprovalsCommand(ctx)
        return true
      case 'portfolio':
        await handlePortfolioCommand(ctx)
        return true
      case 'add_property':
        await startAddProperty(ctx)
        return true
      case 'add_tenant':
        await startAddTenant(ctx)
        return true
      case 'help':
        await ctx.sendText({
          to: ctx.sender,
          text: helpText(),
          organizationId: ctx.owner.organization_id,
          ownerId: ctx.owner.id,
          metadata: { event: 'whatsapp_help' },
        })
        await sendBackToMenu({ owner: ctx.owner, sender: ctx.sender, sendAction: ctx.sendAction })
        return true
      default:
        return false
    }
  }

  if (scope === 'tk') {
    const filter = action
    const page = Number(value ?? '1')
    if (!['all', 'open', 'in_progress', 'resolved', 'closed'].includes(filter) || !Number.isInteger(page) || page < 1) {
      return false
    }

    await handleTicketsCommand({ ...ctx, filter: filter as TicketFilter, page })
    return true
  }

  if (scope === 'ts') {
    const ticketId = action
    const status = value
    if (!ticketId || !status || !['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return false
    }

    await handleStatusCommand({
      ...ctx,
      command: {
        ticketId,
        status: status as 'open' | 'in_progress' | 'resolved' | 'closed',
      },
    })
    return true
  }

  if (scope === 'ra') {
    const approvalId = value
    if (!approvalId) {
      return false
    }

    if (action === 'approve') {
      await handleReviewCommand({
        ...ctx,
        command: { action: 'approve', approvalId, message: null },
      })
      return true
    }

    const rejectionTemplate =
      action === 'reject_proof'
        ? 'proof'
        : action === 'reject_amount'
          ? 'amount'
          : action === 'reject_cycle'
            ? 'cycle'
            : action === 'reject'
              ? null
              : null

    if (action === 'reject' || rejectionTemplate) {
      await handleReviewCommand({
        ...ctx,
        command: { action: 'reject', approvalId, message: rejectionTemplate },
      })
      return true
    }
  }

  if (scope === 'rr') {
    const approvalId = action
    const reasonCode = value
    if (!approvalId || !reasonCode || !['proof', 'amount', 'cycle'].includes(reasonCode)) {
      return false
    }

    await handleReviewCommand({
      ...ctx,
      command: { action: 'reject', approvalId, message: reasonCode },
    })
    return true
  }

  if (scope === 'rm') {
    const reviewAction = action
    const approvalId = value
    if (!approvalId || !['approve', 'reject'].includes(reviewAction)) {
      return false
    }

    await ctx.sendText({
      to: ctx.sender,
      text:
        reviewAction === 'approve'
          ? `Reply with:\n/approve ${approvalId} <your message>`
          : `Reply with:\n/reject ${approvalId} <reason>`,
      organizationId: ctx.owner.organization_id,
      ownerId: ctx.owner.id,
      metadata: { event: 'whatsapp_prompt_rent_message', approval_id: approvalId, action: reviewAction },
    })
    return true
  }

  if (scope === 'flow' && action === 'cancel') {
    await cancelActiveFlow(ctx)
    return true
  }

  if (scope === 'ap' && action === 'skip_unit') {
    const conv = getConversation(ctx.sender)
    if (!conv || conv.flow !== 'add_property' || conv.step !== 'unit_number') {
      return false
    }
    conv.data.unit_number = undefined
    conv.step = 'confirm'
    conv.updatedAt = nowMs()
    conversations.set(ctx.sender, conv)
    await sendAddPropertyConfirmation({ ...ctx, conv })
    return true
  }

  if (scope === 'apc' && (action === 'yes' || action === 'no')) {
    const conv = getConversation(ctx.sender)
    if (!conv || conv.flow !== 'add_property' || conv.step !== 'confirm') {
      return false
    }
    if (action === 'yes') {
      await finalizeAddProperty({ ...ctx, conv })
    } else {
      await cancelActiveFlow(ctx)
    }
    return true
  }

  if (scope === 'atp') {
    const conv = getConversation(ctx.sender)
    if (!conv || conv.flow !== 'add_tenant' || conv.step !== 'select_property') {
      return false
    }
    const selected = (conv.data.property_options ?? []).find((option) => option.id === action)
    if (!selected) {
      return false
    }
    conv.data.property_id = selected.id
    conv.data.property_name = selected.label
    conv.step = 'password'
    conv.updatedAt = nowMs()
    conversations.set(ctx.sender, conv)
    await ctx.sendText({
      to: ctx.sender,
      text: `Property selected: ${selected.label}\nStep 5/7: Enter tenant password (min 8 chars).`,
      organizationId: ctx.owner.organization_id,
      ownerId: ctx.owner.id,
      metadata: { event: 'whatsapp_add_tenant_property_selected' },
    })
    await sendCancelFlowAction({
      owner: ctx.owner,
      sender: ctx.sender,
      sendAction: ctx.sendAction,
      metadataEvent: 'whatsapp_add_tenant_password_cancel',
    })
    return true
  }

  if (scope === 'atc' && (action === 'yes' || action === 'no')) {
    const conv = getConversation(ctx.sender)
    if (!conv || conv.flow !== 'add_tenant' || conv.step !== 'confirm') {
      return false
    }
    if (action === 'yes') {
      await finalizeAddTenant({ ...ctx, conv })
    } else {
      await cancelActiveFlow(ctx)
    }
    return true
  }

  return false
}

async function handleOwnerStats(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  const summary = await getOwnerDashboardSummary(input.owner.organization_id, input.owner.id)
  await input.sendText({
    to: input.sender,
    text: [
      '📊 Owner Quick Stats',
      `👥 Active tenants: ${summary.active_tenants}`,
      `🎫 Open tickets: ${summary.open_tickets}`,
      `⏰ Overdue rent: ${summary.overdue_rent}`,
      `🔔 Pending reminders: ${summary.reminders_pending}`,
      `📬 Unread notifications: ${summary.unread_notifications}`,
      `💸 Awaiting approvals: ${summary.awaiting_approvals}`,
    ].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_owner_stats' },
  })
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function handleReplyCommand(input: {
  owner: OwnerIdentity
  sender: string
  command: { ticketId: string; message: string }
  sendText: SendTextFn
  sendAction?: SendActionFn
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
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function handleReviewCommand(input: {
  owner: OwnerIdentity
  sender: string
  command: { action: 'approve' | 'reject'; approvalId: string; message: string | null }
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const message = input.command.message
  const resolvedReason =
    input.command.action === 'reject' && message
      ? REJECTION_TEMPLATES[message.toLowerCase().trim()] ?? message
      : input.command.message ?? undefined

  await reviewOwnerRentPaymentApproval({
    approvalId: input.command.approvalId,
    ownerId: input.owner.id,
    organizationId: input.owner.organization_id,
    action: input.command.action,
    rejectionReason: input.command.action === 'reject' ? resolvedReason : undefined,
    ownerMessage: resolvedReason ?? undefined,
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
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function handleTicketsCommand(input: {
  owner: OwnerIdentity
  sender: string
  filter: TicketFilter
  page: number
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const pageSize = 5
  const safePage = Math.max(1, Math.min(input.page, 99))
  const from = (safePage - 1) * pageSize
  const to = from + pageSize - 1

  let listQuery = supabaseAdmin
    .from('support_tickets')
    .select('id, subject, status, created_at, tenants(full_name, tenant_access_id)')
    .eq('organization_id', input.owner.organization_id)
    .eq('owner_id', input.owner.id)
    .order('created_at', { ascending: false })
    .range(from, to)
  let countQuery = supabaseAdmin
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.owner.organization_id)
    .eq('owner_id', input.owner.id)

  if (input.filter !== 'all') {
    listQuery = listQuery.eq('status', input.filter)
    countQuery = countQuery.eq('status', input.filter)
  }

  const [{ data, error }, { count, error: countError }] = await Promise.all([listQuery, countQuery])
  if (error || countError) {
    throw new AppError('Failed to load tickets', 500)
  }

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(safePage, totalPages)
  const rows = (data ?? []).map((row) => {
    const tenant = (row.tenants as { full_name?: string | null; tenant_access_id?: string | null } | null) ?? null
    const statusIcon = row.status === 'closed' ? '✅' : row.status === 'resolved' ? '🟢' : row.status === 'in_progress' ? '🟡' : '🟠'
    return `${statusIcon} #${String(row.id).slice(0, 8)} ${row.subject} (${tenant?.full_name ?? tenant?.tenant_access_id ?? 'Tenant'})`
  })

  const text =
    rows.length > 0
      ? [`🎫 Tickets • ${ticketFilterLabel(input.filter)} • Page ${currentPage}/${totalPages}`, ...rows].join('\n')
      : `✅ No ${ticketFilterLabel(input.filter).toLowerCase()} tickets.`

  await input.sendText({
    to: input.sender,
    text,
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_tickets_list', filter: input.filter, page: currentPage, total },
  })

  if (input.sendAction) {
    const filterActions: Array<{ id: string; label: string }> = []
    if (input.filter !== 'open') filterActions.push({ id: 'tk|open|1', label: '🟠 Open' })
    if (input.filter !== 'in_progress') filterActions.push({ id: 'tk|in_progress|1', label: '🟡 In Progress' })
    if (input.filter !== 'closed') filterActions.push({ id: 'tk|closed|1', label: '✅ Closed' })
    if (filterActions.length > 3) filterActions.length = 3

    await input.sendAction({
      to: input.sender,
      body: 'Filter tickets or navigate pages.',
      actions: filterActions,
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_tickets_filter_buttons' },
    })

    if (totalPages > 1) {
      const navActions: Array<{ id: string; label: string }> = []
      if (currentPage > 1) navActions.push({ id: `tk|${input.filter}|${currentPage - 1}`, label: '◀ Previous' })
      if (currentPage < totalPages) navActions.push({ id: `tk|${input.filter}|${currentPage + 1}`, label: 'Next ▶' })
      navActions.push({ id: 'mn|menu', label: '📋 Menu' })

      await input.sendAction({
        to: input.sender,
        body: `Page ${currentPage} of ${totalPages}`,
        actions: navActions,
        organizationId: input.owner.organization_id,
        ownerId: input.owner.id,
        metadata: { event: 'whatsapp_tickets_nav_buttons' },
      })
    }
  }
}

async function handleTenantsCommand(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, full_name, tenant_access_id, status, payment_status, lease_end_date, monthly_rent')
    .eq('organization_id', input.owner.organization_id)
    .eq('owner_id', input.owner.id)
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    throw new AppError('Failed to load tenants', 500)
  }

  const lines = (data ?? []).map((row) => {
    const leaseEnd = row.lease_end_date ? String(row.lease_end_date).slice(0, 10) : '-'
    return `• ${row.full_name} (${row.tenant_access_id}) | ${row.status} | rent: ${row.payment_status} | lease: ${leaseEnd} | amount: ${row.monthly_rent}`
  })

  await input.sendText({
    to: input.sender,
    text: lines.length > 0 ? ['👥 Tenants (latest 8)', ...lines].join('\n') : 'ℹ️ No tenants found.',
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_tenants_list' },
  })
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function handlePropertiesCommand(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  const { data: properties, error } = await supabaseAdmin
    .from('properties')
    .select('id, property_name, unit_number')
    .eq('organization_id', input.owner.organization_id)
    .eq('owner_id', input.owner.id)
    .order('created_at', { ascending: false })
    .limit(6)

  if (error) {
    throw new AppError('Failed to load properties', 500)
  }

  if (!properties || properties.length === 0) {
    await input.sendText({
      to: input.sender,
      text: 'ℹ️ No properties found. Use /addproperty to create one.',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_properties_empty' },
    })
    return
  }

  const lines: string[] = []
  for (const property of properties) {
    const [{ count: tenantCount }] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id)
        .eq('property_id', property.id)
        .eq('status', 'active'),
    ])
    const { data: tenantRows } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('organization_id', input.owner.organization_id)
      .eq('owner_id', input.owner.id)
      .eq('property_id', property.id)
      .eq('status', 'active')
    const tenantIds = (tenantRows ?? []).map((t) => t.id as string)
    let openTicketCount = 0
    if (tenantIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id)
        .in('status', ['open', 'in_progress'])
        .in('tenant_id', tenantIds)
      openTicketCount = count ?? 0
    }

    lines.push(
      `• ${property.property_name}${property.unit_number ? ` (${property.unit_number})` : ''} | tenants: ${tenantCount ?? 0} | open tickets: ${openTicketCount}`,
    )
  }

  await input.sendText({
    to: input.sender,
    text: ['🏠 Property Snapshot', ...lines].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_properties_list' },
  })
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function handleApprovalsCommand(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select('id, due_date, amount_paid, tenants(full_name, tenant_access_id)')
    .eq('organization_id', input.owner.organization_id)
    .eq('owner_id', input.owner.id)
    .eq('status', 'awaiting_owner_approval')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    throw new AppError('Failed to load pending approvals', 500)
  }

  const lines = (data ?? []).map((row) => {
    const tenant = (row.tenants as { full_name?: string | null; tenant_access_id?: string | null } | null) ?? null
    return `• ${tenant?.full_name ?? tenant?.tenant_access_id ?? 'Tenant'} | ${row.amount_paid} | due ${row.due_date}\n  ID: ${row.id}`
  })

  if ((data ?? []).length === 0) {
    await input.sendText({
      to: input.sender,
      text: '✅ No pending rent approvals right now.',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_approvals_list' },
    })
    await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
    return
  }

  await input.sendText({
    to: input.sender,
    text: ['💸 Pending Rent Approvals', ...lines].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_approvals_list' },
  })

  if (input.sendAction) {
    for (const row of data ?? []) {
      const tenant = (row.tenants as { full_name?: string | null; tenant_access_id?: string | null } | null) ?? null
      const tenantLabel = tenant?.full_name ?? tenant?.tenant_access_id ?? 'Tenant'
      await input.sendAction({
        to: input.sender,
        body: `${tenantLabel} — ${row.amount_paid} due ${row.due_date}`,
        title: `#${String(row.id).slice(0, 8)}`,
        actions: [
          { id: `ra|approve|${row.id}`, label: '✅ Approve' },
          { id: `ra|reject_proof|${row.id}`, label: '❌ Proof Missing' },
          { id: `ra|reject_amount|${row.id}`, label: '❌ Amount Wrong' },
        ],
        organizationId: input.owner.organization_id,
        ownerId: input.owner.id,
        metadata: { event: 'whatsapp_approval_actions', approval_id: row.id },
      })
    }
  }
}

async function handlePortfolioCommand(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  const now = new Date()
  const cycleYear = now.getUTCFullYear()
  const cycleMonth = now.getUTCMonth() + 1

  const [propertiesResult, activeTenantsResult, openTicketsResult, overdueTenantsResult, approvedRentResult, pendingApprovalsResult] =
    await Promise.all([
      supabaseAdmin
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id),
      supabaseAdmin
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id)
        .eq('status', 'active'),
      supabaseAdmin
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id)
        .in('status', ['open', 'in_progress']),
      supabaseAdmin
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id)
        .eq('payment_status', 'overdue'),
      supabaseAdmin
        .from('rent_payment_approvals')
        .select('amount_paid')
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id)
        .eq('cycle_year', cycleYear)
        .eq('cycle_month', cycleMonth)
        .eq('status', 'approved'),
      supabaseAdmin
        .from('rent_payment_approvals')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.owner.organization_id)
        .eq('owner_id', input.owner.id)
        .eq('status', 'awaiting_owner_approval'),
    ])

  const approvedAmount = (approvedRentResult.data ?? []).reduce((sum, row) => sum + Number(row.amount_paid ?? 0), 0)

  await input.sendText({
    to: input.sender,
    text: [
      '📈 Portfolio Snapshot',
      `🏠 Properties: ${propertiesResult.count ?? 0}`,
      `👥 Active tenants: ${activeTenantsResult.count ?? 0}`,
      `🎫 Open tickets: ${openTicketsResult.count ?? 0}`,
      `⏰ Overdue rent tenants: ${overdueTenantsResult.count ?? 0}`,
      `💸 Pending approvals: ${pendingApprovalsResult.count ?? 0}`,
      `💰 Approved rent this cycle: ${approvedAmount}`,
    ].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_portfolio', cycle_year: cycleYear, cycle_month: cycleMonth },
  })
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function handleStatusCommand(input: {
  owner: OwnerIdentity
  sender: string
  command: { ticketId: string; status: 'open' | 'in_progress' | 'resolved' | 'closed' }
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const ticket = await updateTicketStatusAsOwner({
    ticketId: input.command.ticketId,
    ownerId: input.owner.id,
    organizationId: input.owner.organization_id,
    status: input.command.status,
  })

  if (!ticket) {
    await input.sendText({
      to: input.sender,
      text: 'Ticket not found or does not belong to your account.',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
    })
    return
  }

  const tenant = ticket.tenants as
    | { full_name?: string | null; email?: string | null }
    | null
  const owner = ticket.owners as
    | { full_name?: string | null; company_name?: string | null; email?: string | null }
    | null
  const senderName = owner?.full_name?.trim() || owner?.company_name?.trim() || owner?.email?.trim() || 'Owner'

  if (input.command.status === 'closed') {
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
      status: input.command.status,
    })
  }

  const statusLabel = input.command.status.replaceAll('_', ' ')
  await input.sendText({
    to: input.sender,
    text: `Ticket #${input.command.ticketId.slice(0, 8)} moved to ${statusLabel}.`,
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_ticket_status_update', ticket_id: input.command.ticketId, status: input.command.status },
  })
  await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
}

async function sendMenu(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  if (input.sendAction) {
    await input.sendAction({
      to: input.sender,
      body: '📊 View your dashboard, tickets, tenants, properties, and more.',
      title: '📋 Main Menu',
      actions: [
        { id: 'mn|stats', label: '📊 Dashboard Stats' },
        { id: 'mn|tickets', label: '🎫 Tickets' },
        { id: 'mn|tenants', label: '👥 Tenants' },
      ],
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_menu_1' },
    })
    await input.sendAction({
      to: input.sender,
      body: '🏠 Properties, approvals, and portfolio.',
      actions: [
        { id: 'mn|properties', label: '🏠 Properties' },
        { id: 'mn|approvals', label: '💸 Approvals' },
        { id: 'mn|portfolio', label: '📈 Portfolio' },
      ],
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_menu_2' },
    })
    await input.sendAction({
      to: input.sender,
      body: '➕ Add properties or tenants, or get help.',
      actions: [
        { id: 'mn|add_property', label: '➕ Add Property' },
        { id: 'mn|add_tenant', label: '➕ Add Tenant' },
        { id: 'mn|help', label: '❓ Help' },
      ],
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_menu_3' },
    })
  } else {
    await input.sendText({
      to: input.sender,
      text: [
        '📋 Prophives Main Menu',
        '',
        '📊 /ownerstats — Dashboard stats',
        '🎫 /tickets — Browse tickets',
        '👥 /tenants — View tenants',
        '🏠 /properties — Property snapshot',
        '💸 /approvals — Rent approvals',
        '📈 /portfolio — Portfolio summary',
        '',
        '➕ /addproperty — Add property',
        '➕ /addtenant — Add tenant',
        '❓ /help — Full command list',
      ].join('\n'),
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_menu' },
    })
  }
}

async function sendBackToMenu(input: { owner: OwnerIdentity; sender: string; sendAction?: SendActionFn }) {
  if (input.sendAction) {
    await input.sendAction({
      to: input.sender,
      body: 'What would you like to do next?',
      actions: [
        { id: 'mn|menu', label: '📋 Main Menu' },
        { id: 'mn|stats', label: '📊 Stats' },
        { id: 'mn|tickets', label: '🎫 Tickets' },
      ],
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_back_menu' },
    })
  }
}

async function startAddProperty(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
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
  await sendCancelFlowAction({
    owner: input.owner,
    sender: input.sender,
    sendAction: input.sendAction,
    metadataEvent: 'whatsapp_add_property_cancel',
  })
}

async function startAddTenant(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
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
  await sendCancelFlowAction({
    owner: input.owner,
    sender: input.sender,
    sendAction: input.sendAction,
    metadataEvent: 'whatsapp_add_tenant_cancel',
  })
}

async function disconnectOwnerWhatsAppLink(input: {
  owner: OwnerIdentity
  sender: string
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const { error } = await supabaseAdmin
    .from('owners')
    .update({ support_whatsapp: null, updated_at: new Date().toISOString() })
    .eq('id', input.owner.id)
    .eq('organization_id', input.owner.organization_id)
    .eq('support_whatsapp', input.owner.support_whatsapp ?? '')

  if (error) {
    throw new AppError('Failed to disconnect WhatsApp number', 500, error.message)
  }

  await upsertOwnerWhatsAppLink({
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    phoneNumber: null,
    linkedVia: 'disconnect',
    isActive: false,
  })

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
  sendAction?: SendActionFn
}) {
  const owner: OwnerIdentity = {
    id: input.conv.ownerId,
    organization_id: input.conv.organizationId,
    full_name: null,
    company_name: null,
    email: '',
    support_whatsapp: null,
  }
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
    await sendCancelFlowAction({ owner, sender: input.sender, sendAction: input.sendAction, metadataEvent: 'whatsapp_add_property_cancel' })
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
    await sendFlowActions({
      owner,
      sender: input.sender,
      sendAction: input.sendAction,
      body: 'Skip the unit number or cancel this property.',
      actions: [
        { id: 'ap|skip_unit', label: 'Skip Unit' },
        { id: 'flow|cancel', label: 'Cancel' },
      ],
      metadataEvent: 'whatsapp_add_property_unit_actions',
    })
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
    await sendAddPropertyConfirmation({ owner, sender: input.sender, conv: input.conv, sendText: input.sendText, sendAction: input.sendAction })
    return
  }

  if (input.conv.step === 'confirm') {
    if (value.toLowerCase() === 'yes') {
      await finalizeAddProperty({ owner, sender: input.sender, conv: input.conv, sendText: input.sendText, sendAction: input.sendAction })
      return
    }

    await cancelActiveFlow({ owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction })
  }
}

async function processAddTenantConversation(input: {
  sender: string
  conv: AddTenantConversation
  text: string
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const owner: OwnerIdentity = {
    id: input.conv.ownerId,
    organization_id: input.conv.organizationId,
    full_name: null,
    company_name: null,
    email: '',
    support_whatsapp: null,
  }
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
    await sendCancelFlowAction({ owner, sender: input.sender, sendAction: input.sendAction, metadataEvent: 'whatsapp_add_tenant_cancel' })
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
    await sendCancelFlowAction({ owner, sender: input.sender, sendAction: input.sendAction, metadataEvent: 'whatsapp_add_tenant_cancel' })
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
    await sendAddTenantPropertySelection({ owner, sender: input.sender, conv: input.conv, sendText: input.sendText, sendAction: input.sendAction })
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
    await sendCancelFlowAction({ owner, sender: input.sender, sendAction: input.sendAction, metadataEvent: 'whatsapp_add_tenant_password_cancel' })
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
    await sendCancelFlowAction({ owner, sender: input.sender, sendAction: input.sendAction, metadataEvent: 'whatsapp_add_tenant_rent_cancel' })
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
    await sendCancelFlowAction({ owner, sender: input.sender, sendAction: input.sendAction, metadataEvent: 'whatsapp_add_tenant_due_day_cancel' })
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
    await sendAddTenantConfirmation({ owner, sender: input.sender, conv: input.conv, sendText: input.sendText, sendAction: input.sendAction })
    return
  }

  if (input.conv.step === 'confirm') {
    if (lc === 'yes') {
      await finalizeAddTenant({ owner, sender: input.sender, conv: input.conv, sendText: input.sendText, sendAction: input.sendAction })
      return
    }

    await cancelActiveFlow({ owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction })
  }
}

export async function processWhatsAppOwnerBotMessage(input: {
  sender: string
  text: string | null
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const incoming = normalizeIncomingText(input.text)
  if (!incoming) {
    return
  }

  const conv = getConversation(input.sender)
  const commandToken = normalizeCommandToken(incoming)
  if (commandToken === '/cancel') {
    const owner = await resolveOwnerBySenderPhone(input.sender)
    if (!owner) {
      await input.sendText({ to: input.sender, text: conv ? 'Current operation cancelled.' : 'No active operation to cancel.' })
      if (conv) {
        clearConversation(input.sender)
      }
      return
    }

    await cancelActiveFlow({ owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction })
    return
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

  await markWhatsAppInboundSeen({
    organizationId: owner.organization_id,
    userRole: 'owner',
    ownerId: owner.id,
    senderPhone: input.sender,
  })

  const ctx = { owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction }

  // ── Button callback routing (from interactive button taps) ──
  const buttonHandled = await routeButtonCallback(incoming, ctx)
  if (buttonHandled) return

  if (conv) {
    if (conv.flow === 'add_property') {
      await processAddPropertyConversation({ sender: input.sender, conv, text: incoming, sendText: input.sendText, sendAction: input.sendAction })
      return
    }
    if (conv.flow === 'add_tenant') {
      await processAddTenantConversation({ sender: input.sender, conv, text: incoming, sendText: input.sendText, sendAction: input.sendAction })
      return
    }
  }

  // ── Slash command routing (typed commands) ──
  if (commandToken === '/help') {
    await input.sendText({
      to: input.sender,
      text: helpText(),
      organizationId: owner.organization_id,
      ownerId: owner.id,
      metadata: { event: 'whatsapp_help' },
    })
    return
  }

  if (commandToken === '/start' || commandToken === '/menu') {
    await sendMenu(ctx)
    return
  }

  if (commandToken === '/ownerstats' || commandToken === '/stats') {
    await handleOwnerStats(ctx)
    return
  }

  if (commandToken === '/tickets') {
    const { filter, page } = parseTicketsCommand(incoming)
    await handleTicketsCommand({ ...ctx, filter, page })
    return
  }

  if (commandToken === '/tenants') {
    await handleTenantsCommand(ctx)
    return
  }

  if (commandToken === '/properties') {
    await handlePropertiesCommand(ctx)
    return
  }

  if (commandToken === '/approvals') {
    await handleApprovalsCommand(ctx)
    return
  }

  if (commandToken === '/portfolio') {
    await handlePortfolioCommand(ctx)
    return
  }

  const statusCommand = parseStatusCommand(incoming)
  if (statusCommand) {
    await handleStatusCommand({ ...ctx, command: statusCommand })
    return
  }

  const replyCommand = parseReplyCommand(incoming)
  if (replyCommand) {
    await handleReplyCommand({ ...ctx, command: replyCommand })
    return
  }

  const reviewCommand = parseReviewCommand(incoming)
  if (reviewCommand) {
    await handleReviewCommand({ ...ctx, command: reviewCommand })
    return
  }

  if (commandToken === '/addproperty') {
    await startAddProperty(ctx)
    return
  }

  if (commandToken === '/addtenant') {
    await startAddTenant(ctx)
    return
  }

  if (commandToken === '/disconnect' || commandToken === '/stop') {
    await disconnectOwnerWhatsAppLink(ctx)
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
