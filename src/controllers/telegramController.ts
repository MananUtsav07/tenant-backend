import type { Request, Response } from 'express'

import { env } from '../config/env.js'
import { AppError, asyncHandler } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { notifyTenantTicketClosed, notifyTenantTicketReply, notifyTenantTicketStatusUpdated } from '../services/notificationService.js'
import { reviewOwnerRentPaymentApproval } from '../services/rentPaymentService.js'
import { replyToTicketAsOwner, updateTicketStatusAsOwner } from '../services/ticketThreadService.js'
import { linkTelegramChatFromStartToken } from '../services/telegramOnboardingService.js'
import {
  answerTelegramCallbackQuery,
  disconnectTelegramByChat,
  getOwnerTelegramChatLinkByChat,
  sendTelegramMessageWithRetry,
} from '../services/telegramService.js'

type TelegramWebhookUpdate = {
  message?: {
    text?: string
    chat?: {
      id?: number | string
    }
    from?: {
      id?: number | string
      username?: string
      first_name?: string
      last_name?: string
    }
  }
  callback_query?: {
    id?: string
    data?: string
    from?: {
      id?: number | string
    }
    message?: {
      chat?: {
        id?: number | string
      }
    }
  }
}

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketFilter = TicketStatus | 'all'
type CallbackAction =
  | { kind: 'ticket_status'; ticketId: string; status: TicketStatus }
  | { kind: 'rent_approval'; approvalId: string; action: 'approve' | 'reject' }
  | { kind: 'prompt_rent_message'; approvalId: string; action: 'approve' | 'reject' }
  | { kind: 'rent_reject_template'; approvalId: string; reasonCode: 'proof' | 'amount' | 'cycle' }
  | { kind: 'ticket_list'; filter: TicketFilter; page: number }
  | { kind: 'menu'; action: 'stats' | 'tickets' | 'tenants' | 'properties' | 'approvals' | 'portfolio' | 'help' | 'refresh' }

function readStartToken(text: string | undefined): string | null {
  if (typeof text !== 'string') {
    return null
  }

  const trimmed = text.trim()
  if (!trimmed.toLowerCase().startsWith('/start')) {
    return null
  }

  const commandPattern = /^\/start(?:@[a-z0-9_]+)?(?:\s+|=)([\s\S]+)$/i
  const matched = trimmed.match(commandPattern)
  if (!matched || typeof matched[1] !== 'string') {
    return null
  }

  return matched[1].replace(/\s+/g, '') || null
}

function isDisconnectCommand(text: string | undefined): boolean {
  if (typeof text !== 'string') {
    return false
  }

  const normalized = text.trim().toLowerCase()
  return normalized === '/stop' || normalized === '/disconnect'
}

function isOwnerStatsCommand(text: string | undefined): boolean {
  if (typeof text !== 'string') {
    return false
  }

  return /^\/ownerstats(?:@[a-z0-9_]+)?$/i.test(text.trim()) || /^\/stats(?:@[a-z0-9_]+)?$/i.test(text.trim())
}

function isHelpCommand(text: string | undefined): boolean {
  if (typeof text !== 'string') {
    return false
  }

  return /^\/help(?:@[a-z0-9_]+)?$/i.test(text.trim())
}

function isBareStartCommand(text: string | undefined): boolean {
  if (typeof text !== 'string') {
    return false
  }

  return /^\/start(?:@[a-z0-9_]+)?$/i.test(text.trim())
}

function parseReplyCommand(text: string | undefined): { ticketId: string; message: string } | null {
  if (typeof text !== 'string') {
    return null
  }

  const trimmed = text.trim()
  const matched = trimmed.match(/^\/reply(?:@[a-z0-9_]+)?\s+([a-f0-9-]{36})\s+([\s\S]{1,2000})$/i)
  if (!matched) {
    return null
  }

  return {
    ticketId: matched[1],
    message: matched[2].trim(),
  }
}

function parseRentReviewCommand(
  text: string | undefined,
): { action: 'approve' | 'reject'; approvalId: string; message: string | null } | null {
  if (typeof text !== 'string') {
    return null
  }

  const trimmed = text.trim()
  const matched = trimmed.match(/^\/(approve|reject)(?:@[a-z0-9_]+)?\s+([a-f0-9-]{36})(?:\s+([\s\S]{1,500}))?$/i)
  if (!matched) {
    return null
  }

  return {
    action: matched[1].toLowerCase() as 'approve' | 'reject',
    approvalId: matched[2],
    message: typeof matched[3] === 'string' && matched[3].trim().length > 0 ? matched[3].trim() : null,
  }
}

function parseCallbackData(data: string | undefined): CallbackAction | null {
  if (typeof data !== 'string') {
    return null
  }

  const ticketMatched = data.match(/^ts\|([a-f0-9-]{36})\|(open|in_progress|resolved|closed)$/i)
  if (ticketMatched) {
    return {
      kind: 'ticket_status',
      ticketId: ticketMatched[1],
      status: ticketMatched[2] as TicketStatus,
    }
  }

  const rentMatched = data.match(/^ra\|(approve|reject)\|([a-f0-9-]{36})$/i)
  if (rentMatched) {
    return {
      kind: 'rent_approval',
      action: rentMatched[1].toLowerCase() as 'approve' | 'reject',
      approvalId: rentMatched[2],
    }
  }

  const rentPromptMatched = data.match(/^rm\|(approve|reject)\|([a-f0-9-]{36})$/i)
  if (rentPromptMatched) {
    return {
      kind: 'prompt_rent_message',
      action: rentPromptMatched[1].toLowerCase() as 'approve' | 'reject',
      approvalId: rentPromptMatched[2],
    }
  }

  const menuMatched = data.match(/^mn\|(stats|tickets|tenants|properties|approvals|portfolio|help|refresh)$/i)
  if (menuMatched) {
    return {
      kind: 'menu',
      action: menuMatched[1].toLowerCase() as
        | 'stats'
        | 'tickets'
        | 'tenants'
        | 'properties'
        | 'approvals'
        | 'portfolio'
        | 'help'
        | 'refresh',
    }
  }

  const ticketListMatched = data.match(/^tk\|(all|open|in_progress|resolved|closed)\|(\d{1,2})$/i)
  if (ticketListMatched) {
    return {
      kind: 'ticket_list',
      filter: ticketListMatched[1].toLowerCase() as TicketFilter,
      page: Number(ticketListMatched[2]),
    }
  }

  const rejectTemplateMatched = data.match(/^rr\|([a-f0-9-]{36})\|(proof|amount|cycle)$/i)
  if (rejectTemplateMatched) {
    return {
      kind: 'rent_reject_template',
      approvalId: rejectTemplateMatched[1],
      reasonCode: rejectTemplateMatched[2].toLowerCase() as 'proof' | 'amount' | 'cycle',
    }
  }

  return null
}

async function resolveOwnerLinkFromTelegramIdentity(input: { chatId: string; telegramUserId: string }) {
  const ownerLink = await getOwnerTelegramChatLinkByChat({
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
  })

  if (!ownerLink || !ownerLink.owner_id) {
    throw new AppError('Owner link not found for this Telegram chat.', 404)
  }

  return ownerLink
}

function ownerMainMenuReplyMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '📊 View Stats', callback_data: 'mn|stats' },
        { text: '🎫 Tickets', callback_data: 'mn|tickets' },
      ],
      [
        { text: '👥 View Tenants', callback_data: 'mn|tenants' },
        { text: '🏠 Properties', callback_data: 'mn|properties' },
      ],
      [
        { text: '💸 Approvals', callback_data: 'mn|approvals' },
        { text: '📈 Portfolio', callback_data: 'mn|portfolio' },
      ],
      [{ text: '🔄 Refresh', callback_data: 'mn|refresh' }, { text: '❓ Help', callback_data: 'mn|help' }],
    ],
  }
}

async function sendOwnerMainMenu(input: { chatId: string; organizationId: string; ownerId: string }) {
  await sendTelegramMessageWithRetry({
    chatId: input.chatId,
    text: [
      '🏢 Owner Control Panel',
      'Use the buttons below to quickly view your portfolio and support activity.',
      '',
      '⚡ Quick commands',
      '/reply <ticket-id> <message>',
      '/approve <approval-id> [message]',
      '/reject <approval-id> <reason>',
      '',
      'Tip: Tickets/approvals are best handled using buttons below.',
    ].join('\n'),
    replyMarkup: ownerMainMenuReplyMarkup(),
    logContext: {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      userRole: 'owner',
      eventType: 'owner_menu_sent',
    },
  })
}

function ticketFilterLabel(filter: TicketFilter): string {
  if (filter === 'all') {
    return 'All'
  }
  return filter.replace('_', ' ')
}

function ticketFilterButtons(page: number) {
  return [
    [
      { text: 'All', callback_data: `tk|all|${page}` },
      { text: 'Open', callback_data: `tk|open|${page}` },
      { text: 'In Progress', callback_data: `tk|in_progress|${page}` },
    ],
    [
      { text: 'Resolved', callback_data: `tk|resolved|${page}` },
      { text: 'Closed', callback_data: `tk|closed|${page}` },
    ],
  ]
}

async function sendOwnerTicketList(input: {
  chatId: string
  organizationId: string
  ownerId: string
  filter: TicketFilter
  page: number
}) {
  const pageSize = 5
  const safePage = Math.max(1, Math.min(input.page, 99))
  const from = (safePage - 1) * pageSize
  const to = from + pageSize - 1

  let listQuery = supabaseAdmin
    .from('support_tickets')
    .select('id, subject, status, created_at, tenants(full_name, tenant_access_id)')
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .order('created_at', { ascending: false })
    .range(from, to)
  let countQuery = supabaseAdmin
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)

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

  await sendTelegramMessageWithRetry({
    chatId: input.chatId,
    text:
      rows.length > 0
        ? [`🎫 Ticket Inbox • ${ticketFilterLabel(input.filter)} • Page ${currentPage}/${totalPages}`, ...rows].join('\n')
        : `✅ No ${ticketFilterLabel(input.filter).toLowerCase()} tickets on page ${currentPage}.`,
    replyMarkup: {
      inline_keyboard: [
        ...ticketFilterButtons(currentPage),
        [
          { text: '◀ Prev', callback_data: `tk|${input.filter}|${Math.max(1, currentPage - 1)}` },
          { text: 'Next ▶', callback_data: `tk|${input.filter}|${Math.min(totalPages, currentPage + 1)}` },
        ],
      ],
    },
    logContext: {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      userRole: 'owner',
      eventType: 'owner_menu_tickets',
      metadata: { filter: input.filter, page: currentPage, total },
    },
  })
}

async function sendOwnerTenantsSnapshot(input: { chatId: string; organizationId: string; ownerId: string }) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, full_name, tenant_access_id, status, payment_status, lease_end_date, monthly_rent')
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    throw new AppError('Failed to load tenants', 500)
  }

  const lines = (data ?? []).map((row) => {
    const leaseEnd = row.lease_end_date ? String(row.lease_end_date).slice(0, 10) : '-'
    return `• ${row.full_name} (${row.tenant_access_id}) | ${row.status} | rent: ${row.payment_status} | lease: ${leaseEnd} | amount: ${row.monthly_rent}`
  })

  await sendTelegramMessageWithRetry({
    chatId: input.chatId,
    text: lines.length > 0 ? ['👥 Tenants (latest 8)', ...lines].join('\n') : 'ℹ️ Tenants: none found.',
    logContext: {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      userRole: 'owner',
      eventType: 'owner_menu_tenants',
    },
  })
}

async function sendOwnerPropertySnapshot(input: { chatId: string; organizationId: string; ownerId: string }) {
  const { data: properties, error } = await supabaseAdmin
    .from('properties')
    .select('id, property_name, unit_number')
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .order('created_at', { ascending: false })
    .limit(6)

  if (error) {
    throw new AppError('Failed to load properties', 500)
  }

  if (!properties || properties.length === 0) {
    await sendTelegramMessageWithRetry({
      chatId: input.chatId,
      text: 'ℹ️ Property Snapshot: no properties found.',
      logContext: {
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        userRole: 'owner',
        eventType: 'owner_menu_properties_empty',
      },
    })
    return
  }

  const lines: string[] = []
  for (const property of properties) {
    const [{ data: tenantRows, count: tenantCount }] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('id', { count: 'exact' })
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId)
        .eq('property_id', property.id)
        .eq('status', 'active'),
    ])
    const tenantIds = (tenantRows ?? []).map((tenant) => tenant.id as string)
    let openTicketCount = 0
    if (tenantIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId)
        .in('status', ['open', 'in_progress'])
        .in('tenant_id', tenantIds)
      openTicketCount = count ?? 0
    }

    lines.push(
      `• ${property.property_name}${property.unit_number ? ` (${property.unit_number})` : ''} | tenants: ${tenantCount ?? 0} | open tickets: ${openTicketCount ?? 0}`,
    )
  }

  await sendTelegramMessageWithRetry({
    chatId: input.chatId,
    text: ['🏠 Property Snapshot', ...lines].join('\n'),
    logContext: {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      userRole: 'owner',
      eventType: 'owner_menu_properties',
    },
  })
}

async function sendOwnerPendingApprovalsSnapshot(input: { chatId: string; organizationId: string; ownerId: string }) {
  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select('id, due_date, amount_paid, tenants(full_name, tenant_access_id)')
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .eq('status', 'awaiting_owner_approval')
    .order('created_at', { ascending: false })
    .limit(3)

  if (error) {
    throw new AppError('Failed to load pending approvals', 500)
  }

  const lines = (data ?? []).map((row) => {
    const tenant = (row.tenants as { full_name?: string | null; tenant_access_id?: string | null } | null) ?? null
    return `• ${tenant?.full_name ?? tenant?.tenant_access_id ?? 'Tenant'} | ${row.amount_paid} | due ${row.due_date} | ID: ${row.id}`
  })

  const actionButtons = (data ?? []).flatMap((row) => [
    [
      { text: `✅ #${String(row.id).slice(0, 6)}`, callback_data: `ra|approve|${row.id}` },
      { text: `❌ #${String(row.id).slice(0, 6)}`, callback_data: `ra|reject|${row.id}` },
    ],
    [
      { text: 'Proof Missing', callback_data: `rr|${row.id}|proof` },
      { text: 'Amount Mismatch', callback_data: `rr|${row.id}|amount` },
      { text: 'Wrong Cycle', callback_data: `rr|${row.id}|cycle` },
    ],
  ])

  await sendTelegramMessageWithRetry({
    chatId: input.chatId,
    text:
      lines.length > 0
        ? ['💸 Pending Rent Approvals (latest 3)', ...lines, 'Use one-tap actions below or /approve /reject commands.'].join(
            '\n',
          )
        : '✅ Pending Rent Approvals: none right now.',
    replyMarkup: actionButtons.length > 0 ? { inline_keyboard: actionButtons } : undefined,
    logContext: {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      userRole: 'owner',
      eventType: 'owner_menu_approvals',
    },
  })
}

async function sendOwnerPortfolioSnapshot(input: { chatId: string; organizationId: string; ownerId: string }) {
  const now = new Date()
  const cycleYear = now.getUTCFullYear()
  const cycleMonth = now.getUTCMonth() + 1

  const [propertiesResult, activeTenantsResult, openTicketsResult, overdueTenantsResult, approvedRentResult, pendingApprovalsResult] =
    await Promise.all([
      supabaseAdmin
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId),
      supabaseAdmin
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId)
        .eq('status', 'active'),
      supabaseAdmin
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId)
        .in('status', ['open', 'in_progress']),
      supabaseAdmin
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId)
        .eq('payment_status', 'overdue'),
      supabaseAdmin
        .from('rent_payment_approvals')
        .select('amount_paid')
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId)
        .eq('cycle_year', cycleYear)
        .eq('cycle_month', cycleMonth)
        .eq('status', 'approved'),
      supabaseAdmin
        .from('rent_payment_approvals')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', input.organizationId)
        .eq('owner_id', input.ownerId)
        .eq('status', 'awaiting_owner_approval'),
    ])

  const approvedAmount = (approvedRentResult.data ?? []).reduce((sum, row) => sum + Number(row.amount_paid ?? 0), 0)

  await sendTelegramMessageWithRetry({
    chatId: input.chatId,
    text: [
      '📈 Portfolio Snapshot',
      `🏠 Properties: ${propertiesResult.count ?? 0}`,
      `👥 Active tenants: ${activeTenantsResult.count ?? 0}`,
      `🎫 Open tickets: ${openTicketsResult.count ?? 0}`,
      `⏰ Overdue rent tenants: ${overdueTenantsResult.count ?? 0}`,
      `💸 Pending approvals: ${pendingApprovalsResult.count ?? 0}`,
      `💰 Approved rent this cycle: ${approvedAmount}`,
    ].join('\n'),
    logContext: {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      userRole: 'owner',
      eventType: 'owner_menu_portfolio',
      metadata: { cycle_year: cycleYear, cycle_month: cycleMonth },
    },
  })
}

async function processOwnerMenuAction(input: {
  chatId: string
  telegramUserId: string
  action: 'stats' | 'tickets' | 'tenants' | 'properties' | 'approvals' | 'portfolio' | 'help' | 'refresh'
}) {
  const ownerLink = await resolveOwnerLinkFromTelegramIdentity({
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
  })

  if (input.action === 'stats') {
    await processOwnerStatsCommand({
      chat: { id: input.chatId },
      from: { id: input.telegramUserId },
    })
    return
  }

  if (input.action === 'tickets') {
    await sendOwnerTicketList({
      chatId: input.chatId,
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id!,
      filter: 'all',
      page: 1,
    })
    return
  }

  if (input.action === 'tenants') {
    await sendOwnerTenantsSnapshot({
      chatId: input.chatId,
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id!,
    })
    return
  }

  if (input.action === 'approvals') {
    await sendOwnerPendingApprovalsSnapshot({
      chatId: input.chatId,
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id!,
    })
    return
  }

  if (input.action === 'properties') {
    await sendOwnerPropertySnapshot({
      chatId: input.chatId,
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id!,
    })
    return
  }

  if (input.action === 'portfolio') {
    await sendOwnerPortfolioSnapshot({
      chatId: input.chatId,
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id!,
    })
    return
  }

  if (input.action === 'help') {
    await processHelpCommand({
      chat: { id: input.chatId },
    })
    return
  }

  await sendOwnerMainMenu({
    chatId: input.chatId,
    organizationId: ownerLink.organization_id,
    ownerId: ownerLink.owner_id!,
  })
}

async function processOwnerStatsCommand(payload: TelegramWebhookUpdate['message']) {
  const chatId = payload?.chat?.id
  const userId = payload?.from?.id
  if (chatId === undefined || userId === undefined) {
    return
  }

  const ownerLink = await resolveOwnerLinkFromTelegramIdentity({
    chatId: String(chatId),
    telegramUserId: String(userId),
  })

  const [activeTenantsResult, totalTicketsResult, openTicketsResult, closedTicketsResult, pendingApprovalsResult] = await Promise.all([
    supabaseAdmin
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ownerLink.organization_id)
      .eq('owner_id', ownerLink.owner_id)
      .eq('status', 'active'),
    supabaseAdmin
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ownerLink.organization_id)
      .eq('owner_id', ownerLink.owner_id),
    supabaseAdmin
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ownerLink.organization_id)
      .eq('owner_id', ownerLink.owner_id)
      .in('status', ['open', 'in_progress']),
    supabaseAdmin
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ownerLink.organization_id)
      .eq('owner_id', ownerLink.owner_id)
      .eq('status', 'closed'),
    supabaseAdmin
      .from('rent_payment_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ownerLink.organization_id)
      .eq('owner_id', ownerLink.owner_id)
      .eq('status', 'awaiting_owner_approval'),
  ])

  const errors = [
    activeTenantsResult.error,
    totalTicketsResult.error,
    openTicketsResult.error,
    closedTicketsResult.error,
    pendingApprovalsResult.error,
  ].filter(Boolean)
  if (errors.length > 0) {
    throw new AppError('Failed to load owner stats', 500)
  }

  await sendTelegramMessageWithRetry({
    chatId: String(chatId),
    text: [
      '📊 Owner Quick Stats',
      `👥 Active tenants: ${activeTenantsResult.count ?? 0}`,
      `🎫 Total tickets: ${totalTicketsResult.count ?? 0}`,
      `🟠 Open tickets: ${openTicketsResult.count ?? 0}`,
      `✅ Closed tickets: ${closedTicketsResult.count ?? 0}`,
      `💸 Pending rent approvals: ${pendingApprovalsResult.count ?? 0}`,
      '',
      '⚡ Commands',
      '/ownerstats',
      '/reply <ticket-id> <message>',
      '/disconnect',
    ].join('\n'),
    logContext: {
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id ?? undefined,
      userRole: 'owner',
      eventType: 'owner_stats_command',
    },
  })
}

async function processOwnerReplyCommand(payload: TelegramWebhookUpdate['message']) {
  const chatId = payload?.chat?.id
  const userId = payload?.from?.id
  const replyInput = parseReplyCommand(payload?.text)
  if (chatId === undefined || userId === undefined || !replyInput) {
    return false
  }

  const ownerLink = await resolveOwnerLinkFromTelegramIdentity({
    chatId: String(chatId),
    telegramUserId: String(userId),
  })

  const result = await replyToTicketAsOwner({
    ticketId: replyInput.ticketId,
    ownerId: ownerLink.owner_id!,
    organizationId: ownerLink.organization_id,
    message: replyInput.message,
  })

  const tenant = result.ticket.tenants as
    | {
        full_name?: string | null
        email?: string | null
        properties?: { property_name?: string | null; unit_number?: string | null } | null
      }
    | null
  const owner = result.ticket.owners as
    | {
        full_name?: string | null
        company_name?: string | null
        email?: string | null
      }
    | null
  const senderName = owner?.full_name?.trim() || owner?.company_name?.trim() || owner?.email?.trim() || 'Owner'

  await notifyTenantTicketReply({
    organizationId: result.ticket.organization_id,
    ownerId: result.ticket.owner_id,
    tenantId: result.ticket.tenant_id,
    tenantEmail: tenant?.email ?? null,
    tenantName: tenant?.full_name ?? 'Tenant',
    subject: result.ticket.subject,
    senderName,
    senderRoleLabel: 'Owner',
    propertyName: tenant?.properties?.property_name ?? null,
    unitNumber: tenant?.properties?.unit_number ?? null,
    message: replyInput.message,
  })

  await sendTelegramMessageWithRetry({
    chatId: String(chatId),
    text: `✅ Reply sent to tenant for ticket #${result.ticket.id.slice(0, 8)}.`,
    logContext: {
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id ?? undefined,
      tenantId: result.ticket.tenant_id,
      userRole: 'owner',
      eventType: 'owner_ticket_reply_command',
      metadata: { ticket_id: result.ticket.id },
    },
  })

  return true
}

async function processHelpCommand(payload: TelegramWebhookUpdate['message']) {
  const chatId = payload?.chat?.id
  if (chatId === undefined) {
    return
  }

  await sendTelegramMessageWithRetry({
    chatId: String(chatId),
    text: [
      '🤖 Prophives Bot Commands',
      '/ownerstats - View owner dashboard snapshot',
      '/reply <ticket-id> <message> - Reply to a ticket',
      '/approve <approval-id> [message] - Approve rent payment',
      '/reject <approval-id> <reason> - Reject rent payment',
      '/disconnect - Stop Telegram alerts',
      '',
      '💡 Tip: You can also use inline buttons in alerts to update ticket status and rent approvals.',
    ].join('\n'),
    logContext: {
      userRole: 'system',
      eventType: 'telegram_help_command',
    },
  })
}

async function processOwnerRentReviewCommand(payload: TelegramWebhookUpdate['message']) {
  const chatId = payload?.chat?.id
  const userId = payload?.from?.id
  const reviewInput = parseRentReviewCommand(payload?.text)
  if (chatId === undefined || userId === undefined || !reviewInput) {
    return false
  }

  const ownerLink = await resolveOwnerLinkFromTelegramIdentity({
    chatId: String(chatId),
    telegramUserId: String(userId),
  })

  await reviewOwnerRentPaymentApproval({
    approvalId: reviewInput.approvalId,
    ownerId: ownerLink.owner_id!,
    organizationId: ownerLink.organization_id,
    action: reviewInput.action,
    rejectionReason: reviewInput.action === 'reject' ? reviewInput.message ?? undefined : undefined,
    ownerMessage: reviewInput.message ?? undefined,
  })

  await sendTelegramMessageWithRetry({
    chatId: String(chatId),
    text:
      reviewInput.action === 'approve'
        ? `✅ Approval ${reviewInput.approvalId.slice(0, 8)} approved${reviewInput.message ? ' with message.' : '.'}`
        : `⚠️ Approval ${reviewInput.approvalId.slice(0, 8)} rejected with reason.`,
    logContext: {
      organizationId: ownerLink.organization_id,
      ownerId: ownerLink.owner_id ?? undefined,
      userRole: 'owner',
      eventType: reviewInput.action === 'approve' ? 'owner_rent_approve_command' : 'owner_rent_reject_command',
      metadata: { approval_id: reviewInput.approvalId },
    },
  })

  return true
}

async function processDisconnectCommand(payload: TelegramWebhookUpdate['message']) {
  const chatId = payload?.chat?.id
  const userId = payload?.from?.id
  if (chatId === undefined) {
    return
  }

  const disconnectedCount = await disconnectTelegramByChat({
    chatId: String(chatId),
    telegramUserId: userId !== undefined ? String(userId) : undefined,
  })

  await sendTelegramMessageWithRetry({
    chatId: String(chatId),
    text:
      disconnectedCount > 0
        ? '🔕 Telegram alerts disconnected for this account. You can reconnect anytime from the app.'
        : 'ℹ️ No active Telegram link found for this chat.',
    logContext: {
      userRole: 'system',
      eventType: 'telegram_disconnect_command',
      metadata: {
        disconnected_count: disconnectedCount,
      },
    },
  })
}

async function processTicketStatusCallback(callback: NonNullable<TelegramWebhookUpdate['callback_query']>) {
  const callbackId = callback.id
  const chatId = callback.message?.chat?.id
  const userId = callback.from?.id
  const action = parseCallbackData(callback.data)

  if (!callbackId || chatId === undefined || userId === undefined || !action) {
    if (callbackId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        text: 'Invalid action payload.',
        showAlert: true,
      })
    }
    return
  }

  try {
    const ownerLink = await resolveOwnerLinkFromTelegramIdentity({
      chatId: String(chatId),
      telegramUserId: String(userId),
    })

    if (action.kind === 'ticket_status') {
      const ticket = await updateTicketStatusAsOwner({
        ticketId: action.ticketId,
        ownerId: ownerLink.owner_id!,
        organizationId: ownerLink.organization_id,
        status: action.status,
      })

      if (!ticket) {
        throw new AppError('Ticket not found for your account.', 404)
      }

      const tenant = ticket.tenants as
        | {
            full_name?: string | null
            email?: string | null
          }
        | null
      const owner = ticket.owners as
        | {
            full_name?: string | null
            company_name?: string | null
            email?: string | null
          }
        | null
      const senderName = owner?.full_name?.trim() || owner?.company_name?.trim() || owner?.email?.trim() || 'Owner'

      if (action.status === 'closed') {
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
          status: action.status,
        })
      }

      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        text: `Ticket moved to ${action.status.replaceAll('_', ' ')}.`,
      })
      return
    }

    if (action.kind === 'menu') {
      await processOwnerMenuAction({
        chatId: String(chatId),
        telegramUserId: String(userId),
        action: action.action,
      })
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        text: '✅ Updated.',
      })
      return
    }

    if (action.kind === 'ticket_list') {
      await sendOwnerTicketList({
        chatId: String(chatId),
        organizationId: ownerLink.organization_id,
        ownerId: ownerLink.owner_id!,
        filter: action.filter,
        page: action.page,
      })
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        text: '✅ Ticket list updated.',
      })
      return
    }

    if (action.kind === 'rent_approval') {
      await reviewOwnerRentPaymentApproval({
        approvalId: action.approvalId,
        ownerId: ownerLink.owner_id!,
        organizationId: ownerLink.organization_id,
        action: action.action,
      })

      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        text: action.action === 'approve' ? 'Rent payment approved.' : 'Rent payment rejected.',
      })
      return
    }

    if (action.kind === 'rent_reject_template') {
      const reason =
        action.reasonCode === 'proof'
          ? 'Payment proof is missing. Please upload valid proof and resubmit.'
          : action.reasonCode === 'amount'
            ? 'Amount mismatch detected. Please review and resubmit the correct amount.'
            : 'Payment was submitted for the wrong billing cycle. Please resubmit for the correct cycle.'

      await reviewOwnerRentPaymentApproval({
        approvalId: action.approvalId,
        ownerId: ownerLink.owner_id!,
        organizationId: ownerLink.organization_id,
        action: 'reject',
        rejectionReason: reason,
        ownerMessage: reason,
      })

      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        text: '⚠️ Rejected with template reason.',
      })
      return
    }

    if (action.kind !== 'prompt_rent_message') {
      throw new AppError('Unsupported callback action.', 400)
    }

    await answerTelegramCallbackQuery({
      callbackQueryId: callbackId,
        text: action.action === 'approve' ? 'Send approve message now.' : 'Send reject reason now.',
    })
    await sendTelegramMessageWithRetry({
      chatId: String(chatId),
      text:
        action.action === 'approve'
          ? `✍️ To approve with message, send:\n/approve ${action.approvalId} <message>`
          : `✍️ To reject with reason, send:\n/reject ${action.approvalId} <reason>`,
      replyMarkup: {
        force_reply: true,
        input_field_placeholder:
          action.action === 'approve'
            ? `/approve ${action.approvalId} Verified receipt and amount`
            : `/reject ${action.approvalId} Amount mismatch. Please resubmit.`,
      },
      logContext: {
        organizationId: ownerLink.organization_id,
        ownerId: ownerLink.owner_id ?? undefined,
        userRole: 'owner',
        eventType: 'telegram_prompt_rent_message',
        metadata: { approval_id: action.approvalId, action: action.action },
      },
    })
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Could not process callback action.'
    await answerTelegramCallbackQuery({
      callbackQueryId: callbackId,
      text: message,
      showAlert: true,
    })
  }
}

export const postTelegramWebhook = asyncHandler(async (request: Request, response: Response) => {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const provided = request.headers['x-telegram-bot-api-secret-token']
    const token = Array.isArray(provided) ? provided[0] : provided
    if (token !== env.TELEGRAM_WEBHOOK_SECRET) {
      response.status(401).json({ ok: false, error: 'Unauthorized webhook token' })
      return
    }
  }

  const payload = request.body as TelegramWebhookUpdate

  if (payload.callback_query) {
    try {
      await processTicketStatusCallback(payload.callback_query)
      response.json({ ok: true, callback_processed: true })
    } catch (error) {
      console.error('[telegram-callback-action-failed]', {
        requestId: request.requestId,
        error,
      })
      response.json({ ok: true, callback_processed: false })
    }
    return
  }

  const text = payload.message?.text
  if (isDisconnectCommand(text)) {
    try {
      await processDisconnectCommand(payload.message)
      response.json({ ok: true, disconnected: true })
    } catch (error) {
      console.error('[telegram-disconnect-command-failed]', {
        requestId: request.requestId,
        error,
      })
      response.json({ ok: true, disconnected: false })
    }
    return
  }

  if (isOwnerStatsCommand(text)) {
    try {
      await processOwnerStatsCommand(payload.message)
      response.json({ ok: true, owner_stats: true })
    } catch (error) {
      console.error('[telegram-owner-stats-command-failed]', {
        requestId: request.requestId,
        error,
      })
      response.json({ ok: true, owner_stats: false })
    }
    return
  }

  if (parseReplyCommand(text)) {
    try {
      await processOwnerReplyCommand(payload.message)
      response.json({ ok: true, reply_processed: true })
    } catch (error) {
      console.error('[telegram-owner-reply-command-failed]', {
        requestId: request.requestId,
        error,
      })
      const chatIdForError = payload.message?.chat?.id
      if (chatIdForError !== undefined) {
        await sendTelegramMessageWithRetry({
          chatId: String(chatIdForError),
          text:
            error instanceof AppError
              ? error.message
              : 'Could not post reply. Use /reply <ticket-id> <message> and ensure ticket is open.',
          logContext: {
            userRole: 'system',
            eventType: 'telegram_reply_command_failed',
          },
        })
      }
      response.json({ ok: true, reply_processed: false })
    }
    return
  }

  if (parseRentReviewCommand(text)) {
    try {
      await processOwnerRentReviewCommand(payload.message)
      response.json({ ok: true, rent_review_processed: true })
    } catch (error) {
      console.error('[telegram-owner-rent-review-command-failed]', {
        requestId: request.requestId,
        error,
      })
      const chatIdForError = payload.message?.chat?.id
      if (chatIdForError !== undefined) {
        await sendTelegramMessageWithRetry({
          chatId: String(chatIdForError),
          text:
            error instanceof AppError
              ? error.message
              : 'Could not process rent review. Use /approve <approval-id> [message] or /reject <approval-id> <reason>.',
          logContext: {
            userRole: 'system',
            eventType: 'telegram_rent_review_command_failed',
          },
        })
      }
      response.json({ ok: true, rent_review_processed: false })
    }
    return
  }

  if (isHelpCommand(text) || isBareStartCommand(text)) {
    try {
      const chatIdForMenu = payload.message?.chat?.id
      const userIdForMenu = payload.message?.from?.id
      if (chatIdForMenu !== undefined && userIdForMenu !== undefined) {
        const ownerLink = await getOwnerTelegramChatLinkByChat({
          chatId: String(chatIdForMenu),
          telegramUserId: String(userIdForMenu),
        })
        if (ownerLink?.owner_id) {
          await sendOwnerMainMenu({
            chatId: String(chatIdForMenu),
            organizationId: ownerLink.organization_id,
            ownerId: ownerLink.owner_id,
          })
        } else {
          await processHelpCommand(payload.message)
        }
      } else {
        await processHelpCommand(payload.message)
      }
      response.json({ ok: true, help: true })
    } catch (error) {
      console.error('[telegram-help-command-failed]', {
        requestId: request.requestId,
        error,
      })
      response.json({ ok: true, help: false })
    }
    return
  }

  const startToken = readStartToken(text)
  const chatId = payload.message?.chat?.id
  const userId = payload.message?.from?.id

  if (!startToken || chatId === undefined || userId === undefined) {
    response.json({
      ok: true,
      linked: false,
      ignored: true,
    })
    return
  }

  try {
    const linked = await linkTelegramChatFromStartToken({
      startToken,
      chatId: String(chatId),
      telegramUserId: String(userId),
      username: payload.message?.from?.username ?? null,
      firstName: payload.message?.from?.first_name ?? null,
      lastName: payload.message?.from?.last_name ?? null,
    })

    if (linked.role === 'owner' && linked.owner_id) {
      await sendOwnerMainMenu({
        chatId: String(chatId),
        organizationId: linked.organization_id,
        ownerId: linked.owner_id,
      })
    } else {
      await sendTelegramMessageWithRetry({
        chatId: String(chatId),
        text: '✅ Telegram connected successfully. You will now receive alerts for your linked account.',
        logContext: {
          organizationId: linked.organization_id,
          tenantId: linked.tenant_id ?? undefined,
          userRole: linked.role === 'tenant' ? 'tenant' : 'system',
          eventType: 'telegram_onboarding_success',
        },
      })
    }

    response.json({
      ok: true,
      linked: true,
    })
  } catch (error) {
    console.error('[telegram-onboarding-link-failed]', {
      requestId: request.requestId,
      error,
    })
    response.json({
      ok: true,
      linked: false,
    })
  }
})
