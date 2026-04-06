import bcrypt from 'bcryptjs'

import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
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

type TicketReplyConversation = {
  flow: 'ticket_reply'
  ownerId: string
  organizationId: string
  step: 'select_ticket' | 'enter_reply'
  data: {
    tickets: Array<{ id: string; subject: string; tenantName: string; currentStatus: string }>
    selectedTicketId?: string
    selectedSubject?: string
  }
  updatedAt: number
}

type TicketStatusConversation = {
  flow: 'ticket_status'
  ownerId: string
  organizationId: string
  step: 'select_ticket' | 'select_status'
  data: {
    tickets: Array<{ id: string; subject: string; tenantName: string; currentStatus: string }>
    selectedTicketId?: string
  }
  updatedAt: number
}

type ApprovalsConversation = {
  flow: 'approvals_review'
  ownerId: string
  organizationId: string
  step: 'select_approval' | 'select_action' | 'select_rejection'
  data: {
    approvals: Array<{ id: string; tenantName: string; amount: string; dueDate: string }>
    selectedApprovalId?: string
  }
  updatedAt: number
}

type ConversationState = AddPropertyConversation | AddTenantConversation | TicketReplyConversation | TicketStatusConversation | ApprovalsConversation

const CONVERSATION_TTL_MS = 10 * 60 * 1000
const conversations = new Map<string, ConversationState>()

// Pending menu: maps numbered user replies to action IDs (e.g. 1 → 'mn|stats')
// Cleared when a new flow starts or a number is consumed.
const pendingMenus = new Map<string, Array<{ actionId: string; label: string }>>()

function setPendingMenu(sender: string, options: Array<{ actionId: string; label: string }>) {
  pendingMenus.set(sender, options.slice(0, 9))
}

function getPendingMenu(sender: string) {
  return pendingMenus.get(sender) ?? null
}

function clearPendingMenu(sender: string) {
  pendingMenus.delete(sender)
}

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
    const data = await prisma.owners.findFirst({
      select: { id: true, organization_id: true, full_name: true, company_name: true, email: true, support_whatsapp: true },
      where: { id: link.owner_id, organization_id: link.organization_id },
    })
    return (data as OwnerIdentity | null) ?? null
  }

  const rows = await prisma.owners.findMany({
    select: { id: true, organization_id: true, full_name: true, company_name: true, email: true, support_whatsapp: true },
    where: { support_whatsapp: { not: null } },
  })
  return (rows as OwnerIdentity[]).find((row) => (row.support_whatsapp ? phoneMatch(row.support_whatsapp, sender) : false)) ?? null
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
    '🤖 Prophives — Quick Reference',
    '',
    'Just type any keyword:',
    '',
    '📊 *stats* — Dashboard overview',
    '🎫 *tickets* — View & manage tickets',
    '👥 *tenants* — List tenants',
    '🏠 *properties* — Property snapshot',
    '✅ *approvals* — Review rent payments',
    '📋 *menu* — Full menu',
    '',
    'Type *menu* anytime to get started.',
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

  const sliced = input.actions.slice(0, 3)
  await input.sendAction({
    to: input.sender,
    body: input.body,
    title: input.title,
    actions: sliced,
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: input.metadataEvent },
  })
  setPendingMenu(input.sender, sliced.map((a) => ({ actionId: a.id, label: a.label })))
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

  const ticketWhere: Record<string, unknown> = { organization_id: input.owner.organization_id, owner_id: input.owner.id }
  if (input.filter !== 'all') {
    ticketWhere.status = input.filter
  }

  const [ticketRows, total] = await Promise.all([
    prisma.support_tickets.findMany({
      select: { id: true, subject: true, status: true, created_at: true, tenants: { select: { full_name: true, tenant_access_id: true } } },
      where: ticketWhere,
      orderBy: { created_at: 'desc' },
      skip: from,
      take: pageSize,
    }),
    prisma.support_tickets.count({ where: ticketWhere }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(safePage, totalPages)

  const rawTickets = ticketRows.map((row) => {
    const tenant = (row.tenants as { full_name?: string | null; tenant_access_id?: string | null } | null) ?? null
    return {
      id: String(row.id),
      subject: String(row.subject),
      currentStatus: String(row.status),
      tenantName: tenant?.full_name ?? tenant?.tenant_access_id ?? 'Tenant',
    }
  })

  const rows = rawTickets.map((t) => {
    const statusIcon = t.currentStatus === 'closed' ? '✅' : t.currentStatus === 'resolved' ? '🟢' : t.currentStatus === 'in_progress' ? '🟡' : '🟠'
    return `${statusIcon} ${t.subject} (${t.tenantName})`
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

  // Quick actions after ticket list — stored as pending menu so numbers work
  if (rawTickets.length > 0) {
    const quickOptions = [
      { actionId: 'flow|ticket_reply', label: '✏️ Reply to a ticket' },
      { actionId: 'flow|ticket_status', label: '🔄 Update ticket status' },
      { actionId: 'mn|menu', label: '📋 Main Menu' },
    ]

    await input.sendText({
      to: input.sender,
      text: ['', ...quickOptions.map((o, i) => `${i + 1}. ${o.label}`)].join('\n'),
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_ticket_quick_actions' },
    })

    // Store tickets in conversation so reply/status flows can reference them
    setConversation(input.sender, {
      flow: 'ticket_reply',
      ownerId: input.owner.id,
      organizationId: input.owner.organization_id,
      step: 'select_ticket',
      data: { tickets: rawTickets },
    })
    clearPendingMenu(input.sender)
    setPendingMenu(input.sender, quickOptions)
  } else {
    await sendBackToMenu({ owner: input.owner, sender: input.sender, sendAction: input.sendAction })
  }
}

async function handleTenantsCommand(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  const tenants = await prisma.tenants.findMany({
    select: { id: true, full_name: true, tenant_access_id: true, status: true, payment_status: true, lease_end_date: true, monthly_rent: true },
    where: { organization_id: input.owner.organization_id, owner_id: input.owner.id },
    orderBy: { created_at: 'desc' },
    take: 8,
  })

  const lines = tenants.map((row) => {
    const leaseEnd = row.lease_end_date ? row.lease_end_date.toISOString().slice(0, 10) : '-'
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
  const properties = await prisma.properties.findMany({
    select: { id: true, property_name: true, unit_number: true },
    where: { organization_id: input.owner.organization_id, owner_id: input.owner.id },
    orderBy: { created_at: 'desc' },
    take: 6,
  })

  if (!properties || properties.length === 0) {
    await input.sendText({
      to: input.sender,
      text: 'ℹ️ No properties found. Type *add property* to create one.',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_properties_empty' },
    })
    return
  }

  const lines: string[] = []
  for (const property of properties) {
    const tenantWhere = { organization_id: input.owner.organization_id, owner_id: input.owner.id, property_id: property.id, status: 'active' }
    const [tenantCount, tenantRows] = await Promise.all([
      prisma.tenants.count({ where: tenantWhere }),
      prisma.tenants.findMany({ select: { id: true }, where: tenantWhere }),
    ])
    const tenantIds = tenantRows.map((t) => t.id)
    let openTicketCount = 0
    if (tenantIds.length > 0) {
      openTicketCount = await prisma.support_tickets.count({
        where: { organization_id: input.owner.organization_id, owner_id: input.owner.id, status: { in: ['open', 'in_progress'] }, tenant_id: { in: tenantIds } },
      })
    }

    lines.push(
      `• ${property.property_name}${property.unit_number ? ` (${property.unit_number})` : ''} | tenants: ${tenantCount} | open tickets: ${openTicketCount}`,
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
  const rows = await prisma.rent_payment_approvals.findMany({
    select: { id: true, due_date: true, amount_paid: true, tenants: { select: { full_name: true, tenant_access_id: true } } },
    where: { organization_id: input.owner.organization_id, owner_id: input.owner.id, status: 'awaiting_owner_approval' },
    orderBy: { created_at: 'desc' },
    take: 8,
  })

  if (rows.length === 0) {
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

  const approvals = rows.map((row) => {
    const tenant = (row.tenants as { full_name?: string | null; tenant_access_id?: string | null } | null) ?? null
    return {
      id: row.id as string,
      tenantName: tenant?.full_name ?? tenant?.tenant_access_id ?? 'Tenant',
      amount: String(Number(row.amount_paid ?? 0)),
      dueDate: row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date),
    }
  })

  const lines = approvals.map((a, i) => `${i + 1}. ${a.tenantName} — ${a.amount} (due ${a.dueDate})`)

  await input.sendText({
    to: input.sender,
    text: ['💸 Pending Rent Approvals', '', ...lines, '', 'Reply with a number to review an approval.'].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_approvals_list' },
  })

  setConversation(input.sender, {
    flow: 'approvals_review',
    ownerId: input.owner.id,
    organizationId: input.owner.organization_id,
    step: 'select_approval',
    data: { approvals },
  })
  clearPendingMenu(input.sender)
}

async function handlePortfolioCommand(input: { owner: OwnerIdentity; sender: string; sendText: SendTextFn; sendAction?: SendActionFn }) {
  const now = new Date()
  const cycleYear = now.getUTCFullYear()
  const cycleMonth = now.getUTCMonth() + 1

  const orgWhere = { organization_id: input.owner.organization_id, owner_id: input.owner.id }
  const [propertiesCount, activeTenantsCount, openTicketsCount, overdueTenantsCount, approvedRentRows, pendingApprovalsCount] =
    await Promise.all([
      prisma.properties.count({ where: orgWhere }),
      prisma.tenants.count({ where: { ...orgWhere, status: 'active' } }),
      prisma.support_tickets.count({ where: { ...orgWhere, status: { in: ['open', 'in_progress'] } } }),
      prisma.tenants.count({ where: { ...orgWhere, payment_status: 'overdue' } }),
      prisma.rent_payment_approvals.findMany({
        select: { amount_paid: true },
        where: { ...orgWhere, cycle_year: cycleYear, cycle_month: cycleMonth, status: 'approved' },
      }),
      prisma.rent_payment_approvals.count({ where: { ...orgWhere, status: 'awaiting_owner_approval' } }),
    ])

  const approvedAmount = approvedRentRows.reduce((sum, row) => sum + Number(row.amount_paid ?? 0), 0)

  await input.sendText({
    to: input.sender,
    text: [
      '📈 Portfolio Snapshot',
      `🏠 Properties: ${propertiesCount}`,
      `👥 Active tenants: ${activeTenantsCount}`,
      `🎫 Open tickets: ${openTicketsCount}`,
      `⏰ Overdue rent tenants: ${overdueTenantsCount}`,
      `💸 Pending approvals: ${pendingApprovalsCount}`,
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
  const menuOptions = [
    { actionId: 'mn|stats', label: '📊 Dashboard Stats' },
    { actionId: 'mn|tickets', label: '🎫 Tickets' },
    { actionId: 'mn|tenants', label: '👥 Tenants' },
    { actionId: 'mn|properties', label: '🏠 Properties' },
    { actionId: 'mn|approvals', label: '💸 Rent Approvals' },
    { actionId: 'mn|portfolio', label: '📈 Portfolio' },
    { actionId: 'mn|add_property', label: '➕ Add Property' },
    { actionId: 'mn|add_tenant', label: '➕ Add Tenant' },
  ]

  await input.sendText({
    to: input.sender,
    text: [
      '📋 *Prophives Menu*',
      '',
      ...menuOptions.map((opt, i) => `${i + 1}. ${opt.label}`),
      '',
      'Reply with a number to navigate.',
    ].join('\n'),
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    metadata: { event: 'whatsapp_menu' },
  })

  setPendingMenu(input.sender, menuOptions)
}

async function sendBackToMenu(input: { owner: OwnerIdentity; sender: string; sendText?: SendTextFn; sendAction?: SendActionFn }) {
  const quickOptions = [
    { actionId: 'mn|menu', label: '📋 Main Menu' },
    { actionId: 'mn|stats', label: '📊 Stats' },
    { actionId: 'mn|tickets', label: '🎫 Tickets' },
  ]

  if (input.sendAction) {
    await input.sendAction({
      to: input.sender,
      body: 'What would you like to do next?',
      actions: quickOptions.map((o) => ({ id: o.actionId, label: o.label })),
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_back_menu' },
    })
  } else if (input.sendText) {
    await input.sendText({
      to: input.sender,
      text: 'What next?\n1. Main Menu\n2. Stats\n3. Tickets\n\n(Or type anything to see the full menu)',
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
      metadata: { event: 'whatsapp_back_menu' },
    })
  }

  setPendingMenu(input.sender, quickOptions)
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
  const properties = await prisma.properties.findMany({
    select: { id: true, property_name: true, unit_number: true },
    where: { organization_id: input.owner.organization_id, owner_id: input.owner.id },
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  const options = properties.map((property) => ({
    id: property.id as string,
    label: `${property.property_name}${property.unit_number ? ` (${property.unit_number})` : ''}`,
  }))

  if (options.length === 0) {
    await input.sendText({
      to: input.sender,
      text: 'You need at least one property before adding a tenant. Type *add property* first.',
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
  await prisma.owners.updateMany({
    where: { id: input.owner.id, organization_id: input.owner.organization_id, support_whatsapp: input.owner.support_whatsapp ?? '' },
    data: { support_whatsapp: null, updated_at: new Date() },
  })

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

// ---------------------------------------------------------------------------
// Ticket Reply Flow
// ---------------------------------------------------------------------------

async function processTicketReplyConversation(input: {
  sender: string
  conv: TicketReplyConversation
  text: string
  owner: OwnerIdentity
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const ctx = { owner: input.owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction }
  const value = input.text.trim()

  if (input.conv.step === 'select_ticket') {
    const tickets = input.conv.data.tickets
    const num = Number(value)
    if (!Number.isInteger(num) || num < 1 || num > tickets.length) {
      await input.sendText({
        to: input.sender,
        text: `Please reply with a number between 1 and ${tickets.length}.`,
        organizationId: input.owner.organization_id,
        ownerId: input.owner.id,
      })
      return
    }
    const selected = tickets[num - 1]
    input.conv.data.selectedTicketId = selected.id
    input.conv.data.selectedSubject = selected.subject
    input.conv.step = 'enter_reply'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)
    clearPendingMenu(input.sender)
    await input.sendText({
      to: input.sender,
      text: `Replying to: "${selected.subject}" (${selected.tenantName})\n\nType your reply message:`,
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
    })
    await sendCancelFlowAction({ owner: input.owner, sender: input.sender, sendAction: input.sendAction, metadataEvent: 'whatsapp_ticket_reply_cancel' })
    return
  }

  if (input.conv.step === 'enter_reply') {
    if (value.length < 1 || value.length > 2000) {
      await input.sendText({ to: input.sender, text: 'Reply must be 1–2000 characters. Try again.', organizationId: input.owner.organization_id, ownerId: input.owner.id })
      return
    }
    clearConversation(input.sender)
    await handleReplyCommand({ ...ctx, command: { ticketId: input.conv.data.selectedTicketId!, message: value } })
  }
}

// ---------------------------------------------------------------------------
// Ticket Status Flow
// ---------------------------------------------------------------------------

async function processTicketStatusConversation(input: {
  sender: string
  conv: TicketStatusConversation
  text: string
  owner: OwnerIdentity
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const ctx = { owner: input.owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction }
  const value = input.text.trim()
  const lc = value.toLowerCase()

  if (input.conv.step === 'select_ticket') {
    const tickets = input.conv.data.tickets
    const num = Number(value)
    if (!Number.isInteger(num) || num < 1 || num > tickets.length) {
      await input.sendText({
        to: input.sender,
        text: `Reply with a number between 1 and ${tickets.length}.`,
        organizationId: input.owner.organization_id,
        ownerId: input.owner.id,
      })
      return
    }
    const selected = tickets[num - 1]
    input.conv.data.selectedTicketId = selected.id
    input.conv.step = 'select_status'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)

    const statusOptions = [
      { actionId: 'ts_open', label: '🟠 Open' },
      { actionId: 'ts_in_progress', label: '🟡 In Progress' },
      { actionId: 'ts_resolved', label: '🟢 Resolved' },
      { actionId: 'ts_closed', label: '✅ Closed' },
    ]
    await input.sendText({
      to: input.sender,
      text: [`"${selected.subject}" — current: ${selected.currentStatus}`, '', ...statusOptions.map((o, i) => `${i + 1}. ${o.label}`), '', 'Reply with a number to set status.'].join('\n'),
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
    })
    setPendingMenu(input.sender, statusOptions)
    return
  }

  if (input.conv.step === 'select_status') {
    const statusMap: Record<string, 'open' | 'in_progress' | 'resolved' | 'closed'> = {
      open: 'open', '1': 'open',
      in_progress: 'in_progress', '2': 'in_progress', inprogress: 'in_progress',
      resolved: 'resolved', '3': 'resolved',
      closed: 'closed', '4': 'closed',
    }
    const status = statusMap[lc]
    if (!status) {
      await input.sendText({ to: input.sender, text: 'Reply with 1 (Open), 2 (In Progress), 3 (Resolved), or 4 (Closed).', organizationId: input.owner.organization_id, ownerId: input.owner.id })
      return
    }
    clearConversation(input.sender)
    clearPendingMenu(input.sender)
    await handleStatusCommand({ ...ctx, command: { ticketId: input.conv.data.selectedTicketId!, status } })
  }
}

// ---------------------------------------------------------------------------
// Approvals Review Flow
// ---------------------------------------------------------------------------

async function processApprovalsConversation(input: {
  sender: string
  conv: ApprovalsConversation
  text: string
  owner: OwnerIdentity
  sendText: SendTextFn
  sendAction?: SendActionFn
}) {
  const ctx = { owner: input.owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction }
  const value = input.text.trim()
  const lc = value.toLowerCase()

  if (input.conv.step === 'select_approval') {
    const approvals = input.conv.data.approvals
    const num = Number(value)
    if (!Number.isInteger(num) || num < 1 || num > approvals.length) {
      await input.sendText({ to: input.sender, text: `Reply with a number between 1 and ${approvals.length}.`, organizationId: input.owner.organization_id, ownerId: input.owner.id })
      return
    }
    const selected = approvals[num - 1]
    input.conv.data.selectedApprovalId = selected.id
    input.conv.step = 'select_action'
    input.conv.updatedAt = nowMs()
    conversations.set(input.sender, input.conv)

    const actionOptions = [
      { actionId: 'ar_approve', label: '✅ Approve' },
      { actionId: 'ar_reject', label: '❌ Reject' },
    ]
    await input.sendText({
      to: input.sender,
      text: [`${selected.tenantName} — ${selected.amount} (due ${selected.dueDate})`, '', '1. ✅ Approve', '2. ❌ Reject'].join('\n'),
      organizationId: input.owner.organization_id,
      ownerId: input.owner.id,
    })
    setPendingMenu(input.sender, actionOptions)
    return
  }

  if (input.conv.step === 'select_action') {
    const approvalId = input.conv.data.selectedApprovalId!
    if (lc === '1' || lc === 'approve' || lc === 'yes') {
      clearConversation(input.sender)
      clearPendingMenu(input.sender)
      await handleReviewCommand({ ...ctx, command: { action: 'approve', approvalId, message: null } })
      return
    }
    if (lc === '2' || lc === 'reject' || lc === 'no') {
      input.conv.step = 'select_rejection'
      input.conv.updatedAt = nowMs()
      conversations.set(input.sender, input.conv)
      const rejOptions = [
        { actionId: 'rr_proof', label: '🧾 Proof Missing' },
        { actionId: 'rr_amount', label: '💰 Amount Wrong' },
        { actionId: 'rr_cycle', label: '📅 Wrong Cycle' },
      ]
      await input.sendText({
        to: input.sender,
        text: ['Reason for rejection:', '', '1. 🧾 Proof Missing', '2. 💰 Amount Wrong', '3. 📅 Wrong Cycle'].join('\n'),
        organizationId: input.owner.organization_id,
        ownerId: input.owner.id,
      })
      setPendingMenu(input.sender, rejOptions)
      return
    }
    await input.sendText({ to: input.sender, text: 'Reply 1 to Approve or 2 to Reject.', organizationId: input.owner.organization_id, ownerId: input.owner.id })
    return
  }

  if (input.conv.step === 'select_rejection') {
    const reasonMap: Record<string, string> = {
      '1': 'proof', proof: 'proof',
      '2': 'amount', amount: 'amount',
      '3': 'cycle', cycle: 'cycle',
    }
    const reason = reasonMap[lc]
    if (!reason) {
      await input.sendText({ to: input.sender, text: 'Reply 1 (Proof Missing), 2 (Amount Wrong), or 3 (Wrong Cycle).', organizationId: input.owner.organization_id, ownerId: input.owner.id })
      return
    }
    clearConversation(input.sender)
    clearPendingMenu(input.sender)
    await handleReviewCommand({ ...ctx, command: { action: 'reject', approvalId: input.conv.data.selectedApprovalId!, message: reason } })
  }
}

async function handleWhatsAppConnectToken(input: {
  token: string
  sender: string
  sendText: SendTextFn
}): Promise<boolean> {
  const now = new Date()
  const row = await prisma.whatsapp_connect_codes.findFirst({
    where: { code: input.token, consumed_at: null },
  })

  if (!row) {
    await input.sendText({ to: input.sender, text: 'This connect link is invalid or has already been used. Please generate a new one from the Prophives dashboard.' })
    return true
  }

  if (row.expires_at <= now) {
    await input.sendText({ to: input.sender, text: 'This connect link has expired. Please generate a new one from the Prophives dashboard.' })
    return true
  }

  // Mark token consumed
  await prisma.whatsapp_connect_codes.updateMany({
    where: { id: row.id },
    data: { consumed_at: now },
  })

  // Link the sender's phone number to the owner
  const normalizedSender = input.sender.replace(/^whatsapp:/i, '')
  await upsertOwnerWhatsAppLink({
    ownerId: row.owner_id,
    organizationId: row.organization_id,
    phoneNumber: normalizedSender,
  })

  // Also save to owner's support_whatsapp field
  await prisma.owners.updateMany({
    where: { id: row.owner_id },
    data: { support_whatsapp: normalizedSender, updated_at: now },
  })

  await input.sendText({
    to: input.sender,
    text: '✅ *WhatsApp connected!*\n\nYour number is now linked to your Prophives account. You can now receive notifications and manage your portfolio here.\n\nType *menu* to get started.',
    metadata: { event: 'whatsapp_connect_success' },
  })

  return true
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

  // ── WhatsApp connect-via-link token handler ──
  if (incoming.toLowerCase().startsWith('connect-')) {
    const token = incoming.slice('connect-'.length).trim()
    if (token.length > 0) {
      const handled = await handleWhatsAppConnectToken({ token, sender: input.sender, sendText: input.sendText })
      if (handled) return
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

  await markWhatsAppInboundSeen({
    organizationId: owner.organization_id,
    userRole: 'owner',
    ownerId: owner.id,
    senderPhone: input.sender,
  })

  const ctx = { owner, sender: input.sender, sendText: input.sendText, sendAction: input.sendAction }

  // ── Button callback routing (explicit IDs like mn|stats) ──
  const buttonHandled = await routeButtonCallback(incoming, ctx)
  if (buttonHandled) return

  // ── Active flow routing ──
  if (conv) {
    if (conv.flow === 'add_property') {
      await processAddPropertyConversation({ sender: input.sender, conv, text: incoming, sendText: input.sendText, sendAction: input.sendAction })
      return
    }
    if (conv.flow === 'add_tenant') {
      await processAddTenantConversation({ sender: input.sender, conv, text: incoming, sendText: input.sendText, sendAction: input.sendAction })
      return
    }
    if (conv.flow === 'ticket_reply') {
      // Check if user selected a quick action from the pending menu first
      const pendingNum = Number(incoming.trim())
      const pendingMenu = getPendingMenu(input.sender)
      if (pendingMenu && Number.isInteger(pendingNum) && pendingNum >= 1 && pendingNum <= pendingMenu.length) {
        const chosen = pendingMenu[pendingNum - 1]
        // Quick actions after ticket list: reply, status, or menu
        if (chosen.actionId === 'flow|ticket_reply') {
          clearPendingMenu(input.sender)
          // conv already has tickets loaded; switch to select_ticket step
          conv.step = 'select_ticket'
          conv.updatedAt = nowMs()
          conversations.set(input.sender, conv)
          const tickets = conv.data.tickets
          await input.sendText({
            to: input.sender,
            text: ['Which ticket to reply to?', '', ...tickets.map((t, i) => `${i + 1}. ${t.subject} (${t.tenantName})`)].join('\n'),
            organizationId: owner.organization_id,
            ownerId: owner.id,
          })
          return
        }
        if (chosen.actionId === 'flow|ticket_status') {
          clearPendingMenu(input.sender)
          const tickets = conv.data.tickets
          setConversation(input.sender, {
            flow: 'ticket_status',
            ownerId: owner.id,
            organizationId: owner.organization_id,
            step: 'select_ticket',
            data: { tickets },
          })
          await input.sendText({
            to: input.sender,
            text: ['Which ticket to update?', '', ...tickets.map((t, i) => `${i + 1}. ${t.subject} — ${t.currentStatus} (${t.tenantName})`)].join('\n'),
            organizationId: owner.organization_id,
            ownerId: owner.id,
          })
          return
        }
        // Fall through to pending menu handler below for mn|menu etc.
        clearPendingMenu(input.sender)
        const handled2 = await routeButtonCallback(chosen.actionId, ctx)
        if (handled2) return
      }
      // conv is in select_ticket or enter_reply step
      if (conv.step === 'select_ticket' || conv.step === 'enter_reply') {
        await processTicketReplyConversation({ sender: input.sender, conv, text: incoming, owner, sendText: input.sendText, sendAction: input.sendAction })
        return
      }
    }
    if (conv.flow === 'ticket_status') {
      await processTicketStatusConversation({ sender: input.sender, conv, text: incoming, owner, sendText: input.sendText, sendAction: input.sendAction })
      return
    }
    if (conv.flow === 'approvals_review') {
      await processApprovalsConversation({ sender: input.sender, conv, text: incoming, owner, sendText: input.sendText, sendAction: input.sendAction })
      return
    }
  }

  // ── Pending menu: numbered responses (1-9) ──
  const numInput = Number(incoming.trim())
  const pendingMenu = getPendingMenu(input.sender)
  if (pendingMenu && Number.isInteger(numInput) && numInput >= 1 && numInput <= pendingMenu.length) {
    clearPendingMenu(input.sender)
    const chosen = pendingMenu[numInput - 1]
    const handled = await routeButtonCallback(chosen.actionId, ctx)
    if (handled) return
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

  // ── Natural language keywords (no slash required) ──
  const lcIncoming = incoming.toLowerCase().trim()
  const greetings = ['hi', 'hello', 'hey', 'start', 'help', 'menu', 'hii', 'helo', 'helo', 'hola']
  if (greetings.includes(lcIncoming) || commandToken === '/start' || commandToken === '/menu' || commandToken === '/help') {
    await sendMenu(ctx)
    return
  }

  if (lcIncoming === 'stats' || lcIncoming === 'dashboard' || commandToken === '/ownerstats' || commandToken === '/stats') {
    await handleOwnerStats(ctx)
    return
  }
  if (lcIncoming === 'tickets' || lcIncoming === 'ticket' || commandToken === '/tickets') {
    const { filter, page } = parseTicketsCommand(incoming)
    await handleTicketsCommand({ ...ctx, filter, page })
    return
  }
  if (lcIncoming === 'tenants' || lcIncoming === 'tenant' || commandToken === '/tenants') {
    await handleTenantsCommand(ctx)
    return
  }
  if (lcIncoming === 'properties' || lcIncoming === 'property' || commandToken === '/properties') {
    await handlePropertiesCommand(ctx)
    return
  }
  if (lcIncoming === 'approvals' || lcIncoming === 'approval' || commandToken === '/approvals') {
    await handleApprovalsCommand(ctx)
    return
  }
  if (lcIncoming === 'portfolio' || commandToken === '/portfolio') {
    await handlePortfolioCommand(ctx)
    return
  }
  if (lcIncoming === 'add property' || lcIncoming === 'addproperty' || commandToken === '/addproperty') {
    await startAddProperty(ctx)
    return
  }
  if (lcIncoming === 'add tenant' || lcIncoming === 'addtenant' || commandToken === '/addtenant') {
    await startAddTenant(ctx)
    return
  }
  if (commandToken === '/disconnect' || commandToken === '/stop') {
    await disconnectOwnerWhatsAppLink(ctx)
    return
  }

  // ── Legacy slash commands (still work for power users) ──
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

  // ── Catch-all: show menu for anything unrecognized ──
  await sendMenu(ctx)
}
